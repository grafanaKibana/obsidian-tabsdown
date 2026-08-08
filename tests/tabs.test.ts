import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { trackPanelHeight } from "../src/panel-height";
import { mountTabs, type TabSpec, type TabsController } from "../src/tabs";
import {
	stubMutationObserver,
	stubPanelHeights,
	stubResizeObserver,
} from "./panel-size";

function panel(text: string): HTMLElement {
	const element = document.createElement("div");
	element.textContent = text;
	return element;
}

function setup(
	options: {
		selection?: string | null;
		onSelectionChange?: (
			selection: string | null,
			previous: string | null,
		) => void;
		panels?: HTMLElement[];
	} = {},
): {
	container: HTMLElement;
	controller: TabsController;
	tabs: TabSpec[];
	buttons: HTMLButtonElement[];
	panelsEl: HTMLElement;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const [trace, watch] = options.panels ?? [panel("Trace"), panel("Watch")];
	const tabs: TabSpec[] = [
		{ id: "trace", label: "Trace", panel: trace as HTMLElement },
		{ id: "watch", label: "Watch", panel: watch as HTMLElement },
	];
	const controller = mountTabs(container, {
		tabs,
		label: "Trace and watch",
		...(options.selection !== undefined
			? { selection: options.selection }
			: {}),
		...(options.onSelectionChange
			? { onSelectionChange: options.onSelectionChange }
			: {}),
	});
	const buttons = Array.from(
		container.querySelectorAll<HTMLButtonElement>(".tabsdown__tab"),
	);
	const panelsEl = container.querySelector<HTMLElement>(".tabsdown__panels");
	if (!panelsEl) throw new Error("Expected a panels wrapper.");
	return { container, controller, tabs, buttons, panelsEl };
}

function visible(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			".tabsdown__panel:not([hidden])",
		),
	);
}

// Mount ids come from a module counter, so the only way to know what the next
// mount will generate is to spend one.
function nextMountNumber(): number {
	const scratch = panel("Scratch");
	const controller = mountTabs(document.createElement("div"), {
		label: "Probe",
		tabs: [{ id: "probe", label: "Probe", panel: scratch }],
	});
	const current = Number(/mount-(\d+)-/.exec(scratch.id)?.[1]);
	controller.destroy();
	return current + 1;
}

beforeEach(() => {
	vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
});

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe("selection", () => {
	test("formats labels synchronously and derives the group name", () => {
		const container = document.createElement("div");
		const controller = mountTabs(container, {
			label: "**Trace** details",
			tabs: [
				{
					id: "trace",
					label: "**Strong** *em* ~~old~~ `code` [link](url)",
					panel: panel("Trace"),
				},
				{ id: "literal", label: "****", panel: panel("Literal") },
			],
		});
		const labels = container.querySelectorAll<HTMLElement>(".tabsdown__tab-label");

		expect(container.querySelector(".tabsdown__tablist")?.getAttribute("aria-label")).toBe("Trace details");
		expect(labels[0]?.innerHTML).toBe(
			"<strong>Strong</strong> <em>em</em> <del>old</del> <code>code</code> [link](url)",
		);
		expect(labels[0]?.querySelector("a, img, script")).toBeNull();
		expect(labels[1]?.textContent).toBe("****");
		const reserve = labels[0]?.closest("button")?.querySelector<HTMLElement>(
			".tabsdown__tab-reserve",
		);
		expect(reserve?.innerHTML).toBe(labels[0]?.innerHTML);
		expect(reserve?.getAttribute("aria-hidden")).toBe("true");
		expect(reserve?.parentElement?.classList.contains("tabsdown__tab-content")).toBe(true);
		expect(controller.selection).toBeNull();
	});

	test("keeps delimiter-only names nonblank and derived duplicates allowed", () => {
		for (const groupLabel of ["****", "** **", "~~~~", "``"]) {
			const container = document.createElement("div");
			const controller = mountTabs(container, {
				label: groupLabel,
				tabs: [
					{ id: "plain", label: "A", panel: panel("Plain") },
					{ id: "formatted", label: "**A**", panel: panel("Formatted") },
				],
			});
			expect(container.querySelector(".tabsdown__tablist")?.getAttribute("aria-label")).toBe(groupLabel);
			expect(
				Array.from(
					container.querySelectorAll(".tabsdown__tab-label"),
					(label) => label.textContent,
				),
			).toEqual(["A", "A"]);
			controller.destroy();
		}
	});

	test("activates API controls from every formatted descendant", () => {
		const container = document.createElement("div");
		const controller = mountTabs(container, {
			label: "Formatted",
			tabs: [
				{ id: "strong", label: "**Strong**", panel: panel("Strong") },
				{ id: "em", label: "*Em*", panel: panel("Em") },
				{ id: "delete", label: "~~Delete~~", panel: panel("Delete") },
				{ id: "code", label: "`Code`", panel: panel("Code") },
			],
		});

		for (const [id, selector] of [["strong", "strong"], ["em", "em"], ["delete", "del"], ["code", "code"]] as const) {
			container.querySelector<HTMLElement>(selector)?.click();
			expect(controller.selection).toBe(id);
		}
	});

	test("starts with nothing selected", () => {
		const { container, controller } = setup();
		const root = container.querySelector<HTMLElement>(".tabsdown--mounted");

		expect(controller.selection).toBeNull();
		expect(visible(container)).toHaveLength(0);
		expect(
			container.querySelectorAll('[aria-expanded="true"]'),
		).toHaveLength(0);
		expect(root?.classList.contains("tabsdown--collapsed")).toBe(true);
	});

	test("shows exactly the selected panel and no more than one", () => {
		const { container, buttons, tabs } = setup();

		buttons[0]?.click();
		expect(visible(container)).toEqual([tabs[0]?.panel]);
		expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");

		buttons[1]?.click();
		expect(visible(container)).toEqual([tabs[1]?.panel]);
		expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
	});

	test("collapses when the selected tab is activated again", () => {
		const changes: [string | null, string | null][] = [];
		const { container, controller, buttons } = setup({
			selection: "trace",
			onSelectionChange: (selection, previous) => {
				changes.push([selection, previous]);
			},
		});
		const root = container.querySelector<HTMLElement>(".tabsdown--mounted");
		expect(root?.classList.contains("tabsdown--collapsed")).toBe(false);

		buttons[0]?.click();

		expect(controller.selection).toBeNull();
		expect(visible(container)).toHaveLength(0);
		expect(changes).toEqual([[null, "trace"]]);
		expect(root?.classList.contains("tabsdown--collapsed")).toBe(true);
	});

	test("honours an external selection without notifying", () => {
		const onSelectionChange = vi.fn();
		const { container, controller, tabs } = setup({ onSelectionChange });

		controller.setSelection("watch");

		expect(controller.selection).toBe("watch");
		expect(visible(container)).toEqual([tabs[1]?.panel]);
		expect(onSelectionChange).not.toHaveBeenCalled();
	});

	test("ignores an unknown or unavailable selection", () => {
		const onSelectionChange = vi.fn();
		const { controller } = setup({ selection: "trace", onSelectionChange });

		controller.setSelection("nope");
		expect(controller.selection).toBe("trace");

		controller.setAvailable("watch", false);
		controller.setSelection("watch");
		expect(controller.selection).toBe("trace");
		expect(onSelectionChange).not.toHaveBeenCalled();
	});

	test("moves focus out of a panel before switching or collapsing", () => {
		const { container, controller, tabs, buttons } = setup({
			selection: "trace",
		});
		const traceInput = document.createElement("input");
		tabs[0]?.panel.append(traceInput);
		traceInput.focus();

		controller.setSelection("watch");

		expect(document.activeElement).toBe(buttons[1]);
		const watchInput = document.createElement("input");
		tabs[1]?.panel.append(watchInput);
		watchInput.focus();

		controller.setAvailable("watch", false);

		expect(document.activeElement).toBe(
			container.querySelector(".tabsdown--mounted"),
		);
	});
});

