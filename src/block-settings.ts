import { App, Menu, Modal, Notice, Setting, setIcon } from "obsidian";
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
		private readonly trigger: HTMLButtonElement,
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

export function addBlockSettingsTrigger(
	app: App,
	parent: HTMLElement,
	options: TabsdownConfig,
	open: (
		trigger: HTMLButtonElement,
		available: () => boolean,
	) => Promise<SaveBlockSettings>,
	available: () => boolean,
	register: (element: HTMLElement, type: "click", callback: EventListener) => void,
	ownMenu: (menu: Menu) => void,
	ownModal: (modal: BlockSettingsModal) => void,
): HTMLButtonElement {
	const trigger = parent.createEl("button", { cls: "tabsdown__options" });
	trigger.type = "button";
	trigger.setAttribute("aria-label", "Tabsdown block options");
	trigger.setAttribute("aria-haspopup", "menu");
	setIcon(trigger, "ellipsis");
	register(trigger, "click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		const menu = new Menu()
			.setParentElement(trigger)
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
		const mouseEvent = event as MouseEvent;
		if (mouseEvent.detail > 0) {
			menu.showAtMouseEvent(mouseEvent);
		} else {
			const rect = trigger.getBoundingClientRect();
			menu.showAtPosition(
				{ x: rect.left, y: rect.bottom, width: rect.width },
				trigger.ownerDocument,
			);
		}
	});
	return trigger;
}
