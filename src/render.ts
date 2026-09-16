import {
	App,
	Component,
	MarkdownRenderChild,
	MarkdownRenderer,
	Menu,
	Notice,
	setIcon,
} from "obsidian";
import { renderLabel } from "./label";
import { DeleteTabModal } from "./delete-tab-modal";
import { TabLabelEditor } from "./label-editor";
import { trackPanelHeight, type PanelHeightTracker } from "./panel-height";
import {
	parseInlineLabel,
	type TabConfiguration,
	type TabDefinition,
	type TabsDiagnostic,
	type TabsdownConfig,
} from "./parser";
import { addBlockSettingsContextMenu, type SaveBlockSettings } from "./block-settings";
import {
	trackSeparators,
	type SeparatorTracker,
} from "./separator";

interface PanelState {
	panelEl: HTMLElement;
	component?: Component;
	attemptEl?: HTMLElement;
	generation?: number;
	epoch: number;
	status: "unrendered" | "rendering" | "rendered" | "error";
}

export interface BlockEditing {
	labels: readonly string[];
	open(trigger: HTMLElement, available: () => boolean): Promise<SaveBlockSettings>;
	pendingFocus?(): {
		focusIndex: number;
		selectedIndex: number;
		consume(): void;
	} | undefined;
	registerPanel(element: HTMLElement, tabIndex: number): void;
	requestFocus?(focusIndex: number, selectedIndex: number): void;
}

let nextBlockId = 0;

