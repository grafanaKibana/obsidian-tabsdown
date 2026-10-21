// eslint-disable-next-line import/no-extraneous-dependencies -- Obsidian supplies its public CM6 runtime; esbuild keeps it external.
import { Annotation, EditorSelection, EditorState, Prec, StateField, Transaction, type Extension } from "@codemirror/state";
// eslint-disable-next-line import/no-extraneous-dependencies -- Obsidian supplies its public CM6 runtime; esbuild keeps it external.
import { Decoration, Direction, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, MarkdownRenderChild, MarkdownView, Notice, Scope, type MarkdownPostProcessorContext, type Plugin, type TFile } from "obsidian";
import { INTERACTIVE_SELECTOR } from "./block-settings";
import { parseTabs } from "./parser";
import { captureBlock, rewriteTabBody, sourceBlocks, tabBodyPosition, applySourceEdit, type BlockLocator, type SourceBlock, type SourceEdit } from "./source";
import type { TabBlockRenderChild, TabRenderHooks } from "./render";

export type EditorBlockRenderer = (region: SourceBlock, element: HTMLElement, context: MarkdownPostProcessorContext, inline: InlineEditing) => TabBlockRenderChild | undefined;

interface Projection {
	region: SourceBlock;
	child?: TabBlockRenderChild;
	panels: Map<number, HTMLElement>;
	hooks: TabRenderHooks;
	attach(child: TabBlockRenderChild): void;
}
interface ActiveBody {
	projection: Projection;
	index: number;
	editor: EditorView;
	host: HTMLElement;
	panel: HTMLElement;
	hidden: Array<{ element: HTMLElement; hidden: boolean }>;
	minimum: string;
	stop(): void;
}

const inlineBodyEdit = Annotation.define<InlineEditing>();

function sameLocator(a: BlockLocator, b: BlockLocator): boolean {
	return a.lineStart === b.lineStart && a.nestedOffsets.length === b.nestedOffsets.length &&
		a.nestedOffsets.every((offset, index) => offset === b.nestedOffsets[index]);
}
function structure(region: SourceBlock): string {
	let cursor = 0;
	let key = region.syntax;
	for (const body of region.bodyRanges) {
		key += `\0${region.source.slice(cursor, body.logicalFrom)}`;
		cursor = body.logicalTo;
	}
	// A zero-line empty body acquires its delimiter-separating newline on first input.
	return (key + region.source.slice(cursor)).replace(/\n/g, "");
}
function minimalEdit(source: string, edit: SourceEdit): SourceEdit {
	const before = source.slice(edit.from, edit.to);
	let from = 0;
	while (from < before.length && from < edit.replacement.length && before[from] === edit.replacement[from]) from += 1;
	let to = before.length;
	let end = edit.replacement.length;
	while (to > from && end > from && before[to - 1] === edit.replacement[end - 1]) { to -= 1; end -= 1; }
	return { from: edit.from + from, to: edit.from + to, replacement: edit.replacement.slice(from, end) };
}