describe("availability", () => {
	test("hides an unavailable tab and collapses when it was selected", () => {
		const onSelectionChange = vi.fn();
		const { container, controller, buttons } = setup({
			selection: "watch",
			onSelectionChange,
		});
		vi.spyOn(buttons[0]!, "getBoundingClientRect").mockReturnValue({
			left: 0,
			right: 40,
			top: 0,
			bottom: 32,
			width: 40,
			height: 32,
		} as DOMRect);
		vi.spyOn(buttons[1]!, "getBoundingClientRect").mockReturnValue({
			left: 44,
			right: 84,
			top: 0,
			bottom: 32,
			width: 40,
			height: 32,
		} as DOMRect);

		controller.setAvailable("watch", false);

		expect(buttons[1]?.hidden).toBe(true);
		expect(controller.selection).toBeNull();
		expect(visible(container)).toHaveLength(0);
		expect(onSelectionChange).toHaveBeenCalledOnce();
		expect(onSelectionChange).toHaveBeenCalledWith(null, "watch");

		controller.setAvailable("watch", true);
		controller.setSelection("watch");
		expect(buttons[1]?.hidden).toBe(false);
		expect(buttons[1]?.querySelector<HTMLElement>(".tabsdown__separator")?.hidden).toBe(false);
		expect(controller.selection).toBe("watch");
	});

	test("moves focus off a button it is about to hide", () => {
		const { controller, buttons } = setup({ selection: "watch" });
		buttons[1]?.focus();
		expect(document.activeElement).toBe(buttons[1]);

		controller.setAvailable("watch", false);

		expect(document.activeElement).toBe(buttons[0]);
		expect(document.activeElement).not.toBe(document.body);
	});

	test("moves focus within a pop-out document", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const popup = frame.contentDocument;
		if (!popup) throw new Error("Expected an iframe document.");
		const popupWindow = popup.defaultView;
		if (!popupWindow) throw new Error("Expected an iframe window.");
		const setTimer = vi.spyOn(popupWindow, "setTimeout");
		const clearTimer = vi.spyOn(popupWindow, "clearTimeout");
		const popupResize = stubResizeObserver(popupWindow);
		const container = popup.createElement("div");
		let adoptionCount = 0;
		class TracePanel extends popupWindow.HTMLElement {
			adoptedCallback(): void {
				adoptionCount += 1;
			}
		}
		popupWindow.customElements.define("tabsdown-trace-panel", TracePanel);
		const trace = popup.createElement("tabsdown-trace-panel");
		const watch = popup.createElement("div");
		popup.body.append(container);
		const controller = mountTabs(container, {
			label: "**Trace** and watch",
			selection: "watch",
			tabs: [
				{ id: "trace", label: "**Trace**", panel: trace },
				{ id: "watch", label: "`Watch`", panel: watch },
			],
		});
		const buttons = container.querySelectorAll<HTMLButtonElement>("button");
		expect(container.querySelector(".tabsdown__tablist")?.getAttribute("aria-label")).toBe("Trace and watch");
		const created = container.querySelectorAll(
			".tabsdown--mounted, .tabsdown__tablist, button, .tabsdown__separator, .tabsdown__tab-label, strong, code",
		);
		for (const element of Array.from(created)) {
			expect(element.ownerDocument).toBe(popup);
		}
		buttons[1]?.focus();

		controller.setAvailable("watch", false);

		expect(popup.activeElement).toBe(buttons[0]);
		expect(adoptionCount).toBe(0);
		// Everything the tracker schedules has to belong to the pop-out window;
		// the main window's timers do not run on this document's frames.
		expect(setTimer).toHaveBeenCalled();
		buttons[0]?.click();
		// The visible panel is observed in its own pop-out window rather than the
		// main window, whose timers and ResizeObserver cannot follow it.
		expect(popupResize.observed()).toEqual([
			container.querySelector(".tabsdown__tablist"),
			...Array.from(buttons),
			trace,
		]);
		expect(adoptionCount).toBe(0);
		controller.destroy();
		expect(clearTimer).toHaveBeenCalled();
		expect(popupResize.observed()).toHaveLength(0);
		popupResize.restore();
	});

	test("moves focus forward from a hidden tab and wraps at the end", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const controller = mountTabs(container, {
			label: "Three panels",
			tabs: [
				{ id: "first", label: "First", panel: panel("First") },
				{ id: "middle", label: "Middle", panel: panel("Middle") },
				{ id: "last", label: "Last", panel: panel("Last") },
			],
		});
		const buttons = container.querySelectorAll<HTMLButtonElement>("button");
		buttons[1]?.focus();

		controller.setAvailable("middle", false);

		expect(document.activeElement).toBe(buttons[2]);
		buttons[2]?.focus();

		controller.setAvailable("last", false);

		expect(document.activeElement).toBe(buttons[0]);
	});

	test("falls back to the root when no other tab remains", () => {
		const { container, controller, buttons } = setup({
			selection: "trace",
		});
		controller.setAvailable("watch", false);
		buttons[0]?.focus();

		controller.setAvailable("trace", false);

		expect(document.activeElement).toBe(
			container.querySelector(".tabsdown--mounted"),
		);
	});

	test("settles before a reentrant callback and notifies only once", () => {
		const seen: (string | null)[] = [];
		let controller: TabsController | undefined;
		const mounted = setup({
			selection: "trace",
			onSelectionChange: (selection) => {
				seen.push(selection);
				controller?.setAvailable("trace", false);
			},
		});
		controller = mounted.controller;

		mounted.buttons[0]?.click();

		expect(seen).toEqual([null]);
		expect(controller.selection).toBeNull();
	});
});

