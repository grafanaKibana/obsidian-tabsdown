import {
	type Editor,
	type EditorPosition,
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
	nestedBlockCandidates,
	renderedSourceKey,
	rewriteBlock,
	type BlockLocator,
} from "./source";
import { mountTabs, type MountTabsOptions, type TabsController } from "./tabs";

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
	lineStart?: number;
	parent?: LocatorRef;
	offset?: number;
}

function resolveLocatorRef(ref: LocatorRef): BlockLocator | undefined {
	if (ref.parent) {
		const parent = resolveLocatorRef(ref.parent);
		if (!parent || ref.offset === undefined) return undefined;
		return { lineStart: parent.lineStart, nestedOffsets: [...parent.nestedOffsets, ref.offset] };
	}
	if (ref.lineStart === undefined) return undefined;
	return { lineStart: ref.lineStart, nestedOffsets: [] };
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

		this.registerMarkdownCodeBlockProcessor("tabsdown", (source, element, context) => {
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
			if (parentScope) {
				locatorRef = { parent: parentScope.locatorRef };
				parentScope.registrations.push({ element, source, locatorRef });
				bindNestedLocators(parentScope);
			} else if (renderedSection) {
				locatorRef = { lineStart: renderedSection.lineStart };
			}
			const addRenderChild = (child: MarkdownRenderChild): void => {
				child.registerDomEvent(element, "click", (event) => {
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

			const result = parseTabs(source);
			if (!result.ok) {
				renderTabsDiagnostic(element, result.diagnostic);
				addRenderChild(new MarkdownRenderChild(element));
				return;
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
			const editing = locatorRef && file instanceof TFile
				? this.createBlockEditing(
						file,
						locatorRef,
						source,
						options,
						origin,
						panelScopes,
					)
				: undefined;

			addRenderChild(
				new TabBlockRenderChild(
					this.app,
					element,
					context.sourcePath,
					result.tabs,
					result.configuration ?? [],
					() => this.freshnessGeneration,
					options,
					editing,
				),
			);
		});

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
		source: string,
		options: TabsdownConfig,
		origin: Editor | undefined,
		panelScopes: WeakMap<HTMLElement, PanelScope>,
	): BlockEditing {
		return {
			registerPanel: (element, tabIndex) => {
				panelScopes.set(element, {
					element,
					file,
					locatorRef,
					source,
					tabIndex,
					candidates: nestedBlockCandidates(source, tabIndex),
					registrations: [],
				});
			},
			open: async (trigger, available) => {
				const assertAvailable = (): void => {
					if (!available()) throw new Error("This Tabsdown block is no longer available.");
				};
				const generation = this.fileGenerations.get(file) ?? 0;
				const locator = resolveLocatorRef(locatorRef);
				if (!locator) throw new Error("This nested Tabsdown block could not be identified.");
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
				const snapshot = captureBlock(text, locator, source);
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
						const edit = rewriteBlock(current, snapshot, nextOptions);
						assertAvailable();
						editor.replaceRange(
							edit.replacement,
							positionAt(current, edit.from),
							positionAt(current, edit.to),
						);
						return;
					}
					await this.app.vault.process(file, (current) => {
						assertAvailable();
						this.assertCurrentFile(file);
						if (this.markdownEditors(file).length > 0) {
							throw new Error("An editor opened this note. Retry the save there.");
						}
						const edit = rewriteBlock(current, snapshot, nextOptions);
						return applySourceEdit(current, edit);
					});
				};
			},
		};
	}

	onunload(): void {
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