/** One child editor projects a source-mapped body; the host remains the history owner. */
export class InlineEditing {
	readonly projections = new Set<Projection>();
	active?: ActiveBody;
	ready = false;
	disposed = false;
	private syncing = false;
	private readonly file: TFile | null;
	constructor(
		private readonly plugin: Plugin,
		readonly view: EditorView,
		readonly element: HTMLElement,
		public region: SourceBlock,
		public snapshot: string,
	) {
		this.file = view.state.field(editorInfoField, false)?.file ?? null;
	}
	current(): boolean {
		return !this.disposed && !this.view.state.facet(EditorState.readOnly) &&
			this.view.state.field(editorInfoField, false)?.file === this.file &&
			this.view.state.doc.toString() === this.snapshot &&
			this.plugin.app.workspace.getLeavesOfType("markdown").filter((leaf) =>
				leaf.view instanceof MarkdownView && leaf.view.file === this.file && leaf.view.getMode() === "source").length <= 1;
	}
	registerBlock(locator: BlockLocator | undefined): Projection | undefined {
		const region = locator && sourceBlocks(this.snapshot).find((block) => sameLocator(block.locator, locator));
		if (!region) return undefined;
		const projection: Projection = {
			region, panels: new Map(),
			hooks: {
				registerPanel: (element, index) => { projection.panels.set(index, element); },
				beforeActivate: () => this.finish(),
			},
			attach: (child) => {
				projection.child = child;
				this.projections.add(projection);
				child.register(() => {
					if (this.active?.projection === projection) this.finish(false);
					this.projections.delete(projection);
				});
			},
		};
		return projection;
	}
	sync(region: SourceBlock, snapshot: string, transaction?: Transaction): boolean {
		if (this.disposed || this.view.state.field(editorInfoField, false)?.file !== this.file) return false;
		if (this.view.state.facet(EditorState.readOnly) && this.active) {
			const active = this.active;
			this.finish(false);
			active.projection.child?.refreshBody(active.index);
		}
		if (snapshot !== this.snapshot) {
			if (!this.ready || !transaction || transaction.startState.doc.toString() !== this.snapshot) return false;
			const previous = sourceBlocks(this.snapshot).filter((block) => block.start >= this.region.start && block.end <= this.region.end);
			const next = sourceBlocks(snapshot).filter((block) => block.start >= region.start && block.end <= region.end);
			if (previous.length !== next.length || previous.some((block, index) =>
				structure(block) !== structure(next[index]!) || transaction.changes.mapPos(block.start, 1) !== next[index]!.start)) return false;
			const updates = [...this.projections].map((projection) => ({ projection,
				region: next.find((block) => block.start === transaction.changes.mapPos(projection.region.start, 1)) }));
			if (updates.some((update) => !update.region)) return false;
			if (this.active && transaction.annotation(inlineBodyEdit) !== this) {
				const active = this.active;
				const edited = active.projection.region.bodyRanges[active.index]!;
				for (const { projection, region: updated } of updates) {
					if (projection === active.projection) continue;
					const ancestor = [...projection.panels].find(([, panel]) => panel.contains(active.host))?.[0];
					if (ancestor === undefined || projection.region.bodyRanges[ancestor]?.text === updated!.bodyRanges[ancestor]?.text) continue;
					const body = projection.region.bodyRanges[ancestor]!;
					let outside = false;
					transaction.changes.iterChangedRanges((from, to) => {
						if (from <= body.to && to >= body.from && (from < edited.from || to > edited.to)) outside = true;
					});
					// Rebuild an externally changed ancestor rather than preserve stale text around a nested editor.
					if (outside) return false;
				}
			}
			this.snapshot = snapshot;
			this.region = region;
			for (const update of updates) update.projection.region = update.region!;
			for (const { projection } of updates) {
				const result = parseTabs(projection.region.source, projection.region.syntax);
				if (!result.ok) return false;
				const activeHost = this.active?.host;
				const preserved = activeHost ? [...projection.panels].find(([, panel]) => panel.contains(activeHost))?.[0] : undefined;
				projection.child?.updateBodies(result.tabs, preserved);
			}
			const active = this.active;
			if (active) this.syncChild(active.editor, active.projection.region.bodyRanges[active.index]!.text);
		}
		this.region = region;
		return true;
	}
	private syncChild(child: EditorView, text: string): void {
		if (child.state.doc.toString() === text) return;
		const edit = minimalEdit(child.state.doc.toString(), { from: 0, to: child.state.doc.length, replacement: text });
		this.syncing = true;
		try { child.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.replacement } }); }
		finally { this.syncing = false; }
	}
	finish(render = true): void {
		const active = this.active;
		if (!active) return;
		this.active = undefined;
		active.stop();
		active.editor.destroy();
		active.host.remove();
		for (const state of active.hidden) state.element.hidden = state.hidden;
		active.panel.style.minHeight = active.minimum;
		if (render && this.current()) active.projection.child?.refreshBody(active.index);
		this.view.requestMeasure();
	}
	private leave(forward: boolean): void {
		this.finish();
		const position = forward ? this.region.end : this.region.start > 0
			? this.view.state.doc.lineAt(this.region.start - 1).to : 0;
		this.view.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true });
		this.view.focus();
	}
	private arrow(child: EditorView, key: string, extend: boolean): boolean {
		if (child.compositionStarted || !this.current()) return false;
		const selection = child.state.selection.main;
		const vertical = key === "ArrowUp" || key === "ArrowDown";
		const forward = vertical ? key === "ArrowDown"
			: (key === "ArrowRight") === (child.textDirectionAt(selection.head) !== Direction.RTL);
		const edge = forward ? child.state.doc.length : 0;
		const here = vertical ? child.coordsAtPos(selection.head) : null;
		const there = vertical ? child.coordsAtPos(edge) : null;
		const atEdge = vertical && here && there ? Math.abs(here.top - there.top) < 1 : selection.head === edge;
		if (atEdge && !extend && selection.empty) { this.leave(forward); return true; }
		const next = !extend && !selection.empty ? EditorSelection.cursor(forward ? selection.to : selection.from)
			: atEdge ? EditorSelection.cursor(edge)
				: vertical ? child.moveVertically(selection, forward) : child.moveByChar(selection, forward);
		child.dispatch({ selection: extend ? EditorSelection.range(selection.anchor, next.head) : next,
			scrollIntoView: true, userEvent: "select.keyboard" });
		return true;
	}
	open(projection: Projection, index: number, coordinates?: { x: number; y: number }, atEnd = false): void {
		if (!this.ready || !this.current()) return;
		if (this.active?.projection === projection && this.active.index === index) { this.active.editor.focus(); return; }
		const panel = projection.panels.get(index);
		const range = projection.region.bodyRanges[index];
		if (!panel || panel.hidden || !range || !this.element.contains(panel)) return;
		this.finish();
		const hidden = Array.from(panel.children).map((element) => ({ element: element as HTMLElement, hidden: (element as HTMLElement).hidden }));
		const minimum = panel.style.minHeight;
		panel.style.minHeight = `${panel.getBoundingClientRect().height}px`;
		for (const state of hidden) state.element.hidden = true;
		const host = panel.createDiv({ cls: "tabsdown-inline-editor" });
		const focusWatch = (): void => { queueMicrotask(() => {
			if (this.active?.host === host && !this.active.editor.compositionStarted && !host.contains(host.ownerDocument.activeElement)) this.finish();
		}); };
		const selectAll = (child: EditorView): boolean => {
			child.dispatch({ selection: { anchor: 0, head: child.state.doc.length } }); return true;
		};
		const history = (redo: boolean): boolean => {
			if (!this.current()) return true;
			const editor = this.view.state.field(editorInfoField, false)?.editor;
			if (redo) editor?.redo(); else editor?.undo();
			return true;
		};
		const remove = (child: EditorView, forward: boolean): boolean => {
			if (child.compositionStarted) return false;
			const selection = child.state.selection.main;
			if (!selection.empty) {
				child.dispatch(child.state.replaceSelection(""), { userEvent: forward ? "delete.forward" : "delete.backward" });
				return true;
			}
			const next = child.moveByChar(selection, forward);
			const from = Math.min(next.head, selection.head);
			const to = Math.max(next.head, selection.head);
			if (from !== to) child.dispatch({ changes: { from, to }, selection: { anchor: from },
				userEvent: forward ? "delete.forward" : "delete.backward" });
			return true;
		};
		const editor = new EditorView({
			parent: host,
			state: EditorState.create({ doc: range.text, extensions: [
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({ "aria-label": "Edit tab Markdown" }),
				keymap.of([
					{ key: "Mod-a", run: selectAll },
					{ key: "Mod-z", run: () => history(false) },
					{ key: "Mod-Shift-z", run: () => history(true) },
					{ key: "Mod-y", run: () => history(true) },
					{ key: "Backspace", run: (child) => remove(child, false) },
					{ key: "Delete", run: (child) => remove(child, true) },
					{ key: "Enter", run: (child) => { child.dispatch(child.state.replaceSelection("\n"), { userEvent: "input" }); return true; } },
					{ key: "Tab", run: (child) => { child.dispatch(child.state.replaceSelection("\t"), { userEvent: "input" }); return true; } },
					{ key: "Escape", run: () => { this.leave(true); return true; } },
				]),
				EditorView.domEventHandlers({ blur: focusWatch, keydown: (event, child) => {
					if (!event.key.startsWith("Arrow") || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
					return this.arrow(child, event.key, event.shiftKey);
				} }),
			] }),
			dispatchTransactions: (transactions, child) => {
				if (this.syncing) { child.update(transactions); return; }
				const changed = transactions.some((transaction) => transaction.docChanged);
				if (changed && (!this.current() || projection.region.bodyRanges[index]?.text !== transactions[0]!.startState.doc.toString())) {
					new Notice("The note changed. Reopen the tab before editing.");
					return;
				}
				child.update(transactions);
				for (const transaction of transactions) {
					if (!transaction.docChanged || this.active?.editor !== child) continue;
					try {
						const snapshot = captureBlock(this.snapshot, projection.region.locator, projection.region.source);
						const edit = minimalEdit(this.snapshot, rewriteTabBody(this.snapshot, snapshot, index, transaction.state.doc.toString()));
						const nextText = applySourceEdit(this.snapshot, edit);
						const next = sourceBlocks(nextText).find((block) => block.start === projection.region.start);
						const captured = next && captureBlock(nextText, next.locator, next.source);
						const selection = transaction.state.selection.main;
						const position = (offset: number): number => captured
							? tabBodyPosition(nextText, captured, index, offset)
							: edit.from + edit.replacement.length;
						this.view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.replacement },
							selection: { anchor: position(selection.anchor), head: position(selection.head) },
							annotations: [Transaction.userEvent.of(transaction.annotation(Transaction.userEvent) ?? "input"), inlineBodyEdit.of(this)],
						});
						if (this.disposed) this.view.focus();
					} catch (error) {
						this.syncChild(child, projection.region.bodyRanges[index]!.text);
						new Notice(error instanceof Error ? error.message : "The tab edit could not be applied.");
					}
				}
			},
		});
		const scope = new Scope(this.plugin.app.scope);
		scope.register(["Mod"], "a", (event) => {
			if (host.contains(event.target as Node)) { selectAll(editor); return false; }
			return undefined;
		});
		for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
			for (const extend of [false, true]) scope.register(extend ? ["Shift"] : [], key, (event) => {
				if (!event.isComposing && host.contains(event.target as Node) && this.arrow(editor, key, extend)) {
					event.stopPropagation(); return false;
				}
				return undefined;
			});
		}
		this.plugin.app.keymap.pushScope(scope);
		host.ownerDocument.addEventListener("focusin", focusWatch, true);
		host.addEventListener("compositionend", focusWatch);
		for (const type of ["mousedown", "keydown", "keyup", "click"]) host.addEventListener(type, (event) => event.stopPropagation());
		this.active = { projection, index, editor, host, panel, hidden, minimum, stop: () => {
			host.ownerDocument.removeEventListener("focusin", focusWatch, true);
			this.plugin.app.keymap.popScope(scope);
		} };
		editor.focus();
		const position = coordinates && coordinates.x > 0 && coordinates.y > 0 ? editor.posAtCoords(coordinates) : null;
		editor.dispatch({ selection: { anchor: position ?? (atEnd ? editor.state.doc.length : 0) } });
		this.view.requestMeasure();
	}
	dispose(): void { this.disposed = true; this.finish(false); this.projections.clear(); }
}