describe("keyboard and roles", () => {
	test("uses disclosure semantics rather than a tablist", () => {
		const { container, tabs, buttons } = setup();

		expect(container.querySelector('[role="tablist"]')).toBeNull();
		expect(container.querySelector('[role="region"]')).toBeNull();
		expect(
			container.querySelector(".tabsdown__tablist")?.getAttribute("role"),
		).toBe("group");
		for (const [index, tab] of tabs.entries()) {
			expect(tab.panel.getAttribute("role")).toBe("group");
			expect(tab.panel.getAttribute("aria-labelledby")).toBe(
				buttons[index]?.id,
			);
			expect(buttons[index]?.getAttribute("aria-controls")).toBe(
				tab.panel.id,
			);
			expect(tab.panel.tabIndex).toBe(0);
		}
	});

	test("leaves activation to the native button and keeps focus on it", () => {
		const { controller, buttons } = setup();
		const button = buttons[0];
		if (!button) throw new Error("Expected a button.");

		// Enter and Space are the browser's job: jsdom fires no click for
		// them, so the contract worth pinning is that nothing intercepts them.
		expect(button.type).toBe("button");
		button.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(controller.selection).toBeNull();

		button.focus();
		button.click();
		expect(controller.selection).toBe("trace");
		expect(document.activeElement).toBe(button);
	});

	test("gives every mount its own ids", () => {
		const first = setup();
		const second = setup();

		for (const mounted of [first, second]) {
			for (const [index, tab] of mounted.tabs.entries()) {
				const labelledBy =
					tab.panel.getAttribute("aria-labelledby") ?? "";
				expect(mounted.container.querySelector(`#${labelledBy}`)).toBe(
					mounted.buttons[index],
				);
			}
		}
		expect(first.buttons[0]?.id).not.toBe(second.buttons[0]?.id);
	});
});

