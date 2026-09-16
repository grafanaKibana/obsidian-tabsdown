import { Menu, type MenuItem, Notice } from "obsidian";
import type { KeyedConfigName, TabsdownConfig } from "./config";
import type { TabEdit } from "./source";

export type SaveBlockSettings = (options: TabsdownConfig | TabEdit) => Promise<void>;

export const INTERACTIVE_SELECTOR =
	'a, audio, button, iframe, input, label, select, summary, textarea, video, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="switch"]';

const fields = [
	["Position", "position", [
		["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"],
	]],
	["Overflow", "layout", [
		["one", "Scroll — one row"], ["multi", "Wrap — multiple rows"],
	]],
	["Density", "density", [
		["default", "Default"], ["compact", "Compact"],
	]],
	["Personality", "personality", [
		["button", "Button"], ["underline", "Underline"],
		["separator", "Separator"], ["rail", "Rail"],
	]],
	["Palette", "palette", [
		["primary", "Primary"], ["secondary", "Secondary"],
	]],
	["Alignment", "alignment", [
		["start", "Start"], ["center", "Center"], ["equal-width", "Equal width"],
	]],
] as const;

const icons: Record<string, string> = {
	position: "panel-top", top: "panel-top", bottom: "panel-bottom",
	left: "panel-left", right: "panel-right", layout: "wrap-text",
	one: "move-horizontal", multi: "wrap-text", density: "between-horizontal-start",
	default: "maximize-2", compact: "minimize-2", personality: "shapes",
	button: "rectangle-horizontal", underline: "underline", separator: "columns-2",
	rail: "panel-top", palette: "palette", primary: "circle", secondary: "circle-dashed",
	alignment: "align-horizontal-justify-start", start: "align-horizontal-justify-start",
	center: "align-horizontal-justify-center", "equal-width": "columns-3",
};

/**
 * What an omitted setting resolves to. `styles.css` publishes the answer as a
 * custom property so this never re-derives the cascade; only Position has no
 * stylesheet source, and no built-in value shows before the stylesheet loads.
 */
const builtIn: Record<KeyedConfigName, string> = {
	position: "top",
	layout: "one",
	density: "default",
	personality: "button",
	palette: "primary",
	alignment: "start",
};

function inheritedTitle(
	parent: HTMLElement,
	key: KeyedConfigName,
	titles: ReadonlyMap<string, string>,
): string {
	const tab = parent.querySelector(":scope > .tabsdown__tablist > .tabsdown__tab");
	const view = parent.ownerDocument.defaultView;
	const resolved = tab && view
		? view.getComputedStyle(tab).getPropertyValue(`--tabsdown-resolved-${key}`).trim()
		: "";
	return titles.get(resolved) ?? titles.get(builtIn[key]) ?? "";
}

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
	editLabel?: (trigger: HTMLElement, save: Promise<SaveBlockSettings>, index?: number) => void,
	deleteTab?: (trigger: HTMLElement, save: Promise<SaveBlockSettings>, index: number) => void,
): void {
	let pending = false;
	register(parent, "contextmenu", (event) => {
		const view = parent.ownerDocument.defaultView;
		if (!view || !(event instanceof view.MouseEvent)) return;
		const eventTarget = event.target instanceof view.Element ? event.target : null;
		if (!eventTarget || eventTarget.closest(".tabsdown") !== parent) return;
		if (eventTarget.closest(".tabsdown-label-editor__input")) return;
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
		if (editLabel) {
			const save = (): Promise<SaveBlockSettings> => prepared.then((result) => {
				if ("error" in result) throw result.error;
				return result.save;
			});
			menu.addItem((item) => item.setTitle("Add tab").setIcon("plus").onClick(() => {
				if (available()) editLabel(trigger, save());
			}));
			const button = eventTarget.closest(".tabsdown__tab");
			const buttons = Array.from(parent.querySelectorAll(":scope > .tabsdown__tablist > [role=tab]"));
			const index = button ? buttons.indexOf(button) : -1;
			if (index >= 0) {
				menu.addItem((item) => item.setTitle("Rename tab").setIcon("pencil").onClick(() => {
					if (available()) editLabel(trigger, save(), index);
				}));
				if (deleteTab) {
					menu.addItem((item) => item.setTitle("Delete tab").setIcon("trash-2")
						.setWarning(true).setDisabled(buttons.length <= 2).onClick(() => {
							if (available() && buttons.length > 2) deleteTab(trigger, save(), index);
						}));
				}
			}
			menu.addSeparator();
		}
		for (const [label, key, choices] of fields) {
			const titles = new Map<string, string>(choices);
			const values: [
				readonly [string, string],
				...Array<readonly [string, string]>,
			] = [
				["", `Inherit (${inheritedTitle(parent, key, titles)})`],
				...choices,
			];
			menu.addItem((item) => {
				const addChoice = (
					choice: MenuItem,
					value: string,
					title: string,
					prefix = "",
				): void => {
						choice.setTitle(`${prefix}${title}`);
						choice.setIcon(value === "" ? "undo-2" : icons[value] ?? icons[key]!);
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
					item.setIcon(icons[key]!);
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
