import {
	type Editor,
	type EditorPosition,
	type Component,
	type MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownRenderChild,
	MarkdownView,
	Plugin,
	TFile,
} from "obsidian";
import type { TabsdownConfig } from "./config";
import { INTERACTIVE_SELECTOR } from "./block-settings";
import { parseTabs } from "./parser";
import {
	TabBlockRenderChild,
	type BlockEditing,
	renderTabsDiagnostic,
} from "./render";
import {
	applySourceEdit,
	captureBlock,
	locateBlock,
	nestedBlockCandidates,
	renderedSourceKey,
	rewriteBlock,
	rewriteTab,
	tabLabels,
	type BlockLocator,
} from "./source";
import { mountTabs, type MountTabsOptions, type TabsController } from "./tabs";
import { sourceBlocks, type TabsSyntax } from "./source";
import { registerMarkerReading } from "./marker-reading";
import { registerMarkerEditor, type InlineEditing } from "./marker-editor";

export type { MountTabsOptions, TabSpec, TabsController } from "./tabs";

interface PanelScope {
	element: HTMLElement;
	file: TFile;
	locatorRef: LocatorRef;
	source: string;
	tabIndex: number;
	candidates: ReturnType<typeof nestedBlockCandidates>;
	registrations: Array<{ element: HTMLElement; source: string; locatorRef: LocatorRef }>;
}

interface LocatorRef {
	dynamic?: () => BlockLocator | undefined;
	lineStart?: number;
	parent?: LocatorRef;
	offset?: number;
	/** An embedded block: its own note holds this source, but no section reports it. */
	search?: string;
}

interface PendingTabFocus {
	file: TFile;
	locator: BlockLocator;
	expectedText: string;
	focusIndex: number;
	selectedIndex: number;
	scope: Element | Document;
	timeout: number;
	view: Window;
}

function sameLocator(left: BlockLocator, right: BlockLocator): boolean {
	return left.lineStart === right.lineStart &&
		left.nestedOffsets.length === right.nestedOffsets.length &&
		left.nestedOffsets.every((offset, index) => offset === right.nestedOffsets[index]);
}

function renderScope(element: HTMLElement): Element | Document {
	return element.closest(".markdown-embed-content, .workspace-leaf-content") ??
		element.ownerDocument;
}

function resolveLocatorRef(ref: LocatorRef, text: string): BlockLocator | undefined {
	if (ref.dynamic) return ref.dynamic();
	if (ref.parent) {
		const parent = resolveLocatorRef(ref.parent, text);
		if (!parent || ref.offset === undefined) return undefined;
		return { lineStart: parent.lineStart, nestedOffsets: [...parent.nestedOffsets, ref.offset] };
	}
	const lineStart = ref.search === undefined
		? ref.lineStart
		: locateBlock(text, ref.search)?.lineStart;
	if (lineStart === undefined) return undefined;
	return { lineStart, nestedOffsets: [] };
}

function bindNestedLocators(scope: PanelScope): void {
	for (const registration of scope.registrations) registration.locatorRef.offset = undefined;
	for (const source of new Set(scope.registrations.map((item) => renderedSourceKey(item.source)))) {
		const candidates = scope.candidates.filter(
			(item) => renderedSourceKey(item.source) === source,
		);
		const registrations = scope.registrations.filter(
			(item) => renderedSourceKey(item.source) === source,
		);
		if (
			registrations.length !== candidates.length ||
			registrations.some((item) => !scope.element.contains(item.element))
		) continue;
		registrations.sort((left, right) => {
			const position = left.element.compareDocumentPosition(right.element);
			if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
			if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			return 0;
		});
		candidates.sort((left, right) => left.offset - right.offset);
		for (const [index, registration] of registrations.entries()) {
			registration.locatorRef.offset = candidates[index]?.offset;
		}
	}
}

function positionAt(source: string, offset: number): EditorPosition {
	const before = source.slice(0, offset);
	const line = (before.match(/\n/g) ?? []).length;
	const newline = before.lastIndexOf("\n");
	return { line, ch: offset - newline - 1 };
}

export default class TabsdownPlugin extends Plugin {
	private freshnessGeneration = 0;
	private readonly fileGenerations = new WeakMap<TFile, number>();
	private readonly mountedTabs = new Set<TabsController>();
	private readonly pendingTabFocus = new Set<PendingTabFocus>();