describe("animation and teardown", () => {
	test.each(["load", "error"] as const)(
		"holds the outgoing height until an incomplete root image emits %s",
		(terminalEvent) => {
			let complete = false;
			const image = document.createElement("img");
			Object.defineProperty(image, "complete", {
				configurable: true,
				get: () => complete,
			});
			const { container, buttons, panelsEl } = setup({
				selection: "trace",
				panels: [panel("Trace"), image],
			});
			const setHeight = stubPanelHeights(container, [240, 40]);

			buttons[1]?.click();
			expect(panelsEl.getBoundingClientRect().height).toBe(240);

			complete = true;
			const settledHeight = terminalEvent === "load" ? 300 : 40;
			setHeight(1, settledHeight);
			image.dispatchEvent(new Event(terminalEvent));
			expect(panelsEl.getBoundingClientRect().height).toBe(settledHeight);
		},
	);

	test("does not hold the outgoing height for a complete root image", () => {
		const image = document.createElement("img");
		Object.defineProperty(image, "complete", { value: true });
		const { container, buttons, panelsEl } = setup({
			selection: "trace",
			panels: [panel("Trace"), image],
		});
		stubPanelHeights(container, [240, 40]);

		buttons[1]?.click();

		expect(panelsEl.getBoundingClientRect().height).toBe(40);
	});

	test.each(["block-language-dataview", "internal-embed"])(
		"holds the outgoing height for a root %s until it fills",
		async (className) => {
			const query = document.createElement("div");
			query.className = className;
			const { container, buttons, panelsEl } = setup({
				selection: "trace",
				panels: [panel("Trace"), query],
			});
			const setHeight = stubPanelHeights(container, [240, 40]);

			buttons[1]?.click();
			expect(panelsEl.getBoundingClientRect().height).toBe(240);

			query.append(document.createElement("table"));
			setHeight(1, 80);
			await Promise.resolve();

			expect(panelsEl.getBoundingClientRect().height).toBe(80);
		},
	);

	test("reuses the switch floor when a placeholder appears asynchronously", async () => {
		const target = panel("Ready");
		const { container, buttons, panelsEl } = setup({
			selection: "trace",
			panels: [panel("Trace"), target],
		});
		const setHeight = stubPanelHeights(container, [240, 40]);

		buttons[1]?.click();
		expect(panelsEl.getBoundingClientRect().height).toBe(40);

		const query = target.appendChild(document.createElement("div"));
		query.className = "block-language-dataview";
		await Promise.resolve();
		expect(panelsEl.getBoundingClientRect().height).toBe(240);

		query.append(document.createElement("table"));
		setHeight(1, 80);
		await Promise.resolve();
		expect(panelsEl.getBoundingClientRect().height).toBe(80);
	});

	test("ignores pending resources suppressed inside the visible panel", () => {
		const target = panel("Visible content");
		const hidden = target.appendChild(document.createElement("div"));
		hidden.hidden = true;
		hidden.appendChild(document.createElement("div")).className =
			"block-language-dataview";
		const image = hidden.appendChild(document.createElement("img"));
		Object.defineProperty(image, "complete", { value: false });
		const displayNone = target.appendChild(document.createElement("div"));
		displayNone.style.display = "none";
		displayNone.appendChild(document.createElement("div")).className =
			"internal-embed";
		const skipped = target.appendChild(document.createElement("div"));
		skipped.style.contentVisibility = "hidden";
		skipped.appendChild(document.createElement("div")).className =
			"block-language-datacore";
		const details = target.appendChild(document.createElement("details"));
		details.appendChild(document.createElement("div")).className =
			"block-language-mermaid";
		const { container, buttons, panelsEl } = setup({
			selection: "trace",
			panels: [panel("Trace"), target],
		});
		stubPanelHeights(container, [240, 40]);

		buttons[1]?.click();

		expect(panelsEl.getBoundingClientRect().height).toBe(40);
	});

	test("tracks a boxless mounted panel when its async content fills", async () => {
		const resize = stubResizeObserver();
		const trace = panel("Trace");
		const boxless = panel("");
		boxless.style.display = "contents";
		const query = boxless.appendChild(document.createElement("div"));
		query.className = "block-language-dataview";
		const { container, buttons, panelsEl } = setup({
			selection: "trace",
			panels: [trace, boxless],
		});
		const setHeight = stubPanelHeights(container, [240, 40]);

		buttons[1]?.click();
		expect(panelsEl.getBoundingClientRect().height).toBe(240);
		expect(resize.observed()).toEqual([
			container.querySelector(".tabsdown__tablist"),
			...buttons,
			panelsEl,
			query,
		]);

		query.append(document.createElement("table"));
		setHeight(1, 80);
		await Promise.resolve();

		expect(panelsEl.getBoundingClientRect().height).toBe(80);
		resize.restore();
	});

	test("tracks pending content in an open shadow root", async () => {
		const host = panel("");
		const shadow = host.attachShadow({ mode: "open" });
		const image = shadow.appendChild(document.createElement("img"));
		let complete = false;
		Object.defineProperty(image, "complete", {
			configurable: true,
			get: () => complete,
		});
		const { buttons, panelsEl } = setup({
			selection: "trace",
			panels: [panel("Trace"), host],
		});
		let height = 40;
		vi.spyOn(host, "getBoundingClientRect").mockImplementation(
			() => ({ height }) as DOMRect,
		);
		vi.spyOn(panelsEl, "getBoundingClientRect").mockImplementation(() => {
			const pinned = Number.parseFloat(panelsEl.style.height);
			return {
				height: Number.isFinite(pinned) ? pinned : host.hidden ? 240 : height,
			} as DOMRect;
		});

		buttons[1]?.click();
		expect(panelsEl.getBoundingClientRect().height).toBe(240);

		height = 80;
		complete = true;
		image.dispatchEvent(new Event("load"));

		expect(panelsEl.getBoundingClientRect().height).toBe(80);
	});

	test("ignores slotted pending content under a hidden shadow ancestor", () => {
		const host = panel("");
		const shadow = host.attachShadow({ mode: "open" });
		const hidden = shadow.appendChild(document.createElement("div"));
		hidden.hidden = true;
		const slot = hidden.appendChild(document.createElement("slot"));
		slot.name = "pending";
		const query = host.appendChild(document.createElement("div"));
		query.className = "block-language-dataview";
		query.slot = "pending";
		const { container, buttons, panelsEl } = setup({
			selection: "trace",
			panels: [panel("Trace"), host],
		});
		stubPanelHeights(container, [240, 40]);

		expect(query.assignedSlot).toBe(slot);
		buttons[1]?.click();

		expect(panelsEl.getBoundingClientRect().height).toBe(40);
	});

	test("removes captured resource listeners on destroy", () => {
		const panelsEl = document.createElement("div");
		const add = vi.spyOn(panelsEl, "addEventListener");
		const remove = vi.spyOn(panelsEl, "removeEventListener");
		const tracker = trackPanelHeight(panelsEl);

		tracker.destroy();

		for (const type of ["load", "error"] as const) {
			const listener = add.mock.calls.find(([event]) => event === type)?.[1];
			expect(listener).toBeDefined();
			expect(remove).toHaveBeenCalledWith(type, listener, true);
		}
	});

	test("scopes mutation rescans to the floor window and re-arms them", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const mutation = stubMutationObserver();
		const resize = stubResizeObserver();
		try {
			const panelsEl = document.createElement("div");
			const panelElement = panel("Ready");
			let panelHeight = 40;
			panelElement.className = "tabsdown__panel";
			panelsEl.append(panelElement);
			document.body.append(panelsEl);
			vi.spyOn(panelElement, "getBoundingClientRect").mockImplementation(
				() => ({ height: panelHeight }) as DOMRect,
			);
			vi.spyOn(panelsEl, "getBoundingClientRect").mockImplementation(() => ({
				height: Number.parseFloat(panelsEl.style.height) || 40,
			}) as DOMRect);
			const tracker = trackPanelHeight(panelsEl);

			tracker.switched(240);
			expect(mutation.observed()).toEqual([panelElement]);

			vi.advanceTimersByTime(2499);
			expect(mutation.observed()).toEqual([panelElement]);
			vi.advanceTimersByTime(1);
			expect(mutation.observed()).toEqual([]);
			panelHeight = 80;
			resize.fire();
			expect(panelsEl.style.height).toBe("80px");

			tracker.switched(240);
			expect(mutation.observed()).toEqual([panelElement]);
			tracker.destroy();
			expect(mutation.observed()).toEqual([]);
		} finally {
			mutation.restore();
			resize.restore();
		}
	});

	test("measures the visible panel margin box", () => {
		const resize = stubResizeObserver();
		try {
			const panelsEl = document.createElement("div");
			const panelElement = document.createElement("div");
			panelElement.className = "tabsdown__panel";
			panelElement.style.margin = "12px 0 18px";
			panelsEl.append(panelElement);
			vi.spyOn(panelsEl, "getBoundingClientRect").mockReturnValue({
				height: 240,
			} as DOMRect);
			vi.spyOn(panelElement, "getBoundingClientRect").mockReturnValue({
				height: 240,
			} as DOMRect);
			const tracker = trackPanelHeight(panelsEl);
			tracker.switched(240);

			expect(panelsEl.style.height).toBe("270px");
			expect(resize.observed()).toEqual([panelElement]);
			tracker.destroy();
		} finally {
			resize.restore();
		}
	});

	test("keeps the box on the visible panel through rapid switches", () => {
		vi.useFakeTimers();
		const { container, buttons, panelsEl } = setup();
		stubPanelHeights(container, [120, 40]);

		buttons[0]?.click();
		buttons[1]?.click();
		buttons[0]?.click();
		vi.advanceTimersByTime(300);

		// No settle step to wait for and nothing to unpin: the height is simply
		// whichever panel is on screen, so there is no stale value to jump off.
		expect(panelsEl.style.height).toBe("120px");

		buttons[0]?.click();
		expect(panelsEl.style.height).toBe("0px");
	});

	test("tracks the panel height with motion disabled", () => {
		vi.useFakeTimers();
		document.body.classList.add("tabsdown-animations-disabled");
		const { container, buttons, panelsEl } = setup();
		stubPanelHeights(container, [120, 40]);

		buttons[1]?.click();
		vi.advanceTimersByTime(300);

		expect(panelsEl.getBoundingClientRect().height).toBe(40);
		document.body.classList.remove("tabsdown-animations-disabled");
	});

	test("drops the pinned height and observer on destroy", () => {
		const resize = stubResizeObserver();
		try {
			const { container, controller, buttons, panelsEl } = setup();
			stubPanelHeights(container, [120, 40]);
			buttons[1]?.click();
			expect(panelsEl.style.height).toBe("40px");

			controller.destroy();

			expect(panelsEl.style.height).toBe("");
			expect(resize.observed()).toHaveLength(0);
		} finally {
			resize.restore();
		}
	});

	test("returns bare panels to the container untouched", () => {
		vi.useFakeTimers();
		const { container, controller, tabs, buttons } = setup();
		buttons[0]?.click();

		controller.destroy();

		expect(container.querySelector(".tabsdown--mounted")).toBeNull();
		expect(container.classList.contains("tabsdown")).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		for (const tab of tabs) {
			expect(tab.panel.parentElement).toBe(container);
			expect(tab.panel.id).toBe("");
			expect(tab.panel.getAttribute("role")).toBeNull();
			expect(tab.panel.getAttribute("aria-labelledby")).toBeNull();
			expect(tab.panel.getAttribute("tabindex")).toBeNull();
			expect(tab.panel.hidden).toBe(false);
			expect(tab.panel.classList.contains("tabsdown__panel")).toBe(false);
		}
		expect(tabs[0]?.panel.textContent).toBe("Trace");

		buttons[1]?.click();
		expect(controller.selection).toBe("trace");
	});

	test("restores attributes the caller's panels arrived with", () => {
		const trace = panel("Trace");
		trace.id = "steptrace-trace";
		trace.setAttribute("role", "log");
		trace.setAttribute("hidden", "until-found");
		const watch = panel("Watch");
		watch.tabIndex = 3;
		const { controller, tabs, buttons } = setup({ panels: [trace, watch] });

		expect(buttons[0]?.getAttribute("aria-controls")).toBe(
			"steptrace-trace",
		);
		expect(trace.getAttribute("role")).toBe("log");

		controller.destroy();

		expect(trace.id).toBe("steptrace-trace");
		expect(trace.getAttribute("role")).toBe("log");
		expect(trace.getAttribute("hidden")).toBe("until-found");
		expect(watch.tabIndex).toBe(3);
		expect(tabs[1]?.panel.getAttribute("role")).toBeNull();
	});

	test("tolerates being destroyed twice", () => {
		const { controller } = setup();
		controller.destroy();

		expect(() => {
			controller.destroy();
		}).not.toThrow();
	});
});