const mountedWidgets = new WeakMap<HTMLElement, { inline: InlineEditing; owner: MarkdownRenderChild }>();

class MarkerWidget extends WidgetType {
	constructor(private readonly plugin: Plugin, readonly region: SourceBlock, readonly snapshot: string,
		private readonly renderBlock: EditorBlockRenderer, private readonly file: TFile,
		private readonly readOnly: boolean,
		private readonly transaction?: Transaction) { super(); }
	eq(other: MarkerWidget): boolean {
		return this.file === other.file && this.readOnly === other.readOnly && this.snapshot === other.snapshot && this.region.start === other.region.start;
	}
	updateDOM(element: HTMLElement): boolean {
		const mounted = mountedWidgets.get(element);
		return mounted?.inline.sync(this.region, this.snapshot, this.transaction) ?? false;
	}
	toDOM(view: EditorView): HTMLElement {
		const element = view.dom.ownerDocument.adoptNode(createDiv({ cls: "tabsdown-marker-widget" }));
		element.tabIndex = 0;
		element.setAttribute("role", "group");
		element.setAttribute("aria-label", "Tabbed Markdown");
		const owner = this.plugin.addChild(new MarkdownRenderChild(element));
		const inline = new InlineEditing(this.plugin, view, element, this.region, this.snapshot);
		mountedWidgets.set(element, { inline, owner });
		owner.register(() => { inline.dispose(); mountedWidgets.delete(element); });
		const path = view.state.field(editorInfoField, false)?.file?.path ?? "";
		const child = this.renderBlock(this.region, element.createDiv(), {
			docId: path, sourcePath: path, frontmatter: null,
			addChild: (child) => { owner.addChild(child); },
			getSectionInfo: () => ({ text: inline.snapshot, lineStart: inline.region.lineStart, lineEnd: inline.region.lineEnd }),
		}, inline);
		owner.registerDomEvent(element, "click", (event) => {
			if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || element.ownerDocument.getSelection()?.isCollapsed === false) return;
			const target = event.target instanceof element.ownerDocument.defaultView!.Element ? event.target : null;
			if (!target) return;
			const interactive = target.closest(INTERACTIVE_SELECTOR);
			if (interactive && interactive !== element && element.contains(interactive)) return;
			const panel = target.closest<HTMLElement>(".tabsdown__panel");
			for (const projection of inline.projections) for (const [index, candidate] of projection.panels) {
				if (candidate === panel) { event.preventDefault(); event.stopPropagation(); inline.open(projection, index, { x: event.clientX, y: event.clientY }); return; }
			}
		});
		owner.registerDomEvent(element, "keydown", (event) => {
			const onTab = event.target instanceof element.ownerDocument.defaultView!.Element && event.target.getAttribute("role") === "tab";
			if (!(event.key === "Enter" && event.target === element) && !(onTab && event.key === "ArrowDown")) return;
			for (const projection of inline.projections) for (const [index, panel] of projection.panels) {
				if (!panel.hidden && (!onTab || projection.child?.containerEl === (event.target as HTMLElement).closest(".tabsdown"))) {
					event.preventDefault(); event.stopPropagation(); inline.open(projection, index); return;
				}
			}
		});
		void child?.ready.then((success) => { if (!inline.disposed) { inline.ready = success; view.requestMeasure(); } });
		return element;
	}
	destroy(element: HTMLElement): void {
		const mounted = mountedWidgets.get(element);
		if (!mounted) return;
		mountedWidgets.delete(element);
		mounted.inline.dispose();
		this.plugin.removeChild(mounted.owner);
	}
	ignoreEvent(): boolean { return true; }
}

