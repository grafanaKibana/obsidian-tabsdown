import { Menu, type MenuItem, Notice } from "obsidian";
import type { TabsdownConfig } from "./config";

export type SaveBlockSettings = (options: TabsdownConfig) => Promise<void>;

export const INTERACTIVE_SELECTOR =
	'a, audio, button, iframe, input, label, select, summary, textarea, video, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="switch"]';

const fields = [
	["Position", "position", [
		["", "Inherit (Top)"], ["top", "Top"], ["bottom", "Bottom"],
		["left", "Left"], ["right", "Right"],
	]],
	["Overflow", "layout", [
		["", "Inherit (Overflow behavior)"], ["one", "Scroll — one row"],
		["multi", "Wrap — multiple rows"],
	]],
	["Density", "density", [
		["", "Inherit (Size)"], ["default", "Default"],
		["compact", "Compact"],
	]],
	["Personality", "personality", [
		["", "Inherit (Personality)"], ["button", "Button"],
		["underline", "Underline"], ["separator", "Separator"], ["rail", "Rail"],
	]],
	["Palette", "palette", [
		["", "Inherit (Palette)"], ["primary", "Primary"],
		["secondary", "Secondary"],
	]],
	["Alignment", "alignment", [
		["", "Inherit (Alignment)"], ["start", "Start"],
		["center", "Center"], ["equal-width", "Equal width"],
	]],
] as const;

interface MenuItemWithSubmenu extends MenuItem {
	setSubmenu(): Menu;
}

function restoreScroll(
	parent: HTMLElement,
	doc: Document,
): () => void {
	const scroller = parent.closest<HTMLElement>(".cm-scroller, .markdown-preview-view")
		?? doc.scrollingElement;
	const top = scroller?.scrollTop ?? 0;
	const left = scroller?.scrollLeft ?? 0;
	return () => {
		if (!scroller) return;
		scroller.scrollTop = top;
		scroller.scrollLeft = left;
	};
}

export function addBlockSettingsContextMenu(
	parent: HTMLElement,
	options: TabsdownConfig,
	open: (
		trigger: HTMLElement,
		available: () => boolean,
	) => Promise<SaveBlockSettings>,
	available: () => boolean,
	register: (element: HTMLElement, type: "contextmenu", callback: EventListener) => void,
	ownMenu: (menu: Menu) => void,
): void {
	let pending = false;
	register(parent, "contextmenu", (event) => {
		const view = parent.ownerDocument.defaultView;
		if (!view || !(event instanceof view.MouseEvent)) return;
		const eventTarget = event.target instanceof view.Element ? event.target : null;
		if (!eventTarget || eventTarget.closest(".tabsdown") !== parent) return;
		const interactive = eventTarget.closest(INTERACTIVE_SELECTOR);
		const panel = eventTarget.closest(".tabsdown__panel");
		if (interactive && panel?.closest(".tabsdown") === parent) return;
		event.preventDefault();
		event.stopPropagation();
		const trigger = eventTarget.closest<HTMLElement>("button, .tabsdown") ?? parent;
		const prepared = open(trigger, available).then(
			(save) => ({ save }),
			(error: unknown) => ({ error }),
		);
		const menu = new Menu().setParentElement(parent);
		for (const [label, key, values] of fields) {
			menu.addItem((item) => {
				const addChoice = (
					choice: MenuItem,
					value: string,
					title: string,
					prefix = "",
				): void => {
						choice.setTitle(`${prefix}${title}`);
						choice.setChecked((options[key] ?? "") === value);
						choice.onClick(async () => {
							if (pending || (options[key] ?? "") === value) return;
							pending = true;
							const restore = restoreScroll(parent, trigger.ownerDocument);
							try {
								const result = await prepared;
								if ("error" in result) throw result.error;
								if (!available()) {
									throw new Error("This Tabsdown block is no longer available.");
								}
								const next = { ...options };
								if (value === "") delete next[key];
								else Object.assign(next, { [key]: value });
								await result.save(next);
								if (value === "") delete options[key];
								else Object.assign(options, { [key]: value });
							} catch (error) {
								new Notice(error instanceof Error ? error.message : String(error));
							} finally {
								restore();
								trigger.ownerDocument.defaultView?.requestAnimationFrame(restore);
								pending = false;
							}
						});
				};
				const setSubmenu = (item as Partial<MenuItemWithSubmenu>).setSubmenu;
				if (typeof setSubmenu === "function") {
					item.setTitle(label);
					const submenu = setSubmenu.call(item);
					for (const [value, title] of values) {
						submenu.addItem((choice) => addChoice(choice, value, title));
					}
					return;
				}
				const [[value, title], ...remaining] = values;
				addChoice(item, value, title, `${label}: `);
				for (const [remainingValue, remainingTitle] of remaining) {
					menu.addItem((choice) => addChoice(
						choice,
						remainingValue,
						remainingTitle,
						`${label}: `,
					));
				}
			});
		}
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
