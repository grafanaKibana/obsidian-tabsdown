import { App, Menu, Modal, Notice, Setting } from "obsidian";
import type { TabsdownConfig } from "./config";

export type SaveBlockSettings = (options: TabsdownConfig) => Promise<void>;

const fields = [
	["Position", "position", [
		["", "Inherit (Top)"], ["top", "Top"], ["bottom", "Bottom"],
		["left", "Left"], ["right", "Right"],
	]],
	["Overflow", "layout", [
		["", "Inherit global Overflow"], ["one", "Scroll — one row"],
		["multi", "Wrap — multiple rows"],
	]],
	["Density", "density", [
		["", "Automatic / inherit global Size"], ["default", "Default"],
		["compact", "Compact"],
	]],
	["Personality", "personality", [
		["", "Inherit position / global Personality"], ["button", "Button"],
		["underline", "Underline"], ["separator", "Separator"], ["rail", "Rail"],
	]],
	["Palette", "palette", [
		["", "Inherit position / global Palette"], ["primary", "Primary"],
		["secondary", "Secondary"],
	]],
	["Alignment", "alignment", [
		["", "Inherit position / global Alignment"], ["start", "Start"],
		["center", "Center"], ["equal-width", "Equal width"],
	]],
] as const;

export class BlockSettingsModal extends Modal {
	private pending = false;
	private closed = false;
	private committed = false;

	constructor(
		app: App,
		private readonly initial: TabsdownConfig,
		private readonly save: SaveBlockSettings,
		private readonly trigger: HTMLElement,
		private readonly cancel: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Tabsdown block settings");
		const values: TabsdownConfig = { ...this.initial };
		for (const [label, key, options] of fields) {
			new Setting(this.contentEl).setName(label).addDropdown((dropdown) => {
				for (const [value, name] of options) dropdown.addOption(value, name);
				dropdown.setValue(values[key] ?? "");
				dropdown.selectEl.setAttribute("aria-label", label);
				dropdown.onChange((value) => {
					if (value === "") delete values[key];
					else Object.assign(values, { [key]: value });
				});
			});
		}

		const actions = new Setting(this.contentEl);
		let cancelButton!: HTMLButtonElement;
		actions.addButton((button) => {
			cancelButton = button.buttonEl;
			button.setButtonText("Cancel").onClick(() => this.close());
		});
		actions.addButton((button) => {
			button.setButtonText("Save").setCta().onClick(async () => {
				if (this.pending) return;
				this.pending = true;
				cancelButton.disabled = true;
				button.setDisabled(true);
				try {
					await this.save(values);
					this.committed = true;
					if (!this.closed) super.close();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : String(error));
					this.pending = false;
					cancelButton.disabled = false;
					button.setDisabled(false);
				}
			});
		});
	}

	close(): void {
		if (!this.pending && !this.closed) super.close();
	}

	onClose(): void {
		this.closed = true;
		if (!this.committed) this.cancel();
		this.contentEl.empty();
		if (this.trigger.isConnected) this.trigger.focus();
	}
}

export function addBlockSettingsContextMenu(
	app: App,
	parent: HTMLElement,
	options: TabsdownConfig,
	open: (
		trigger: HTMLElement,
		available: () => boolean,
	) => Promise<SaveBlockSettings>,
	available: () => boolean,
	register: (element: HTMLElement, type: "contextmenu", callback: EventListener) => void,
	ownMenu: (menu: Menu) => void,
	ownModal: (modal: BlockSettingsModal) => void,
): void {
	register(parent, "contextmenu", (event) => {
		if (!(event instanceof MouseEvent)) return;
		const target = event.target instanceof Element
			? event.target.closest<HTMLElement>(".tabsdown")
			: null;
		if (target !== parent) return;
		event.preventDefault();
		event.stopPropagation();
		const trigger = event.target instanceof HTMLElement ? event.target : parent;
		const menu = new Menu()
			.setParentElement(parent)
			.addItem((item) => item.setTitle("Configure block…").onClick(async () => {
				try {
					let cancelled = false;
					const modalAvailable = (): boolean => available() && !cancelled;
					const save = await open(trigger, modalAvailable);
					if (!available()) throw new Error("This Tabsdown block is no longer available.");
					const modal = new BlockSettingsModal(
						app,
						options,
						save,
						trigger,
						() => { cancelled = true; },
					);
					ownModal(modal);
					modal.open();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : String(error));
				}
			}));
		ownMenu(menu);
		if (event.clientX !== 0 || event.clientY !== 0) {
			menu.showAtMouseEvent(event);
		} else {
			const rect = trigger.getBoundingClientRect();
			menu.showAtPosition(
				{ x: rect.left, y: rect.bottom, width: rect.width },
				trigger.ownerDocument,
			);
		}
	});
}