describe("mount guards", () => {
	test("rejects empty and duplicated input", () => {
		const container = document.createElement("div");
		const sharedPanel = panel("Shared");
		document.body.append(container);

		expect(() =>
			mountTabs(container, { tabs: [], label: "Empty" }),
		).toThrow(/at least one tab/);
		expect(() =>
			mountTabs(container, {
				label: " \t",
				tabs: [{ id: "group", label: "Group", panel: panel("Group") }],
			}),
		).toThrow(/nonblank group label/);
		expect(() =>
			mountTabs(container, {
				label: "Blank",
				tabs: [{ id: "blank", label: " \t", panel: panel("Blank") }],
			}),
		).toThrow(/labels must not be blank/);
		expect(() =>
			mountTabs(container, {
				label: "Duplicated",
				tabs: [
					{ id: "trace", label: "One", panel: panel("One") },
					{ id: "trace", label: "Two", panel: panel("Two") },
				],
			}),
		).toThrow(/unique/);
		expect(() =>
			mountTabs(container, {
				label: "Duplicated panel",
				tabs: [
					{ id: "trace", label: "One", panel: sharedPanel },
					{ id: "watch", label: "Two", panel: sharedPanel },
				],
			}),
		).toThrow(/panel elements must be unique/);
	});

	test("rejects a second mount but not a neighbouring markdown block", () => {
		const { container } = setup();

		expect(() =>
			mountTabs(container, {
				label: "Second",
				tabs: [{ id: "trace", label: "Trace", panel: panel("Trace") }],
			}),
		).toThrow(/already has mounted tabs/);

		const plain = document.createElement("div");
		document.body.append(plain);
		const block = document.createElement("div");
		block.className = "tabsdown";
		plain.append(block);
		expect(() =>
			mountTabs(plain, {
				label: "Beside a block",
				tabs: [{ id: "trace", label: "Trace", panel: panel("Trace") }],
			}),
		).not.toThrow();
	});

	test("rejects duplicate panel ids and container ancestors before mounting", () => {
		const container = document.createElement("div");
		const first = panel("First");
		const second = panel("Second");
		first.id = "shared";
		second.id = "shared";

		expect(() =>
			mountTabs(container, {
				label: "Duplicated ids",
				tabs: [
					{ id: "first", label: "First", panel: first },
					{ id: "second", label: "Second", panel: second },
				],
			}),
		).toThrow(/panel DOM ids must be unique/);
		expect(first.getAttribute("role")).toBeNull();
		expect(second.getAttribute("role")).toBeNull();

		const ancestor = panel("Ancestor");
		ancestor.append(container);
		expect(() =>
			mountTabs(container, {
				label: "Cycle",
				tabs: [{ id: "ancestor", label: "Ancestor", panel: ancestor }],
			}),
		).toThrow(/cannot contain its container/);
		expect(container.parentElement).toBe(ancestor);
		expect(container.querySelector(".tabsdown--mounted")).toBeNull();
	});

	test("rejects nested panels without changing their hierarchy", () => {
		const container = document.createElement("div");
		const parent = panel("Parent");
		const child = panel("Child");
		parent.append(child);

		expect(() =>
			mountTabs(container, {
				label: "Nested",
				tabs: [
					{ id: "parent", label: "Parent", panel: parent },
					{ id: "child", label: "Child", panel: child },
				],
			}),
		).toThrow(/must not contain each other/);
		expect(child.parentElement).toBe(parent);
		expect(parent.getAttribute("role")).toBeNull();
	});

	test("rejects shadow ancestors and target-document id collisions", () => {
		const panelElement = panel("Shadow host");
		const shadow = panelElement.attachShadow({ mode: "open" });
		const shadowContainer = document.createElement("div");
		shadow.append(shadowContainer);

		expect(() =>
			mountTabs(shadowContainer, {
				label: "Shadow",
				tabs: [{ id: "shadow", label: "Shadow", panel: panelElement }],
			}),
		).toThrow(/cannot contain its container/);
		expect(shadowContainer.getRootNode()).toBe(shadow);
		expect(panelElement.getAttribute("role")).toBeNull();

		const existing = document.createElement("div");
		existing.id = "shared-id";
		document.body.append(existing);
		const foreignDocument = document.implementation.createHTMLDocument();
		const foreignPanel = foreignDocument.createElement("div");
		foreignPanel.id = "shared-id";

		expect(() =>
			mountTabs(document.createElement("div"), {
				label: "Collision",
				tabs: [{ id: "foreign", label: "Foreign", panel: foreignPanel }],
			}),
		).toThrow(/already used in the target tree/);
		expect(foreignPanel.ownerDocument).toBe(foreignDocument);
		expect(foreignPanel.getAttribute("role")).toBeNull();
	});

	test("rejects a panel nested in another panel's shadow tree", () => {
		const host = panel("Host");
		const shadow = host.attachShadow({ mode: "open" });
		const inner = document.createElement("div");
		inner.textContent = "Inner";
		shadow.append(inner);

		expect(() =>
			mountTabs(document.createElement("div"), {
				label: "Shadow pair",
				tabs: [
					{ id: "host", label: "Host", panel: host },
					{ id: "inner", label: "Inner", panel: inner },
				],
			}),
		).toThrow(/must not contain each other/);
		expect(inner.parentNode).toBe(shadow);
		expect(host.getAttribute("role")).toBeNull();
	});

	test("rejects an id already taken inside the destination shadow root", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadow = host.attachShadow({ mode: "open" });
		const existing = document.createElement("div");
		existing.id = "shadow-dup";
		const shadowContainer = document.createElement("div");
		shadow.append(existing, shadowContainer);
		const duplicate = panel("Duplicate");
		duplicate.id = "shadow-dup";

		// The owner document cannot see into a shadow tree, so this only throws
		// when the destination root is what gets searched.
		expect(document.getElementById("shadow-dup")).toBeNull();
		expect(() =>
			mountTabs(shadowContainer, {
				label: "Shadow collision",
				tabs: [{ id: "dup", label: "Duplicate", panel: duplicate }],
			}),
		).toThrow(/already used in the target tree/);
	});

	test("steps a generated id past one left behind by an earlier load", () => {
		const first = setup();
		const generated = first.tabs[0]?.panel.id ?? "";
		const mountNumber = Number(/mount-(\d+)-/.exec(generated)?.[1]);
		expect(mountNumber).toBeGreaterThan(0);

		// What the next mount would reach for, planted as if a reload had left it.
		const squatter = document.createElement("div");
		squatter.id = `tabsdown-mount-${mountNumber + 1}-panel-0`;
		document.body.append(squatter);

		const second = setup();
		const panelId = second.tabs[0]?.panel.id ?? "";

		expect(panelId).not.toBe(squatter.id);
		expect(second.buttons[0]?.getAttribute("aria-controls")).toBe(panelId);
		expect(document.querySelectorAll(`#${CSS.escape(panelId)}`)).toHaveLength(1);
	});
});