	onload(): void {
		const panelScopes = new WeakMap<HTMLElement, PanelScope>();
		const markContentStale = (file?: unknown): void => {
			this.freshnessGeneration += 1;
			if (file instanceof TFile) {
				this.fileGenerations.set(file, (this.fileGenerations.get(file) ?? 0) + 1);
			}
		};

		this.registerEvent(this.app.vault.on("create", markContentStale));
		this.registerEvent(this.app.vault.on("modify", markContentStale));
		this.registerEvent(this.app.vault.on("delete", markContentStale));
		this.registerEvent(this.app.vault.on("rename", markContentStale));
		this.registerEvent(
			this.app.metadataCache.on("changed", markContentStale),
		);

		const renderFragment = async (
			markdown: string, element: HTMLElement, context: MarkdownPostProcessorContext,
			owner: Component, inline?: InlineEditing, exactLines = true,
		): Promise<void> => {
			const blocks = sourceBlocks(markdown, { fragment: true })
				.filter((block) => block.locator.nestedOffsets.length === 0);
			if (blocks.length === 0) {
				await MarkdownRenderer.render(this.app, markdown, element, context.sourcePath, owner);
				return;
			}
			let disposed = false;
			owner.register(() => { disposed = true; });
			// Keep references and footnotes in one Markdown parse, including definitions
			// on the other side of an embedded layout. Only its DOM slot is substituted.
			const token = element.ownerDocument.defaultView!.crypto.randomUUID();
			let cursor = 0;
			let prepared = "";
			for (const [index, block] of blocks.entries()) {
				const opening = markdown.slice(block.start, block.bodyStart).split("\n")[0]!;
				const delimiter = opening.search(/%%|`{3,}|~{3,}/);
				const prefix = opening.slice(0, delimiter);
				prepared += markdown.slice(cursor, block.start) + prefix +
					`<div data-tabsdown-placeholder="${token}-${index}"></div>\n\n`;
				cursor = block.end;
			}
			prepared += markdown.slice(cursor);
			await MarkdownRenderer.render(this.app, prepared, element, context.sourcePath, owner);
			if (disposed) return;
			const section = exactLines ? context.getSectionInfo(element) : null;
			const occurrences = new Map<string, number>();
			for (const [index, block] of blocks.entries()) {
				if (disposed) return;
				const placeholder = element.querySelector<HTMLElement>(
					`[data-tabsdown-placeholder="${token}-${index}"]`,
				);
				if (!placeholder) throw new Error("A Tabsdown layout placeholder could not be rendered.");
				const target = placeholder;
				target.removeAttribute("data-tabsdown-placeholder");
				const key = `${block.syntax}\0${renderedSourceKey(block.source)}`;
				const occurrence = occurrences.get(key) ?? 0;
				occurrences.set(key, occurrence + 1);
				const child = renderBlock(block.source, target, {
					...context,
					addChild: (child) => { owner.addChild(child); },
					getSectionInfo: () => section ? {
						text: section.text, lineStart: section.lineStart + block.lineStart,
						lineEnd: section.lineStart + block.lineEnd,
					} : null,
				}, block.syntax, inline, occurrence);
				if (child && !await child.ready) throw new Error("A Tabsdown panel could not be rendered.");
			}
		};
		const renderBlock = (
			source: string, element: HTMLElement, context: MarkdownPostProcessorContext,
			syntax: TabsSyntax = "fenced", inline?: InlineEditing, nestedOccurrence?: number,
		): TabBlockRenderChild | undefined => {
			const renderedSection = context.getSectionInfo(element);
			const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
			let panel = element.parentElement;
			let parentScope: PanelScope | undefined;
			while (panel && !parentScope) {
				const candidate = panelScopes.get(panel);
				if (candidate?.file === file) parentScope = candidate;
				panel = panel.parentElement;
			}
			let locatorRef: LocatorRef | undefined;
			if (parentScope && !renderedSection) {
				locatorRef = { parent: parentScope.locatorRef };
				parentScope.registrations.push({ element, source, locatorRef });
				bindNestedLocators(parentScope);
				if (nestedOccurrence !== undefined) {
					locatorRef.offset = parentScope.candidates.filter((candidate) =>
						(candidate.syntax ?? "fenced") === syntax && renderedSourceKey(candidate.source) === renderedSourceKey(source),
					)[nestedOccurrence]?.offset;
				}
			} else if (renderedSection) {
				locatorRef = { lineStart: renderedSection.lineStart };
			} else {
				locatorRef = { search: source };
			}
			const addRenderChild = (child: MarkdownRenderChild): void => {
				child.registerDomEvent(element, "click", (event) => {
					if (inline) return;
					const target = event.target;
					const domView = element.ownerDocument.defaultView;
					if (event.defaultPrevented || !domView || !(target instanceof domView.Element)) {
						return;
					}

					const interactive = target.closest(INTERACTIVE_SELECTOR);
					if (interactive && element.contains(interactive)) {
						return;
					}

					const view =
						this.app.workspace.getActiveViewOfType(MarkdownView);
					if (
						!view ||
						view.getMode() !== "source" ||
						view.file?.path !== context.sourcePath
					) {
						return;
					}

					const section =
						context.getSectionInfo(element) ?? renderedSection;
					if (!section) {
						return;
					}

					view.editor.setCursor({
						line: Math.min(section.lineStart + 1, section.lineEnd),
						ch: 0,
					});
					view.editor.focus();
				});
				context.addChild(child);
			};

			const result = parseTabs(source, syntax);
			if (!result.ok) {
				renderTabsDiagnostic(element, result.diagnostic);
				addRenderChild(new MarkdownRenderChild(element));
				return undefined;
			}
			const options: TabsdownConfig = { ...result.options };
			for (const value of result.configuration ?? []) {
				if (["top", "left", "right", "bottom"].includes(value)) {
					options.position = value as TabsdownConfig["position"];
				} else {
					options.layout = value as TabsdownConfig["layout"];
				}
			}

			const active = this.app.workspace.getActiveViewOfType(MarkdownView);
			const origin = active?.file === file ? active.editor : undefined;
			const projection = inline && locatorRef
				? inline.registerBlock(resolveLocatorRef(locatorRef, inline.snapshot))
				: undefined;
			if (projection && locatorRef) locatorRef.dynamic = () => projection.region.locator;
			const currentSource = (): string => projection?.region.source ?? source;
			const editing = locatorRef && file instanceof TFile
				? this.createBlockEditing(
						file,
						locatorRef,
						currentSource,
						options,
						origin,
						panelScopes,
						element,
						syntax,
					)
				: undefined;

			const child = new TabBlockRenderChild(
					this.app,
					element,
					context.sourcePath,
					result.tabs,
					result.configuration ?? [],
					() => this.freshnessGeneration,
					options,
					editing,
					{
						...projection?.hooks,
						renderMarkdown: (markdown, target, component) => renderFragment(
							markdown, target, context, component, inline, false),
					},
			);
			projection?.attach(child);
			addRenderChild(child);
			return child;
		};
		this.registerMarkdownCodeBlockProcessor("tabsdown", (source, element, context) => {
			renderBlock(source, element, context);
		});
		registerMarkerReading(this, renderFragment);
		registerMarkerEditor(this, (region, element, context, inline) =>
			renderBlock(region.source, element, context, region.syntax, inline));

		const refreshStyleSettings = (): boolean => {
			const stylesLoaded = Array.from(
				document.head.querySelectorAll("style"),
			).some((style) =>
				style.textContent?.includes("\nname: Tabsdown\nid: tabsdown\n"),
			);
			if (!stylesLoaded) return false;

			this.app.workspace.trigger("parse-style-settings");
			return true;
		};

		if (!refreshStyleSettings()) {
			const observer = new MutationObserver(() => {
				if (refreshStyleSettings()) observer.disconnect();
			});
			observer.observe(document.head, { childList: true });
			this.register(() => observer.disconnect());
		}
	}

	private markdownEditors(file: TFile): Editor[] {
		const editors = new Set<Editor>();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (
				view instanceof MarkdownView &&
				view.file === file &&
				view.getMode() === "source"
			) {
				editors.add(view.editor);
			}
		}
		return [...editors];
	}

	private assertCurrentFile(file: TFile): void {
		if (this.app.vault.getAbstractFileByPath(file.path) !== file) {
			throw new Error("This note was deleted or replaced. Reopen the block and retry.");
		}
	}

	private createBlockEditing(
		file: TFile,
		locatorRef: LocatorRef,
		source: () => string,
		options: TabsdownConfig,
		origin: Editor | undefined,
		panelScopes: WeakMap<HTMLElement, PanelScope>,
		element: HTMLElement,
		syntax: TabsSyntax,
	): BlockEditing {
		const scopes = new Set<PanelScope>();
		let focusRequest: PendingTabFocus | undefined;
		let requestedFocus: { focusIndex: number; selectedIndex: number } | undefined;
		const discardFocusRequest = (request: PendingTabFocus): void => {
			request.view.clearTimeout(request.timeout);
			this.pendingTabFocus.delete(request);
			if (focusRequest === request) focusRequest = undefined;
		};
		const clearFocusRequest = (): void => {
			if (focusRequest) discardFocusRequest(focusRequest);
			focusRequest = undefined;
		};
		const queueFocusRequest = (
			locator: BlockLocator,
			text: string,
			focus: { focusIndex: number; selectedIndex: number },
		): void => {
			clearFocusRequest();
			const view = element.ownerDocument.defaultView;
			if (!view) return;
			for (const pending of this.pendingTabFocus) {
				if (
					pending.file === file &&
					pending.scope === renderScope(element) &&
					sameLocator(pending.locator, locator)
				) discardFocusRequest(pending);
			}
			let request!: PendingTabFocus;
			focusRequest = {
				file,
				locator: { lineStart: locator.lineStart, nestedOffsets: [...locator.nestedOffsets] },
				expectedText: text,
				...focus,
				scope: renderScope(element),
				timeout: view.setTimeout(() => discardFocusRequest(request), 2_000),
				view,
			};
			request = focusRequest;
			this.pendingTabFocus.add(focusRequest);
		};
		return {
			get labels() { return tabLabels(source(), syntax); },
			refreshSource: () => {
				for (const scope of scopes) {
					if (!element.contains(scope.element)) { scopes.delete(scope); continue; }
					scope.source = source();
					scope.candidates = nestedBlockCandidates(source(), scope.tabIndex, syntax);
					bindNestedLocators(scope);
				}
			},
			pendingFocus: () => {
				if (!element.isConnected) return undefined;
				for (const request of this.pendingTabFocus) {
					if (request.file !== file || request.scope !== renderScope(element)) continue;
					const locator = resolveLocatorRef(locatorRef, request.expectedText);
					if (!locator || !sameLocator(locator, request.locator)) continue;
					try {
						captureBlock(request.expectedText, locator, source());
					} catch {
						continue;
					}
					return {
						focusIndex: request.focusIndex,
						selectedIndex: request.selectedIndex,
						consume: () => discardFocusRequest(request),
					};
				}
				return undefined;
			},
			requestFocus: (focusIndex, selectedIndex) => {
				requestedFocus = { focusIndex, selectedIndex };
			},
			registerPanel: (element, tabIndex) => {
				const scope: PanelScope = {
					element,
					file,
					locatorRef,
					source: source(),
					tabIndex,
					candidates: nestedBlockCandidates(source(), tabIndex, syntax),
					registrations: [],
				};
				panelScopes.set(element, scope);
				scopes.add(scope);
			},
			open: async (trigger, available) => {
				const assertAvailable = (): void => {
					if (!available()) throw new Error("This Tabsdown block is no longer available.");
				};
				const generation = this.fileGenerations.get(file) ?? 0;
				this.assertCurrentFile(file);
				const editors = this.markdownEditors(file);
				const owner = origin && editors.includes(origin)
					? origin
					: editors.length === 1 ? editors[0] : undefined;
				const text = owner?.getValue() ?? await this.app.vault.cachedRead(file);
				assertAvailable();
				if ((this.fileGenerations.get(file) ?? 0) !== generation) {
					throw new Error("The note changed. Reopen the block settings.");
				}
				const locator = resolveLocatorRef(locatorRef, text);
				if (!locator) throw new Error("This nested Tabsdown block could not be identified.");
				const snapshot = captureBlock(text, locator, source());
				return async (nextOptions) => {
					assertAvailable();
					this.assertCurrentFile(file);
					const currentEditors = this.markdownEditors(file);
					if (currentEditors.length > 1) {
						throw new Error("More than one editor owns this note. Close the extra editor and retry.");
					}
					const editor = currentEditors[0];
					if (editor) {
						const current = editor.getValue();
						const edit = "type" in nextOptions
							? rewriteTab(current, snapshot, nextOptions)
							: rewriteBlock(current, snapshot, nextOptions);
						assertAvailable();
						if ("type" in nextOptions && requestedFocus) {
							queueFocusRequest(
								snapshot.locator,
								applySourceEdit(current, edit),
								requestedFocus,
							);
						}
						try {
							editor.replaceRange(
								edit.replacement,
								positionAt(current, edit.from),
								positionAt(current, edit.to),
							);
						} catch (error) {
							clearFocusRequest();
							throw error;
						}
						return;
					}
					try {
						await this.app.vault.process(file, (current) => {
							assertAvailable();
							this.assertCurrentFile(file);
							if (this.markdownEditors(file).length > 0) {
								throw new Error("An editor opened this note. Retry the save there.");
							}
							const edit = "type" in nextOptions
								? rewriteTab(current, snapshot, nextOptions)
								: rewriteBlock(current, snapshot, nextOptions);
							const next = applySourceEdit(current, edit);
							if ("type" in nextOptions && requestedFocus) {
								queueFocusRequest(
									snapshot.locator,
									next,
									requestedFocus,
								);
							}
							return next;
						});
					} catch (error) {
						clearFocusRequest();
						throw error;
					}
				};
			},
		};
	}

	onunload(): void {
		for (const request of this.pendingTabFocus) {
			request.view.clearTimeout(request.timeout);
		}
		this.pendingTabFocus.clear();
		for (const controller of this.mountedTabs) controller.destroy();
	}

	mountTabs(container: HTMLElement, options: MountTabsOptions): TabsController {
		const controller = mountTabs(container, options);
		const destroy = controller.destroy.bind(controller);
		controller.destroy = (): void => {
			destroy();
			this.mountedTabs.delete(controller);
		};
		this.mountedTabs.add(controller);
		return controller;
	}
}