export function markerEditorExtension(plugin: Plugin, renderBlock: EditorBlockRenderer): Extension {
	const decorations = (state: EditorState, transaction?: Transaction): DecorationSet => {
		if (!state.field(editorLivePreviewField, false) || !state.field(editorInfoField, false)?.file) return Decoration.none;
		const snapshot = state.doc.toString();
		const file = state.field(editorInfoField).file!;
		return Decoration.set(sourceBlocks(snapshot).filter((block) => block.locator.nestedOffsets.length === 0 && parseTabs(block.source, block.syntax).ok)
			.map((region) => Decoration.replace({ block: true, widget: new MarkerWidget(plugin, region, snapshot, renderBlock, file, state.facet(EditorState.readOnly), transaction) })
				.range(region.start, region.end)));
	};
	const enter = (view: EditorView, key: string): boolean => {
		const selection = view.state.selection.main;
		if (view.compositionStarted || !view.state.field(editorLivePreviewField, false) ||
			view.state.selection.ranges.length !== 1 || !selection.empty || view.dom.ownerDocument.activeElement !== view.contentDOM) return false;
		const vertical = key === "ArrowUp" || key === "ArrowDown";
		const forward = vertical ? key === "ArrowDown"
			: (key === "ArrowRight") === (view.textDirectionAt(selection.head) !== Direction.RTL);
		const next = vertical ? view.moveVertically(selection, forward) : view.moveByChar(selection, forward);
		const controllers = Array.from(view.dom.querySelectorAll<HTMLElement>(".tabsdown-marker-widget"))
			.map((element) => mountedWidgets.get(element)?.inline)
			.filter((inline): inline is InlineEditing => Boolean(inline?.ready && inline.current()));
		controllers.sort((a, b) => forward ? a.region.start - b.region.start : b.region.end - a.region.end);
		const inline = controllers.find(({ region }) => forward
			? selection.head < region.end && next.head >= region.start && next.head >= selection.head
			: selection.head > region.start && next.head <= region.end && next.head <= selection.head);
		if (!inline) return false;
		for (const projection of inline.projections) {
			if (projection.region.start !== inline.region.start) continue;
			for (const [index, panel] of projection.panels) if (!panel.hidden) {
				inline.open(projection, index, undefined, !forward);
				return Boolean(inline.active);
			}
		}
		return false;
	};
	return Prec.highest([StateField.define<DecorationSet>({
		create: (state) => decorations(state),
		update: (value, transaction) => transaction.docChanged || transaction.reconfigured ||
			transaction.state.field(editorLivePreviewField, false) !== transaction.startState.field(editorLivePreviewField, false) ||
			transaction.state.field(editorInfoField, false)?.file !== transaction.startState.field(editorInfoField, false)?.file
			? decorations(transaction.state, transaction) : value,
		provide: (field) => EditorView.decorations.from(field),
	}), keymap.of(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((key) => ({ key, run: (view) => enter(view, key) })))]);
}
export function registerMarkerEditor(plugin: Plugin, renderBlock: EditorBlockRenderer): void {
	plugin.registerEditorExtension(markerEditorExtension(plugin, renderBlock));
}