describe("caller semantics", () => {
	test("leaves an implicit landmark role alone", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const form = document.createElement("form");
		const article = document.createElement("article");
		const plain = panel("Plain");
		const controller = mountTabs(container, {
			label: "Semantic panels",
			tabs: [
				{ id: "form", label: "Form", panel: form },
				{ id: "article", label: "Article", panel: article },
				{ id: "plain", label: "Plain", panel: plain },
			],
		});
		const buttons = Array.from(
			container.querySelectorAll<HTMLButtonElement>(".tabsdown__tab"),
		);

		// A form and an article are already nameable; overriding them with group
		// would strip semantics the caller still relies on.
		expect(form.getAttribute("role")).toBeNull();
		expect(article.getAttribute("role")).toBeNull();
		expect(plain.getAttribute("role")).toBe("group");
		for (const [index, element] of [form, article, plain].entries()) {
			expect(element.getAttribute("aria-labelledby")).toBe(buttons[index]?.id);
		}

		controller.destroy();
		expect(plain.getAttribute("role")).toBeNull();
	});

	test("keeps focus that was already inside a panel being mounted", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const trace = panel("Trace");
		const input = document.createElement("input");
		trace.append(input);
		document.body.append(trace);
		const watch = panel("Watch");
		input.focus();
		expect(document.activeElement).toBe(input);

		const controller = mountTabs(container, {
			label: "Trace and watch",
			selection: "trace",
			tabs: [
				{ id: "trace", label: "Trace", panel: trace },
				{ id: "watch", label: "Watch", panel: watch },
			],
		});

		expect(document.activeElement).toBe(input);
		controller.destroy();
	});

	test("leaves a panel that already carries its own name", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const heading = document.createElement("h2");
		heading.id = "trace-heading";
		heading.textContent = "Trace output";
		const labelled = panel("Labelled");
		labelled.setAttribute("aria-labelledby", "trace-heading");
		const described = panel("Described");
		described.setAttribute("aria-label", "Watch output");
		const bare = panel("Bare");
		container.append(heading);

		const controller = mountTabs(container, {
			label: "Named panels",
			tabs: [
				{ id: "labelled", label: "Trace", panel: labelled },
				{ id: "described", label: "Watch", panel: described },
				{ id: "bare", label: "Bare", panel: bare },
			],
		});
		const buttons = Array.from(
			container.querySelectorAll<HTMLButtonElement>(".tabsdown__tab"),
		);

		expect(labelled.getAttribute("aria-labelledby")).toBe("trace-heading");
		expect(described.getAttribute("aria-labelledby")).toBeNull();
		expect(described.getAttribute("aria-label")).toBe("Watch output");
		expect(bare.getAttribute("aria-labelledby")).toBe(buttons[2]?.id);
		// The relationship is still recorded on the button either way.
		expect(buttons[0]?.getAttribute("aria-controls")).toBe(labelled.id);

		controller.destroy();
		expect(labelled.getAttribute("aria-labelledby")).toBe("trace-heading");
	});

	test("adds a panel tab stop only where nothing inside can take one", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const interactive = panel("Interactive");
		interactive.append(document.createElement("input"));
		const readable = panel("Readable");
		const preset = panel("Preset");
		preset.tabIndex = -1;

		const controller = mountTabs(container, {
			label: "Tab stops",
			tabs: [
				{ id: "interactive", label: "Interactive", panel: interactive },
				{ id: "readable", label: "Readable", panel: readable },
				{ id: "preset", label: "Preset", panel: preset },
			],
		});

		// Its own input is the first thing a keyboard user should reach, not the
		// wrapper around it.
		expect(interactive.hasAttribute("tabindex")).toBe(false);
		expect(readable.tabIndex).toBe(0);
		expect(preset.tabIndex).toBe(-1);

		controller.destroy();
		expect(readable.hasAttribute("tabindex")).toBe(false);
		expect(preset.tabIndex).toBe(-1);
	});

	test("still takes a tab stop when its only controls cannot hold focus", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const hidden = panel("Hidden");
		const hiddenInput = document.createElement("input");
		hiddenInput.type = "hidden";
		hidden.append(hiddenInput);
		const disabled = panel("Disabled");
		const disabledButton = document.createElement("button");
		disabledButton.disabled = true;
		disabled.append(disabledButton);

		const controller = mountTabs(container, {
			label: "Unusable controls",
			tabs: [
				{ id: "hidden", label: "Hidden", panel: hidden },
				{ id: "disabled", label: "Disabled", panel: disabled },
			],
		});

		// Neither descendant can be tabbed to, so the panel is the only way in.
		expect(hidden.tabIndex).toBe(0);
		expect(disabled.tabIndex).toBe(0);

		controller.destroy();
	});

	test("keeps a generated id clear of one arriving inside a panel", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const host = panel("Host");
		const descendant = document.createElement("span");
		descendant.id = `tabsdown-mount-${nextMountNumber()}-tab-0`;
		host.append(descendant);

		const controller = mountTabs(container, {
			label: "Nested id",
			tabs: [{ id: "host", label: "Host", panel: host }],
		});
		const button = container.querySelector<HTMLButtonElement>(".tabsdown__tab");

		expect(button?.id).not.toBe(descendant.id);
		expect(
			container.querySelectorAll(`#${CSS.escape(descendant.id)}`),
		).toHaveLength(1);

		controller.destroy();
	});

	test("claims its panels before a disconnect callback can re-enter", () => {
		const container = document.createElement("div");
		document.body.append(container);
		let nested: string | undefined;
		class ReentrantPanel extends HTMLElement {
			disconnectedCallback(): void {
				try {
					mountTabs(document.createElement("div"), {
						label: "Nested",
						tabs: [{ id: "again", label: "Again", panel: this }],
					});
				} catch (error) {
					nested = (error as Error).message;
				}
			}
		}
		customElements.define("tabsdown-reentrant-panel", ReentrantPanel);
		const reentrant = document.createElement("tabsdown-reentrant-panel");
		// Attached first, so moving it into the mount fires the callback mid-append.
		document.body.append(reentrant);

		const controller = mountTabs(container, {
			label: "Reentrant",
			tabs: [{ id: "trace", label: "Trace", panel: reentrant }],
		});

		expect(nested).toMatch(/already mounted/);
		controller.destroy();
	});

	test("gives a preformatted panel a nameable role", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const trace = document.createElement("pre");
		trace.textContent = "Step 1";

		const controller = mountTabs(container, {
			label: "Trace",
			tabs: [{ id: "trace", label: "Trace", panel: trace }],
		});

		// pre is generic like div, so without a role its aria-labelledby names
		// nothing at all.
		expect(trace.getAttribute("role")).toBe("group");
		expect(trace.getAttribute("aria-labelledby")).toBe(
			container.querySelector(".tabsdown__tab")?.id,
		);

		controller.destroy();
		expect(trace.getAttribute("role")).toBeNull();
	});

	test("keeps a generated id clear of one arriving on another panel", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const squatter = panel("Squatter");
		// Detached and foreign panels are invisible to a tree search, so only
		// reserving the incoming ids keeps the generated button id off this one.
		squatter.id = `tabsdown-mount-${nextMountNumber()}-tab-0`;
		const other = panel("Other");

		const controller = mountTabs(container, {
			label: "Reserved",
			tabs: [
				{ id: "squatter", label: "Squatter", panel: squatter },
				{ id: "other", label: "Other", panel: other },
			],
		});
		const buttons = Array.from(
			container.querySelectorAll<HTMLButtonElement>(".tabsdown__tab"),
		);

		expect(buttons[0]?.id).not.toBe(squatter.id);
		expect(squatter.getAttribute("aria-labelledby")).toBe(buttons[0]?.id);
		expect(
			container.querySelectorAll(`#${CSS.escape(squatter.id)}`),
		).toHaveLength(1);

		controller.destroy();
	});

	test("notices focus inside a shadow root when mounting collapsed", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadow = host.attachShadow({ mode: "open" });
		const container = document.createElement("div");
		const trace = document.createElement("div");
		const input = document.createElement("input");
		trace.append(input);
		shadow.append(container, trace);
		input.focus();

		// The document reports only the host, so a document-scoped read never sees
		// the input and leaves focus stranded in a panel it is about to hide.
		expect(document.activeElement).toBe(host);
		expect(shadow.activeElement).toBe(input);

		mountTabs(container, {
			label: "Shadow focus",
			selection: null,
			tabs: [{ id: "trace", label: "Trace", panel: trace }],
		});

		expect(shadow.activeElement).toBe(
			container.querySelector(".tabsdown__tab"),
		);
	});

	test("notices focus inside a shadow root when switching away", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadow = host.attachShadow({ mode: "open" });
		const container = document.createElement("div");
		const trace = document.createElement("div");
		const watch = document.createElement("div");
		const input = document.createElement("input");
		trace.append(input);
		shadow.append(container, trace, watch);
		const controller = mountTabs(container, {
			label: "Shadow switch",
			selection: "trace",
			tabs: [
				{ id: "trace", label: "Trace", panel: trace },
				{ id: "watch", label: "Watch", panel: watch },
			],
		});
		input.focus();
		expect(shadow.activeElement).toBe(input);

		controller.setSelection("watch");

		const buttons = container.querySelectorAll<HTMLButtonElement>(
			".tabsdown__tab",
		);
		expect(shadow.activeElement).toBe(buttons[1]);
	});

	test("rehomes focus when the panel holding it mounts collapsed", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const trace = panel("Trace");
		const input = document.createElement("input");
		trace.append(input);
		document.body.append(trace);
		input.focus();

		mountTabs(container, {
			label: "Trace only",
			selection: null,
			tabs: [{ id: "trace", label: "Trace", panel: trace }],
		});

		// The panel is hidden, so its own control is the nearest sensible home.
		expect(document.activeElement).toBe(
			container.querySelector(".tabsdown__tab"),
		);
	});

	test("rejects a panel owned by another live mount until teardown", () => {
		const panelElement = panel("Shared");
		const first = mountTabs(document.createElement("div"), {
			label: "First",
			tabs: [{ id: "shared", label: "Shared", panel: panelElement }],
		});

		expect(() =>
			mountTabs(document.createElement("div"), {
				label: "Second",
				tabs: [{ id: "shared", label: "Shared", panel: panelElement }],
			}),
		).toThrow(/already mounted/);

		first.destroy();

		expect(() =>
			mountTabs(document.createElement("div"), {
				label: "Second",
				tabs: [{ id: "shared", label: "Shared", panel: panelElement }],
			}).destroy(),
		).not.toThrow();
	});
});

test("keeps mounted roots out of their own container query", () => {
	const styles = readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
		"utf8",
	);

	// Doubled on purpose: a single class only ties .tabsdown and would
	// depend on sitting later in the file.
	expect(styles).toMatch(
		/\.tabsdown\.tabsdown--mounted \{[^}]*container-type:\s*normal/,
	);
});

test("styles mounted selections as active", () => {
	const styles = readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
		"utf8",
	);

	expect(styles).toMatch(
		/\.tabsdown__tab\[aria-selected="true"\],\s*\.tabsdown__tab\[aria-expanded="true"\] \{/,
	);
	expect(styles).toMatch(
		/body\.tabsdown-personality-underline \.tabsdown__tab\[aria-selected="true"\],\s*body\.tabsdown-personality-underline \.tabsdown__tab\[aria-expanded="true"\] \{/,
	);
});