function createElement<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	className: string,
): HTMLElementTagNameMap[K] {
	return parent.createEl(tag, { cls: className });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function renderTabsDiagnostic(
	containerEl: HTMLElement,
	diagnostic: TabsDiagnostic,
): void {
	containerEl.replaceChildren();
	const root = createElement(containerEl, "div", "tabsdown tabsdown__diagnostic");
	root.setAttribute("role", "alert");

	const title = createElement(root, "strong", "tabsdown__diagnostic-title");
	title.textContent = `Tabsdown: ${diagnostic.message}`;
	const location = createElement(root, "div", "tabsdown__diagnostic-location");
	location.textContent = `Line ${diagnostic.line}`;
	const source = createElement(root, "pre", "tabsdown__diagnostic-source");
	source.textContent = diagnostic.source;

	root.append(title, location, source);
	containerEl.append(root);
}

export class TabBlockRenderChild extends MarkdownRenderChild {
	private readonly blockId = `tabsdown-${++nextBlockId}`;
	private readonly buttons: HTMLButtonElement[] = [];
	private readonly panels: PanelState[] = [];
	private readonly menus = new Set<Menu>();
	private panelsEl?: HTMLElement;
	private height?: PanelHeightTracker;
	private separators?: SeparatorTracker;
	private selectedIndex = 0;
	private focusIndex = 0;
	private disposed = false;
	private labelEditor?: TabLabelEditor;
	private draft?: HTMLElement;
	private deleteDialog?: DeleteTabModal;

	constructor(
		private readonly app: App,
		containerEl: HTMLElement,
		private readonly sourcePath: string,
		private readonly tabs: readonly TabDefinition[],
		private readonly configuration: readonly TabConfiguration[],
		private readonly getGeneration: () => number,
		private readonly options: TabsdownConfig = {},
		private readonly editing?: BlockEditing,
	) {
		super(containerEl);
	}

	onload(): void {
		this.containerEl.replaceChildren();
		this.containerEl.classList.add("tabsdown");
		this.applyNestingClass();
		if (this.configuration.some((value) => value === "one" || value === "multi")) {
			this.containerEl.classList.add("tabsdown--inline-overflow");
		}
		for (const configuration of this.resolveConfiguration()) {
			this.containerEl.classList.add(`tabsdown--${configuration}`);
		}
		for (const key of ["density", "personality", "palette", "alignment"] as const) {
			const value = this.options[key];
			if (value) this.containerEl.classList.add(`tabsdown--${key}-${value}`);
		}

		const tabList = createElement(
			this.containerEl,
			"div",
			"tabsdown__tablist",
		);
		tabList.setAttribute("role", "tablist");
		tabList.setAttribute("aria-label", "Tabbed content");

		const panels = createElement(this.containerEl, "div", "tabsdown__panels");
		this.panelsEl = panels;
		this.height = trackPanelHeight(
			panels,
			() => this.panels[this.selectedIndex]?.status === "rendering",
		);

		this.tabs.forEach((tab, index) => {
			const tabId = `${this.blockId}-tab-${index}`;
			const panelId = `${this.blockId}-panel-${index}`;
			const button = createElement(tabList, "button", "tabsdown__tab");
			button.type = "button";
			button.id = tabId;
			const labelTokens = parseInlineLabel(tab.label);
			const separator = createElement(button, "span", "tabsdown__separator");
			separator.setAttribute("aria-hidden", "true");
			separator.hidden = true;
			const content = createElement(button, "span", "tabsdown__tab-content");
			if (tab.icon) {
				const icon = createElement(content, "span", "tabsdown__tab-icon");
				icon.setAttribute("aria-hidden", "true");
				setIcon(icon, tab.icon);
			}
			const label = createElement(content, "span", "tabsdown__tab-label");
			renderLabel(label, labelTokens);
			const reserve = createElement(content, "span", "tabsdown__tab-reserve");
			reserve.setAttribute("aria-hidden", "true");
			if (tab.icon) reserve.classList.add("tabsdown__tab-reserve--icon");
			renderLabel(reserve, labelTokens);
			button.setAttribute("role", "tab");
			button.setAttribute("aria-controls", panelId);

			const panel = createElement(panels, "div", "tabsdown__panel");
			panel.id = panelId;
			panel.setAttribute("role", "tabpanel");
			panel.setAttribute("aria-labelledby", tabId);

			this.buttons.push(button);
			this.panels.push({
				panelEl: panel,
				epoch: 0,
				status: "unrendered",
			});
			tabList.append(button);
			panels.append(panel);

			this.registerDomEvent(button, "click", () => {
				this.activate(index, true);
			});
			this.registerDomEvent(button, "keydown", (event) => {
				this.onKeyDown(event, index);
			});
			this.registerDomEvent(button, "focus", () => {
				this.focusIndex = index;
				this.updateState();
			});
			if (this.editing) {
				this.registerDomEvent(button, "dblclick", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.editLabel(button, this.editing!.open(button, () => !this.disposed), index);
				});
			}
		});

		const available = () => !this.disposed;
		if (this.editing) {
			addBlockSettingsContextMenu(
					this.containerEl,
					this.options,
					async (trigger, menuAvailable) => {
						const save = await this.editing!.open(trigger, menuAvailable);
						return async (options) => {
							if (!menuAvailable()) throw new Error("This Tabsdown block is no longer available.");
							await save(options);
						};
					},
					available,
					(element, type, callback) => this.registerDomEvent(element, type, callback),
					(menu) => {
						this.menus.add(menu);
						menu.onHide(() => this.menus.delete(menu));
					},
					(trigger, save, index) => this.editLabel(trigger, save, index),
					(trigger, save, index) => { void this.deleteTab(trigger, save, index); },
				);
		}
		this.containerEl.append(tabList, panels);
		this.separators = trackSeparators(tabList, () => Array.from(tabList.children)
			.filter((element): element is HTMLElement => element.classList.contains("tabsdown__tab")));
		this.updateState();
		const restorePendingFocus = (): boolean => {
			const pending = this.editing?.pendingFocus?.();
			if (!pending || !this.focusTab(pending.focusIndex, pending.selectedIndex)) return false;
			pending.consume();
			return true;
		};
		const restored = restorePendingFocus();
		queueMicrotask(restorePendingFocus);
		const view = this.containerEl.ownerDocument.defaultView;
		if (view) {
			const frame = view.requestAnimationFrame(restorePendingFocus);
			this.register(() => view.cancelAnimationFrame(frame));
		}
		if (!restored) this.ensureRendered(0);
	}

	private editLabel(trigger: HTMLElement, prepared: Promise<SaveBlockSettings>, index?: number): void {
		// Attach rejection handling immediately, even if editing is cancelled before Enter.
		const ready = prepared.then((save) => ({ save }), (error: unknown) => ({ error }));
		if (this.disposed || !this.editing) return;
		this.closeLabelEditor();
		let anchor = index === undefined ? undefined : this.buttons[index];
		if (index !== undefined && !anchor) return;
		if (!anchor) {
			const list = this.containerEl.querySelector<HTMLElement>(":scope > .tabsdown__tablist")!;
			const draft = list.createEl("button", { cls: "tabsdown__tab" });
			draft.type = "button";
			draft.tabIndex = -1;
			draft.id = `${this.blockId}-draft`;
			draft.textContent = "New tab";
			draft.setAttribute("aria-hidden", "true");
			this.draft = draft;
			anchor = draft;
			draft.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
		}
		const rawLabel = index === undefined ? "" : this.editing.labels[index]!;
		const iconPrefix = /^icon:\S+\s*/.exec(rawLabel)?.[0] ?? "";
		const editor = new TabLabelEditor(anchor, rawLabel.slice(iconPrefix.length),
			index === undefined, async (label) => {
				const result = await ready;
				if ("error" in result) throw result.error;
				if (this.disposed || this.labelEditor !== editor) return;
				this.editing?.requestFocus?.(index ?? this.focusIndex, this.selectedIndex);
				await result.save(index === undefined ? { type: "add", label } : { type: "rename", index, label: iconPrefix + label });
			}, (restoreFocus) => {
				this.closeLabelEditor();
				if (restoreFocus && !this.disposed) {
					const target = index === undefined ? this.buttons[this.focusIndex] : this.buttons[index];
					(target ?? trigger).focus({ preventScroll: true });
				}
			});
		this.labelEditor = editor;
		this.addChild(editor);
	}

	private async deleteTab(trigger: HTMLElement, prepared: Promise<SaveBlockSettings>, index: number): Promise<void> {
		const ready = prepared.then((save) => ({ save }), (error: unknown) => ({ error }));
		if (this.disposed || !this.editing || this.buttons.length <= 2) return;
		this.closeLabelEditor();
		this.deleteDialog?.close();
		const dialog = new DeleteTabModal(this.app, this.editing.labels[index]!);
		this.deleteDialog = dialog;
		const confirmed = await dialog.confirm();
		if (this.deleteDialog !== dialog) return;
		this.deleteDialog = undefined;
		if (this.disposed) return;
		if (!confirmed) {
			trigger.focus({ preventScroll: true });
			return;
		}
		try {
			const result = await ready;
			if ("error" in result) throw result.error;
			if (this.disposed) return;
			const remap = (current: number): number => current > index ? current - 1
				: current === index ? Math.min(index, this.buttons.length - 2) : current;
			this.editing.requestFocus?.(remap(this.focusIndex), remap(this.selectedIndex));
			await result.save({ type: "delete", index });
		} catch (error) {
			new Notice(errorMessage(error));
			if (!this.disposed) trigger.focus({ preventScroll: true });
		}
	}

	focusTab(focusIndex: number, selectedIndex: number): boolean {
		const button = this.buttons[focusIndex];
		if (
			this.disposed ||
			!this.containerEl.isConnected ||
			!button ||
			!this.panels[selectedIndex]
		) return false;
		this.focusIndex = focusIndex;
		this.selectedIndex = selectedIndex;
		this.updateState();
		this.ensureRendered(selectedIndex);
		button.focus({ preventScroll: true });
		return button.ownerDocument.activeElement === button;
	}

	private closeLabelEditor(): void {
		const editor = this.labelEditor;
		this.labelEditor = undefined;
		if (editor) this.removeChild(editor);
		this.draft?.remove();
		this.draft = undefined;
	}

	private applyNestingClass(): void {
		this.containerEl.classList.remove(
			"tabsdown--nested-odd",
			"tabsdown--nested-even",
		);
		const parent = this.containerEl.parentElement?.closest(".tabsdown");
		if (!parent) return;

		this.containerEl.classList.add(
			parent.classList.contains("tabsdown--nested-odd")
				? "tabsdown--nested-even"
				: "tabsdown--nested-odd",
		);
	}

	private resolveConfiguration(): TabConfiguration[] {
		let position: TabConfiguration = "top";
		let layout: TabConfiguration = "one";
		for (const configuration of this.configuration) {
			if (["top", "left", "right", "bottom"].includes(configuration)) {
				position = configuration;
			} else {
				layout = configuration;
			}
		}
		return [position, layout];
	}

	onunload(): void {
		this.disposed = true;
		this.deleteDialog?.close();
		this.deleteDialog = undefined;
		this.closeLabelEditor();
		for (const menu of this.menus) menu.close();
		this.menus.clear();
		this.height?.destroy();
		this.separators?.destroy();
		for (const panel of this.panels) {
			this.disposePanel(panel);
		}
	}

	private onKeyDown(event: KeyboardEvent, index: number): void {
		let nextIndex: number | undefined;

		switch (event.key) {
			case "ArrowRight":
				nextIndex = (index + 1) % this.tabs.length;
				break;
			case "ArrowLeft":
				nextIndex = (index - 1 + this.tabs.length) % this.tabs.length;
				break;
			case "Home":
				nextIndex = 0;
				break;
			case "End":
				nextIndex = this.tabs.length - 1;
				break;
			case "Enter":
			case " ":
				event.preventDefault();
				this.activate(index, true);
				return;
			default:
				return;
		}

		event.preventDefault();
		this.focusIndex = nextIndex;
		this.updateState();
		this.buttons[nextIndex]?.focus();
		this.scrollTabIntoView(nextIndex);
	}

	private activate(index: number, focus: boolean): void {
		const wasSelected = index === this.selectedIndex;
		// Read before the outgoing panel is hidden: this is the height the box
		// animates away from, and the floor a still-loading panel cannot fall below.
		const previousHeight = this.panelsEl?.getBoundingClientRect().height ?? 0;
		this.selectedIndex = index;
		this.focusIndex = index;
		this.updateState();
		this.ensureRendered(index, !wasSelected);
		if (!wasSelected) {
			this.height?.switched(previousHeight);
		}
		if (focus) {
			this.buttons[index]?.focus();
		}
		this.scrollTabIntoView(index);
	}

	private updateState(): void {
		this.buttons.forEach((button, index) => {
			button.tabIndex = index === this.focusIndex ? 0 : -1;
			button.setAttribute(
				"aria-selected",
				index === this.selectedIndex ? "true" : "false",
			);
		});
		this.panels.forEach((panel, index) => {
			panel.panelEl.hidden = index !== this.selectedIndex;
		});
	}

	private scrollTabIntoView(index: number): void {
		this.buttons[index]?.scrollIntoView?.({
			block: "nearest",
			inline: "nearest",
		});
	}

	private ensureRendered(index: number, rebuildStale = false): void {
		const tab = this.tabs[index];
		const state = this.panels[index];
		if (!tab || !state || this.disposed) {
			return;
		}

		const generation = this.getGeneration();
		if (state.component) {
			if (
				state.generation === generation &&
				(state.status === "rendering" || state.status === "rendered")
			) {
				return;
			}
			if (state.generation !== generation && !rebuildStale) {
				return;
			}
		}

		this.disposePanel(state);
		const epoch = ++state.epoch;
		const component = this.addChild(new Component());
		const attemptEl = createElement(state.panelEl, "div", "tabsdown__content");
		this.editing?.registerPanel(attemptEl, index);
		state.panelEl.replaceChildren(attemptEl);
		state.component = component;
		state.attemptEl = attemptEl;
		state.generation = generation;
		state.status = "rendering";

		void MarkdownRenderer.render(
			this.app,
			tab.body,
			attemptEl,
			this.sourcePath,
			component,
		)
			.then(() => {
				if (this.disposed || state.epoch !== epoch) {
					return;
				}
				state.status = "rendered";
				this.height?.refresh();
			})
			.catch((error: unknown) => {
				if (this.disposed || state.epoch !== epoch) {
					return;
				}
				if (state.component) {
					this.removeChild(state.component);
					state.component = undefined;
				}
				attemptEl.replaceChildren();
				const message = createElement(attemptEl, "div", "tabsdown__panel-error");
				message.setAttribute("role", "alert");
				message.textContent = `This tab could not be rendered: ${errorMessage(error)}`;
				attemptEl.append(message);
				state.status = "error";
				this.height?.refresh();
			});
	}

	private disposePanel(state: PanelState): void {
		state.epoch += 1;
		if (state.component) {
			this.removeChild(state.component);
			state.component = undefined;
		}
		state.attemptEl?.remove();
		state.attemptEl = undefined;
		state.status = "unrendered";
	}
}
