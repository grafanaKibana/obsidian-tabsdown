import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
	TabBlockRenderChild,
	renderTabsDiagnostic,
} from "../src/render";
import type { TabDefinition } from "../src/parser";
import { renderMock, setIcon } from "./obsidian.mock";
import { stubPanelHeights, stubResizeObserver } from "./panel-size";

const tabs = [
	{ label: "One", body: "First" },
	{ label: "Two", body: "Second" },
	{ label: "<img src=x onerror=alert(1)>", body: "Third" },
];
const scrollIntoViewMock = vi.fn();

function setup(generation = { value: 0 }): {
	child: TabBlockRenderChild;
	container: HTMLElement;
} {
	const container = document.createElement("div");
	document.body.append(container);
	const child = new TabBlockRenderChild(
		{} as App,
		container,
		"Folder/Note.md",
		tabs,
		[],
		() => generation.value,
	);
	child.load();
	return { child, container };
}

function keys(element: HTMLElement, key: string): void {
	element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
}

function readStyles(): string {
	return readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
		"utf8",
	);
}

function styleSetting(styles: string, field: "id" | "title", value: string): string {
	const metadata = /\/\* @settings([\s\S]*?)\*\//.exec(styles)?.[1] ?? "";
	return (
		metadata
			.split("\n  -\n")
			.find((entry) => entry.includes(`    ${field}: ${value}\n`)) ?? ""
	);
}

function settingId(setting: string): string {
	return /^\s{4}id: (.+)$/m.exec(setting)?.[1] ?? "";
}

function matchingRuleBodies(styles: string, selector: string): string {
	return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter((match) => match[1]?.includes(selector))
		.map((match) => match[2])
		.join("\n");
}

function matchingSelectors(styles: string, selector: string): string {
	return [...styles.matchAll(/([^{}]+)\{[^{}]*\}/g)]
		.map((match) => match[1] ?? "")
		.filter((candidate) => candidate.includes(selector))
		.join("\n");
}

function personalityRules(styles: string): string {
	return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter((match) => match[1]?.includes("personality-"))
		.map((match) => `${match[1]} {${match[2]}}`)
		.join("\n");
}

function classSelectorCount(selector: string): number {
	return (
		selector.replace(/:where\([^)]*\)/g, "").match(/\.[\w-]+/g)?.length ?? 0
	);
}

beforeEach(() => {
	renderMock.mockReset();
	renderMock.mockImplementation(async (_app, markdown, element) => {
		element.textContent = markdown;
	});
	scrollIntoViewMock.mockReset();
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: scrollIntoViewMock,
	});
});

afterEach(() => {
	document.body.replaceChildren();
});

describe("tab interaction", () => {
	test("selects the first tab and renders only its panel", () => {
		const { container } = setup();
		const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		const panels = container.querySelectorAll<HTMLElement>('[role="tabpanel"]');

		expect(container.classList.contains("tabsdown--inline-overflow")).toBe(false);
		expect(buttons).toHaveLength(3);
		expect(container.querySelectorAll('.tabsdown__separator[aria-hidden="true"]')).toHaveLength(3);
		expect(buttons[0]?.querySelector<HTMLElement>(".tabsdown__separator")?.hidden).toBe(true);
		expect(buttons[0]?.getAttribute("aria-selected")).toBe("true");
		expect(buttons[0]?.tabIndex).toBe(0);
		expect(buttons[1]?.getAttribute("aria-selected")).toBe("false");
		expect(panels[0]?.hidden).toBe(false);
		expect(panels[1]?.hidden).toBe(true);
		expect(
			container.querySelectorAll('[role="tab"][aria-selected="true"]'),
		).toHaveLength(1);
		expect(
			Array.from(buttons).filter((button) => button.tabIndex === 0),
		).toHaveLength(1);
		expect(Array.from(panels).filter((panel) => !panel.hidden)).toHaveLength(1);
		for (const button of Array.from(buttons)) {
			const panel = container.querySelector<HTMLElement>(
				`#${button.getAttribute("aria-controls") ?? ""}`,
			);
			expect(panel?.getAttribute("aria-labelledby")).toBe(button.id);
		}
		expect(renderMock).toHaveBeenCalledOnce();
		expect(renderMock).toHaveBeenCalledWith(
			expect.anything(),
			"First",
			expect.any(HTMLElement),
			"Folder/Note.md",
			expect.anything(),
		);
	});

	test("uses manual keyboard activation with roving focus", () => {
		const { container } = setup();
		const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		const panels = container.querySelectorAll<HTMLElement>('[role="tabpanel"]');
		const first = buttons[0];
		const second = buttons[1];
		if (!first || !second) throw new Error("Expected tab buttons.");

		first.focus();
		keys(first, "ArrowRight");
		expect(document.activeElement).toBe(second);
		expect(second.tabIndex).toBe(0);
		expect(second.getAttribute("aria-selected")).toBe("false");
		expect(panels[0]?.hidden).toBe(false);

		keys(second, "Enter");
		expect(second.getAttribute("aria-selected")).toBe("true");
		expect(panels[0]?.hidden).toBe(true);
		expect(panels[1]?.hidden).toBe(false);

		keys(second, "End");
		expect(document.activeElement).toBe(buttons[2]);
		keys(buttons[2]!, "Home");
		expect(document.activeElement).toBe(first);
		expect(scrollIntoViewMock).toHaveBeenCalledWith({
			block: "nearest",
			inline: "nearest",
		});
	});

	test("wraps focus without selection and activates with Space", () => {
		const { container } = setup();
		const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		const first = buttons[0];
		const last = buttons[2];
		if (!first || !last) throw new Error("Expected tab buttons.");

		first.focus();
		keys(first, "ArrowLeft");
		expect(document.activeElement).toBe(last);
		expect(first.getAttribute("aria-selected")).toBe("true");
		keys(last, "ArrowRight");
		expect(document.activeElement).toBe(first);
		keys(first, "ArrowLeft");
		keys(last, " ");
		expect(last.getAttribute("aria-selected")).toBe("true");
	});

	test("activates with pointer input and keeps blocks independent", () => {
		const first = setup();
		const second = setup();
		const firstButtons =
			first.container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		const secondButtons =
			second.container.querySelectorAll<HTMLButtonElement>('[role="tab"]');

		firstButtons[1]?.click();
		expect(firstButtons[1]?.getAttribute("aria-selected")).toBe("true");
		expect(secondButtons[0]?.getAttribute("aria-selected")).toBe("true");
	});

	test("moves the box from the outgoing height to the visible panel's height", async () => {
		const { container } = setup();
		const panels = container.querySelector<HTMLElement>(".tabsdown__panels");
		const second = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
		if (!panels || !second) throw new Error("Expected panels and second tab.");
		stubPanelHeights(container, [240, 80, 0]);

		second.click();
		await Promise.resolve();

		expect(panels.style.height).toBe("80px");
	});

	test("tracks a panel that grows after it is already on screen", async () => {
		const resize = stubResizeObserver();
		try {
			const { container } = setup();
			const panels =
				container.querySelector<HTMLElement>(".tabsdown__panels");
			const second =
				container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
			if (!panels || !second) throw new Error("Expected panels and tab.");
			const grow = stubPanelHeights(container, [240, 80, 0]);

			second.click();
			await Promise.resolve();
			expect(panels.style.height).toBe("80px");

			// Nothing predicted this: the panel simply got taller, and the box
			// follows rather than staying on a height it guessed earlier.
			grow(1, 640);
			resize.fire();
			expect(panels.style.height).toBe("640px");

			grow(1, 300);
			resize.fire();
			expect(panels.style.height).toBe("300px");
		} finally {
			resize.restore();
		}
	});

	test("lands on the final panel through rapid switches", async () => {
		const { container } = setup();
		const panels = container.querySelector<HTMLElement>(".tabsdown__panels");
		const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		if (!panels || !buttons[1] || !buttons[2]) {
			throw new Error("Expected panels and tabs.");
		}
		stubPanelHeights(container, [240, 80, 500]);

		buttons[1].click();
		buttons[2].click();
		buttons[1].click();
		await Promise.resolve();

		expect(panels.style.height).toBe("80px");
	});

	test("clips only while a height transition is running", async () => {
		const { container } = setup();
		const panels = container.querySelector<HTMLElement>(".tabsdown__panels");
		const second = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
		if (!panels || !second) throw new Error("Expected panels and second tab.");
		stubPanelHeights(container, [240, 80, 0]);
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.set(++nextFrame, callback);
			return nextFrame;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			frames.delete(id);
		});
		const runFrames = (): void => {
			const pending = [...frames.values()];
			frames.clear();
			for (const frame of pending) frame(0);
		};
		const transition = (type: string): void => {
			const event = new Event(type);
			Object.defineProperty(event, "propertyName", { value: "height" });
			panels.dispatchEvent(event);
		};

		second.click();
		await Promise.resolve();
		expect(panels.classList.contains("tabsdown__panels--animating")).toBe(false);

		transition("transitionstart");
		expect(panels.classList.contains("tabsdown__panels--animating")).toBe(true);

		// A retarget cancels and restarts within the frame; the clip has to survive
		// the gap or the content spills out mid-run.
		transition("transitioncancel");
		transition("transitionstart");
		runFrames();
		expect(panels.classList.contains("tabsdown__panels--animating")).toBe(true);

		transition("transitionend");
		runFrames();
		expect(panels.classList.contains("tabsdown__panels--animating")).toBe(false);
	});

	test("holds the outgoing height until an empty query container fills", async () => {
		const resize = stubResizeObserver();
		vi.useFakeTimers();
		try {
			// A query block renders an empty container and fills it when the query
			// resolves. Text alongside it gives the panel height the whole time, so
			// height alone can never say whether the panel is finished.
			renderMock.mockImplementation(
				async (_app: unknown, _body: unknown, el: HTMLElement) => {
					el.createEl("p").textContent = "Heading above the query";
					el.createEl("div", { cls: "block-language-dataview" });
					el.createEl("div", { cls: "block-language-datacorejsx" });
				},
			);
			const { container } = setup();
			const panels =
				container.querySelector<HTMLElement>(".tabsdown__panels");
			const second =
				container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
			if (!panels || !second) throw new Error("Expected panels and tab.");
			const grow = stubPanelHeights(container, [240, 40, 0]);

			second.click();
			await vi.advanceTimersByTimeAsync(0);
			expect(panels.style.height).toBe("240px");

			await vi.advanceTimersByTimeAsync(1000);
			expect(panels.getBoundingClientRect().height).toBe(240);

			const query = container.querySelectorAll<HTMLElement>(
				".block-language-dataview",
			)[1];
			const slower = container.querySelectorAll<HTMLElement>(
				".block-language-datacorejsx",
			)[1];
			if (!query || !slower) throw new Error("Expected query containers.");

			// One of two containers filling is not the panel being done.
			query.createEl("table");
			grow(1, 300);
			resize.fire();
			expect(panels.getBoundingClientRect().height).toBe(300);

			grow(1, 90);
			resize.fire();
			expect(panels.getBoundingClientRect().height).toBe(240);

			slower.createEl("table");
			grow(1, 700);
			resize.fire();
			expect(panels.getBoundingClientRect().height).toBe(700);
		} finally {
			vi.useRealTimers();
			resize.restore();
		}
	});

	test.each(["load", "error"] as const)(
		"holds the outgoing height until an incomplete image emits %s",
		async (terminalEvent) => {
			let complete = false;
			renderMock.mockImplementation(
				async (_app: unknown, body: unknown, el: HTMLElement) => {
					if (body !== "Second") {
						el.textContent = String(body);
						return;
					}
					const image = el.createEl("img", {
						attr: { src: "https://example.invalid/pending.png" },
					});
					Object.defineProperty(image, "complete", {
						configurable: true,
						get: () => complete,
					});
				},
			);
			const { container } = setup();
			const panels =
				container.querySelector<HTMLElement>(".tabsdown__panels");
			const second =
				container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
			if (!panels || !second) throw new Error("Expected panels and tab.");
			const setHeight = stubPanelHeights(container, [240, 40, 0]);

			second.click();
			await Promise.resolve();
			const image = panels.querySelector<HTMLImageElement>("img");
			if (!image) throw new Error("Expected a pending image.");
			expect(image.complete).toBe(false);
			expect(panels.getBoundingClientRect().height).toBe(240);

			complete = true;
			const settledHeight = terminalEvent === "load" ? 300 : 40;
			setHeight(1, settledHeight);
			image.dispatchEvent(new Event(terminalEvent));
			expect(panels.getBoundingClientRect().height).toBe(settledHeight);
		},
	);

	test("re-arms the floor on each switch instead of inheriting a stale one", async () => {
		vi.useFakeTimers();
		try {
			renderMock.mockImplementation(
				async (_app: unknown, _body: unknown, el: HTMLElement) => {
					el.createEl("p").textContent = "Text above the query";
					el.createEl("div", { cls: "block-language-dataview" });
				},
			);
			const { container } = setup();
			const panels =
				container.querySelector<HTMLElement>(".tabsdown__panels");
			const buttons =
				container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
			if (!panels || !buttons[1] || !buttons[2]) {
				throw new Error("Expected panels and tabs.");
			}
			stubPanelHeights(container, [240, 40, 30]);

			buttons[1].click();
			await vi.advanceTimersByTimeAsync(2400);
			expect(panels.getBoundingClientRect().height).toBe(240);

			// The second switch owns the floor now. Leaving the first switch's cap
			// armed drops the box two seconds after the user already moved on.
			buttons[2].click();
			await vi.advanceTimersByTimeAsync(200);
			expect(panels.getBoundingClientRect().height).toBe(240);
		} finally {
			vi.useRealTimers();
		}
	});

	test("gives up the floor when a container never fills", async () => {
		vi.useFakeTimers();
		try {
			renderMock.mockImplementation(
				async (_app: unknown, _body: unknown, el: HTMLElement) => {
					el.createEl("div", { cls: "block-language-dataview" });
				},
			);
			const { container } = setup();
			const panels =
				container.querySelector<HTMLElement>(".tabsdown__panels");
			const second =
				container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
			if (!panels || !second) throw new Error("Expected panels and tab.");
			stubPanelHeights(container, [240, 20, 0]);

			second.click();
			await vi.advanceTimersByTimeAsync(2000);
			expect(panels.getBoundingClientRect().height).toBe(240);

			await vi.advanceTimersByTimeAsync(600);
			expect(panels.getBoundingClientRect().height).toBe(20);
		} finally {
			vi.useRealTimers();
		}
	});

	test("shrinks straight to a shorter panel with nothing pending", async () => {
		vi.useFakeTimers();
		try {
			renderMock.mockImplementation(
				async (_app: unknown, _body: unknown, el: HTMLElement) => {
					el.createEl("p").textContent = "Content";
				},
			);
			const { container } = setup();
			const panels =
				container.querySelector<HTMLElement>(".tabsdown__panels");
			const second =
				container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
			if (!panels || !second) throw new Error("Expected panels and tab.");
			stubPanelHeights(container, [240, 30, 0]);

			second.click();
			await vi.advanceTimersByTimeAsync(0);

			expect(panels.style.height).toBe("30px");
		} finally {
			vi.useRealTimers();
		}
	});

	test("settles an empty tab without waiting out the floor", async () => {
		vi.useFakeTimers();
		try {
			renderMock.mockImplementation(async () => undefined);
			const { container } = setup();
			const panels =
				container.querySelector<HTMLElement>(".tabsdown__panels");
			const second =
				container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
			if (!panels || !second) throw new Error("Expected panels and tab.");
			stubPanelHeights(container, [240, 0, 0]);

			second.click();
			await vi.advanceTimersByTimeAsync(0);

			expect(panels.style.height).toBe("0px");
		} finally {
			vi.useRealTimers();
		}
	});

	test("scrolls an activated tab into view", () => {
		const { container } = setup();
		const second =
			container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
		scrollIntoViewMock.mockReset();

		second?.click();

		expect(scrollIntoViewMock).toHaveBeenCalledOnce();
		expect(scrollIntoViewMock).toHaveBeenCalledWith({
			block: "nearest",
			inline: "nearest",
		});
	});

	test("uses generated identifiers and treats labels as text", () => {
		const { container } = setup();
		const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		const unsafe = buttons[2];
		if (!unsafe) throw new Error("Expected third tab.");

		expect(unsafe.querySelector(".tabsdown__tab-label")?.textContent).toBe(
			"<img src=x onerror=alert(1)>",
		);
		expect(unsafe.querySelector("img")).toBeNull();
		expect(unsafe.id).not.toContain("img");
		expect(
			container.querySelector(`#${unsafe.getAttribute("aria-controls") ?? ""}`),
		).not.toBeNull();
	});
});

test("diagnostics preserve raw source through text-only DOM APIs", () => {
	const container = document.createElement("div");
	renderTabsDiagnostic(container, {
		code: "empty-label",
		message: "Tab labels cannot be empty.",
		line: 2,
		source: '<img src=x onerror="alert(1)">',
	});

	expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
	expect(container.querySelector("img")).toBeNull();
	expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

test("applies the final position and layout configuration without showing it in labels", () => {
	const configuredTabs = [
		{ label: "Python", body: "First" },
		{ label: "JavaScript", body: "Second" },
	] satisfies TabDefinition[];
	const container = document.createElement("div");
	const child = new TabBlockRenderChild(
		{} as App,
		container,
		"Folder/Note.md",
		configuredTabs,
		["left", "multi", "bottom", "one"],
		() => 0,
	);

	child.load();

	expect(container.classList.contains("tabsdown--bottom")).toBe(true);
	expect(container.classList.contains("tabsdown--one")).toBe(true);
	expect(container.classList.contains("tabsdown--inline-overflow")).toBe(true);
	expect(container.classList.contains("tabsdown--left")).toBe(false);
	expect(container.classList.contains("tabsdown--multi")).toBe(false);
	expect(
		container.querySelector('[role="tab"] .tabsdown__tab-label')?.textContent,
	).toBe("Python");
});

test("alternates nested tint parity at every depth", () => {
	const root = document.body.appendChild(document.createElement("div"));
	root.className = "tabsdown";
	const classes: string[] = [];
	let parent = root;

	for (let depth = 1; depth <= 4; depth += 1) {
		const container = parent.appendChild(document.createElement("div"));
		const child = new TabBlockRenderChild(
			{} as App,
			container,
			"Folder/Note.md",
			tabs,
			[],
			() => 0,
		);
		child.load();
		classes.push(
			container.classList.contains("tabsdown--nested-odd") ? "odd" : "even",
		);
		parent = container;
	}

	expect(classes).toEqual(["odd", "even", "odd", "even"]);
});

test("renders a tab icon beside the label and hides it from assistive tech", () => {
	const container = document.createElement("div");
	const child = new TabBlockRenderChild(
		{} as App,
		container,
		"Folder/Note.md",
		[
			{ label: "Python", body: "First", icon: "code" },
			{ label: "Notes", body: "Second" },
		] satisfies TabDefinition[],
		[],
		() => 0,
	);

	child.load();
	const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
	const icon = buttons[0]?.querySelector(".tabsdown__tab-icon");

	expect(setIcon).toHaveBeenCalledWith(icon, "code");
	expect(icon?.getAttribute("aria-hidden")).toBe("true");
	expect(buttons[0]?.querySelector(".tabsdown__tab-label")?.textContent).toBe("Python");
	expect(buttons[1]?.querySelector(".tabsdown__tab-icon")).toBeNull();
});

test("renders only the bounded inline label elements beside icons", () => {
	const container = document.createElement("div");
	const child = new TabBlockRenderChild(
		{} as App,
		container,
		"Folder/Note.md",
		[
			{
				label: "**Strong** *em* ~~old~~ `code` [link](url)",
				body: "First",
				icon: "code",
			},
			{ label: "****", body: "Second" },
		] satisfies TabDefinition[],
		[],
		() => 0,
	);

	child.load();
	const labels = container.querySelectorAll<HTMLElement>(".tabsdown__tab-label");
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
	expect(reserve?.classList.contains("tabsdown__tab-reserve--icon")).toBe(true);
	expect(reserve?.parentElement?.classList.contains("tabsdown__tab-content")).toBe(true);
	expect(container.querySelector(".tabsdown__tab-icon")?.getAttribute("aria-hidden")).toBe("true");
});

test("keeps delimiter-only labels visible and raw duplicate keys distinct", () => {
	const labels = ["****", "** **", "~~~~", "``", "A", "**A**"];
	const container = document.createElement("div");
	const child = new TabBlockRenderChild(
		{} as App,
		container,
		"Folder/Note.md",
		labels.map((label) => ({ label, body: label })),
		[],
		() => 0,
	);
	child.load();

	expect(
		Array.from(container.querySelectorAll(".tabsdown__tab-label"), (label) => label.textContent),
	).toEqual(["****", "** **", "~~~~", "``", "A", "A"]);
});

test("activates authored tabs from every formatted descendant", () => {
	const container = document.createElement("div");
	const child = new TabBlockRenderChild(
		{} as App,
		container,
		"Folder/Note.md",
		[
			{ label: "**Strong**", body: "Strong" },
			{ label: "*Em*", body: "Em" },
			{ label: "~~Delete~~", body: "Delete" },
			{ label: "`Code`", body: "Code" },
		],
		[],
		() => 0,
	);
	child.load();

	for (const [index, selector] of ["strong", "em", "del", "code"].entries()) {
		container.querySelector<HTMLElement>(selector)?.click();
		expect(container.querySelectorAll('[aria-selected="true"]')[0]).toBe(
			container.querySelectorAll("button")[index],
		);
	}
});

test("layout modifiers style only their own tab list", () => {
	const styles = readStyles();

	expect(styles).not.toMatch(/\.tabsdown--[a-z]+\s+\.tabsdown__/);
});

test("preserves global Style Settings and adds the approved hierarchy", () => {
	const styles = readStyles();
	for (const [id, fragments] of Object.entries({
		"tabsdown-density": ["default: tabsdown-density-default", "value: tabsdown-density-compact"],
		"tabsdown-personality": ["default: tabsdown-personality-default", "value: tabsdown-personality-underline", "value: tabsdown-personality-separator", "value: tabsdown-personality-rail"],
		"tabsdown-underline-placement": ["default: tabsdown-underline-placement-auto", "value: tabsdown-underline-placement-top", "value: tabsdown-underline-placement-right", "value: tabsdown-underline-placement-bottom", "value: tabsdown-underline-placement-left"],
		"tabsdown-overflow": ["default: tabsdown-overflow-scroll", "value: tabsdown-overflow-wrap"],
		"tabsdown-palette": ["default: tabsdown-palette-primary", "value: tabsdown-palette-secondary"],
		"tabsdown-accent-override": ["type: variable-color"],
		"tabsdown-alignment": ["default: tabsdown-alignment-start", "value: tabsdown-alignment-center", "value: tabsdown-alignment-equal-width"],
		"tabsdown-gap": ["default: 4", "min: 0", "step: 1", "format: px"],
		"tabsdown-radius": ["default: 4", "min: 0", "max: 24", "step: 1", "format: px"],
		"tabsdown-content-spacing": ["default: 12", "min: 0", "max: 48", "step: 1", "format: px"],
		"tabsdown-animation-speed": ["default: 160", "min: 0", "max: 500", "step: 20", "format: ms"],
		"tabsdown-animations-disabled": ["type: class-toggle", "default: false"],
	})) {
		const setting = styleSetting(styles, "id", id);
		for (const fragment of fragments) expect(setting, `${id}: ${fragment}`).toContain(fragment);
	}

	for (const [title, level, collapsed] of [
		["Defaults and global controls", "1", "false"],
		["General", "2", "true"],
		["Layout", "2", "true"],
		["Tab appearance", "2", "true"],
		["Icons and labels", "2", "true"],
		["Nested blocks", "2", "true"],
		["Position overrides", "1", "false"],
		["Top", "2", "true"],
		["Bottom", "2", "true"],
		["Left", "2", "true"],
		["Right", "2", "true"],
		["Motion", "1", "true"],
	] as const) {
		const heading = styleSetting(styles, "title", title);
		expect(heading, title).toMatch(/type: heading/);
		expect(heading, title).toContain(`level: ${level}`);
		expect(heading, title).toContain(`collapsed: ${collapsed}`);
	}
});

test("gives every position explicit inheritable appearance controls", () => {
	const styles = readStyles();
	for (const position of ["top", "bottom", "left", "right"]) {
		for (const [axis, options] of [
			["personality", ["inherit", "button", "underline", "separator", "rail"]],
			["palette", ["inherit", "primary", "secondary"]],
			["alignment", ["inherit", "start", "center", "equal-width"]],
		] as const) {
			const id = `tabsdown-${position}-${axis}`;
			const setting = styleSetting(styles, "id", id);
			expect(setting, id).toMatch(/type: class-select/);
			expect(setting, id).toMatch(/allowEmpty: false/);
			expect(setting, id).toContain(`default: ${id}-inherit`);
			for (const option of options) {
				expect(setting, `${id}-${option}`).toContain(`value: ${id}-${option}`);
			}
		}
	}
});

test("defines the requested control ranges and selected weights", () => {
	const styles = readStyles();
	const expectFields = (title: string, fields: readonly string[]): void => {
		const setting = styleSetting(styles, "title", title);
		for (const field of fields) expect(setting, `${title}: ${field}`).toContain(field);
	};

	expectFields("Gap between tabs", ["default: 4", "min: 0", "max: 48", "step: 1"]);
	expectFields("Underline thickness", ["default: 2", "min: 1", "max: 8", "step: 1"]);
	expectFields("Horizontal padding", ["default: 36", "min: 0", "max: 48", "step: 1"]);
	expectFields("Side-list width", ["default: 192", "min: 192", "max: 320", "step: 8"]);
	expect(styleSetting(styles, "title", "Use custom horizontal padding")).toBe("");
	expect(styleSetting(styles, "title", "Use custom side-list width")).toBe("");
	expectFields("Icon size", ["default: 16", "min: 12", "max: 32", "step: 1"]);
	expectFields("Icon spacing", ["default: 6", "min: 0", "max: 16", "step: 1"]);
	const weight = styleSetting(styles, "title", "Selected tab font weight");
	for (const option of ["Thinner", "Default", "Bolder"]) {
		expect(weight).toContain(`label: ${option}`);
	}
	expect(weight).toMatch(/default: tabsdown-[\w-]+-default/);
	expect(weight).toMatch(/value: tabsdown-[\w-]+-thinner/);
	expect(weight).toMatch(/value: tabsdown-[\w-]+-bolder/);
	const weightId = settingId(weight);
	const baseTab = /^\.tabsdown__tab \{([^}]*)\}/m.exec(styles)?.[1] ?? "";
	expect(baseTab).toMatch(/font-weight:\s*var\(--font-normal,\s*400\)/);
	expect(matchingRuleBodies(styles, `.tabsdown__tab[aria-selected="true"]`)).toMatch(/font-weight:\s*600/);
	expect(matchingRuleBodies(styles, `body.${weightId}-thinner`)).toMatch(/font-weight:\s*400/);
	expect(matchingRuleBodies(styles, `body.${weightId}-bolder`)).toMatch(/font-weight:\s*700/);

	const nested = styleSetting(styles, "title", "Nested block style");
	expect(nested).toMatch(/type: class-select/);
	expect(nested).toMatch(/allowEmpty: false/);
	expect(nested).toContain("default: tabsdown-nested-style-card");
	expect(nested).toContain("value: tabsdown-nested-style-card");
	expect(nested).toContain("value: tabsdown-nested-style-flat");
});

test("offers flat nested blocks while keeping nested controls subtle", () => {
	const styles = readStyles();
	const card = matchingRuleBodies(styles, ".tabsdown .tabsdown");
	const evenCard = matchingRuleBodies(styles, ".tabsdown--nested-even");
	const flat = matchingRuleBodies(styles, "body.tabsdown-nested-style-flat .tabsdown .tabsdown");
	const subtle = matchingRuleBodies(styles, "body .tabsdown--nested-odd");
	const deeper = matchingRuleBodies(styles, "body .tabsdown--nested-even");

	expect(card).toMatch(/border:\s*var\(--border-width\) solid/);
	expect(card).toMatch(/background-color:\s*var\(--background-secondary\)/);
	expect(evenCard).toMatch(/background-color:\s*var\(--background-primary\)/);
	for (const reset of ["margin-block: 0", "padding: 0", "border: 0", "border-radius: 0", "background-color: transparent"]) {
		expect(flat).toContain(reset);
	}
	for (const variable of [
		"--tabsdown-tab-background: color-mix(",
		"--tabsdown-tab-color: var(--text-muted)",
		"--tabsdown-tab-selected-background: color-mix(",
		"--tabsdown-tab-selected-color: var(--text-normal)",
	]) {
		expect(subtle).toContain(variable);
	}
	for (const paletteVariable of [
		"--tabsdown-tab-underline-color",
		"--tabsdown-rail-selected-background",
	]) {
		expect(subtle).not.toContain(paletteVariable);
		expect(deeper).not.toContain(paletteVariable);
	}
	expect(styles.indexOf("body .tabsdown--nested-odd")).toBeGreaterThan(
		styles.indexOf("body.tabsdown-right-palette-secondary"),
	);
	const background = (body: string): string =>
		/--tabsdown-tab-background:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? "";
	expect(background(subtle)).not.toBe(
		background(matchingRuleBodies(styles, "body.tabsdown-palette-secondary")),
	);
	expect(background(deeper)).not.toBe(background(subtle));
});

test("nested parity tints outrank global and position palettes", () => {
	const styles = readStyles();
	const palettes = [
		"body.tabsdown-palette-secondary .tabsdown",
		...(["top", "bottom", "left", "right"] as const).flatMap((position) =>
			(["primary", "secondary"] as const).map(
				(palette) =>
					`body.tabsdown-${position}-palette-${palette} .tabsdown--${position}`,
			),
		),
	];

	for (const parity of ["odd", "even"] as const) {
		const paritySelector = `body .tabsdown--nested-${parity}.tabsdown`;
		const parityBody = matchingRuleBodies(styles, paritySelector);
		expect(parityBody, paritySelector).toContain("--tabsdown-tab-background:");
		for (const paletteSelector of palettes) {
			expect(styles, paletteSelector).toContain(paletteSelector);
			expect(classSelectorCount(paritySelector), paletteSelector).toBeGreaterThanOrEqual(
				classSelectorCount(paletteSelector),
			);
			expect(styles.lastIndexOf(paritySelector), paletteSelector).toBeGreaterThan(
				styles.indexOf(paletteSelector),
			);
		}
	}
});

test("even Card surfaces beat the base card while Flat stays transparent", () => {
	const styles = readStyles();
	const baseSelector = ".tabsdown .tabsdown";
	const evenSelector = "body .tabsdown--nested-even.tabsdown";
	const flatSelector = "body.tabsdown-nested-style-flat .tabsdown .tabsdown";

	expect(matchingRuleBodies(styles, baseSelector)).toContain(
		"background-color: var(--background-secondary)",
	);
	expect(matchingRuleBodies(styles, evenSelector)).toContain(
		"background-color: var(--background-primary)",
	);
	expect(classSelectorCount(evenSelector)).toBeGreaterThanOrEqual(
		classSelectorCount(baseSelector),
	);
	expect(matchingRuleBodies(styles, flatSelector)).toContain(
		"background-color: transparent",
	);
	expect(classSelectorCount(flatSelector)).toBeGreaterThan(
		classSelectorCount(evenSelector),
	);
});

test("position Start and Center beat global Equal plus Wrap", () => {
	const styles = readStyles();
	const globalSelector =
		"body:where(.tabsdown-overflow-wrap).tabsdown-alignment-equal-width .tabsdown:where(:not(.tabsdown--inline-overflow)) > .tabsdown__tablist > .tabsdown__tab";
	const narrow = styles.slice(styles.indexOf("@container (max-width: 28rem)"));
	expect(matchingRuleBodies(styles, globalSelector)).toContain(
		"flex: 1 1 var(--tabsdown-equal-wrap-basis)",
	);

	for (const position of ["top", "bottom", "left", "right"] as const) {
		for (const alignment of ["start", "center"] as const) {
			const positionSelector =
				`body.tabsdown-${position}-alignment-${alignment} ` +
				`.tabsdown--${position} > .tabsdown__tablist > .tabsdown__tab`;
			const body = matchingRuleBodies(styles, positionSelector);
			expect(body, `${position} ${alignment}`).toContain("flex: 0 0 auto");
			expect(body, `${position} ${alignment}`).toContain(
				"min-inline-size: var(--tabsdown-tab-min-size)",
			);
			expect(body, `${position} ${alignment}`).toContain("white-space: normal");
			expect(classSelectorCount(positionSelector)).toBeGreaterThanOrEqual(
				classSelectorCount(globalSelector),
			);
			expect(styles.indexOf(positionSelector)).toBeGreaterThan(
				styles.indexOf(globalSelector),
			);

			if (position === "left" || position === "right") {
				const forced = matchingRuleBodies(
					narrow,
					`body .tabsdown.tabsdown--${position} > .tabsdown__tablist > .tabsdown__tab.tabsdown__tab`,
				);
				expect(forced).toContain("flex: 1 1 0");
				expect(forced).toContain("inline-size: 0");
			}
		}
	}
});

test("keeps position overrides direct, ordered, and mounted-global", () => {
	const styles = readStyles();
	for (const position of ["top", "bottom", "left", "right"]) {
		for (const axis of ["personality", "palette", "alignment"]) {
			const positionClass = `body.tabsdown-${position}-${axis}-`;
			expect(styles, positionClass).toContain(positionClass);
			expect(styles, positionClass).toMatch(
				new RegExp(`tabsdown--${position}[^,{]*> \\.tabsdown__tablist`),
			);
		}
	}

	const globalPersonality = styles.indexOf("body.tabsdown-personality-underline");
	const positionOverride = styles.indexOf("body.tabsdown-top-personality-");
	const responsiveReset = styles.indexOf("@container (max-width: 28rem)");
	expect(globalPersonality).toBeGreaterThan(-1);
	expect(positionOverride).toBeGreaterThan(globalPersonality);
	expect(responsiveReset).toBeGreaterThan(positionOverride);
	expect(styles).not.toMatch(/tabsdown--mounted[^,{]*tabsdown-(top|bottom|left|right)-/);
});

test("fully resets position personality, palette, and alignment", () => {
	const styles = readStyles();
	for (const position of ["top", "bottom", "left", "right"]) {
		const button = matchingRuleBodies(styles, `body.tabsdown-${position}-personality-button`);
		for (const property of [
			"border-width:",
			"border-color:",
			"border-radius:",
			"background-color:",
			"color:",
		]) {
			expect(button, `${position} Button ${property}`).toContain(property);
		}
		expect(button).toContain("--tabsdown-tab-hover-");
		expect(button).toContain("--tabsdown-tab-selected-");

		const underline = matchingRuleBodies(styles, `body.tabsdown-${position}-personality-underline`);
		for (const declaration of [
			"border-color: transparent",
			"border-radius: 0",
			"background-color: transparent",
			"border-block-end-width: var(--tabsdown-underline-thickness",
		]) {
			expect(underline, `${position} Underline ${declaration}`).toContain(declaration);
		}

		const separator = matchingRuleBodies(styles, `body.tabsdown-${position}-personality-separator`);
		expect(separator).toContain("border-color: transparent");
		expect(separator).toContain("background-color: transparent");
		expect(separator).toContain("color: var(--text-muted)");
		expect(matchingSelectors(styles, `body.tabsdown-${position}-personality-separator`)).toContain(".tabsdown__separator:not([hidden])");

		const rail = matchingRuleBodies(styles, `body.tabsdown-${position}-personality-rail`);
		expect(rail).toContain("border-color: transparent");
		expect(rail).toContain("background-color: var(--background-secondary)");
		expect(rail).toContain("background-color: var(--tabsdown-rail-selected-background)");
		expect(rail).toContain("color: var(--tabsdown-tab-selected-color)");
		expect(rail).toContain("padding: 0.375rem");
		expect(rail).toContain("padding-block: 0.125rem");

		for (const palette of ["primary", "secondary"]) {
			const body = matchingRuleBodies(styles, `body.tabsdown-${position}-palette-${palette}`);
			for (const variable of [
				"--tabsdown-tab-background:",
				"--tabsdown-tab-border:",
				"--tabsdown-tab-color:",
				"--tabsdown-tab-hover-background:",
				"--tabsdown-tab-hover-border:",
				"--tabsdown-tab-selected-background:",
				"--tabsdown-tab-selected-border:",
				"--tabsdown-tab-selected-color:",
				"--tabsdown-tab-underline-color:",
				"--tabsdown-rail-selected-background:",
			]) {
				expect(body, `${position} ${palette} ${variable}`).toContain(variable);
			}
		}

		for (const [alignment, justify, flex, minWidth, whiteSpace] of [
			["start", "flex-start", "0 0 auto", "var(--tabsdown-tab-min-size)", "normal"],
			["center", "safe center", "0 0 auto", "var(--tabsdown-tab-min-size)", "normal"],
			["equal-width", "flex-start", "1 0 0", "max-content", "nowrap"],
		] as const) {
			const body = matchingRuleBodies(styles, `body.tabsdown-${position}-alignment-${alignment}`);
			expect(body, `${position} ${alignment}`).toContain(`justify-content: ${justify}`);
			expect(body, `${position} ${alignment}`).toContain(`flex: ${flex}`);
			expect(body, `${position} ${alignment}`).toContain(`min-inline-size: ${minWidth}`);
			expect(body, `${position} ${alignment}`).toContain(`white-space: ${whiteSpace}`);
		}
	}

	for (const position of ["left", "right"]) {
		expect(
			matchingRuleBodies(styles, `.tabsdown--${position} > .tabsdown__tablist > .tabsdown__tab`),
		).toContain("inline-size: 100%");
	}
});

test("resolves underline placement after position overrides", () => {
	const styles = readStyles();
	for (const [placement, width, color] of [
		["top", "--tabsdown-underline-block-start-width", "--tabsdown-underline-block-start-color"],
		["right", "--tabsdown-underline-inline-end-width", "--tabsdown-underline-inline-end-color"],
		["bottom", "--tabsdown-underline-block-end-width", "--tabsdown-underline-block-end-color"],
		["left", "--tabsdown-underline-inline-start-width", "--tabsdown-underline-inline-start-color"],
	] as const) {
		const rule = matchingRuleBodies(styles, `body.tabsdown-underline-placement-${placement} .tabsdown`);
		expect(rule, placement).toContain(`${width}: var(--tabsdown-underline-thickness`);
		expect(rule, placement).toContain(`${color}: var(--tabsdown-tab-selected-border)`);
	}

	const autoLeft = matchingRuleBodies(styles, "body.tabsdown-underline-placement-auto .tabsdown--left");
	const autoRight = matchingRuleBodies(styles, "body.tabsdown-underline-placement-auto .tabsdown--right");
	expect(autoLeft).toContain("--tabsdown-underline-inline-end-width: var(--tabsdown-underline-thickness");
	expect(autoRight).toContain("--tabsdown-underline-inline-start-width: var(--tabsdown-underline-thickness");
	expect(styles.lastIndexOf("/* Close the cascade after position overrides. */")).toBeGreaterThan(
		styles.lastIndexOf("/* Separator and Rail position overrides share one complete reset. */"),
	);
});

test("renders separators as centered, non-layout elements", () => {
	const styles = readStyles();
	const separator = matchingRuleBodies(styles, ".tabsdown__separator");
	expect(separator).toContain("position: absolute");
	expect(separator).toContain("inline-size: 1px");
	expect(separator).toContain("block-size: var(--tabsdown-separator-length, 80%)");
	expect(separator).toContain("inline-size: var(--tabsdown-separator-length, 80%)");
	expect(separator).toContain("pointer-events: none");
	expect(styles).not.toContain("~ .tabsdown__tab");
});

test("reserves bolder formatted label metrics without changing selected tab width", () => {
	const styles = readStyles();
	const content = matchingRuleBodies(styles, ".tabsdown__tab-content");
	const reserve = matchingRuleBodies(styles, ".tabsdown__tab-reserve");
	expect(content).toContain("display: inline-grid");
	expect(reserve).toContain("font-weight: 700");
	expect(reserve).toContain("visibility: hidden");
	expect(reserve).toContain("grid-area: 1 / 1 / 2 / -1");
	expect(reserve).not.toContain("block-size: 0");
	expect(styles).toContain(".tabsdown__tab-reserve--icon");
	expect(styles).toContain("@media (any-pointer: coarse)");
});

test("computed global personalities yield to every explicit position override", () => {
	const style = document.head.appendChild(document.createElement("style"));
	style.textContent = `
		:root {
			--border-width: 1px;
			--tabsdown-tab-background: rgb(10, 20, 30);
			--tabsdown-tab-border: rgb(40, 50, 60);
			--tabsdown-tab-color: rgb(70, 80, 90);
			--tabsdown-tab-selected-background: rgb(100, 110, 120);
			--tabsdown-tab-selected-border: rgb(130, 140, 150);
			--tabsdown-tab-selected-color: rgb(160, 170, 180);
			--tabsdown-underline-thickness: 2px;
			--text-muted: rgb(90, 90, 90);
			--text-normal: rgb(20, 20, 20);
			--background-secondary: rgb(200, 201, 202);
			--background-primary: rgb(240, 241, 242);
		}
		.tabsdown__separator { display: none; }
		${personalityRules(readStyles())}
	`;

	for (const global of ["default", "underline", "separator", "rail"]) {
		for (const position of ["top", "bottom", "left", "right"]) {
			for (const override of ["button", "underline", "separator", "rail"]) {
				document.body.className = `tabsdown-personality-${global} tabsdown-${position}-personality-${override}`;
				const root = document.body.appendChild(document.createElement("div"));
				root.className = `tabsdown tabsdown--${position}`;
				const list = root.appendChild(document.createElement("div"));
				list.className = "tabsdown__tablist";
				const first = list.appendChild(document.createElement("button"));
				const second = list.appendChild(document.createElement("button"));
				first.className = second.className = "tabsdown__tab";
				const separator = second.appendChild(document.createElement("span"));
				separator.className = "tabsdown__separator";

				if (override === "separator") {
					expect(getComputedStyle(separator).display, `${global} → ${position} ${override}`).toBe("block");
				} else {
					expect(getComputedStyle(separator).display, `${global} → ${position} ${override}`).toBe("none");
				}
				const track = getComputedStyle(list).backgroundColor;
				if (override === "rail") {
					expect(track, `${global} → ${position} ${override}`).toBe(
						"var(--background-secondary)",
					);
				} else {
					expect(["transparent", "rgba(0, 0, 0, 0)"], `${global} → ${position} ${override}`).toContain(track);
				}
				root.remove();
			}
		}
	}
	style.remove();
});

test("wires appearance controls without breaking touch, labels, or spacing", () => {
	const styles = readStyles();

	expect(styles).toMatch(/@media \(hover: hover\) \{[\s\S]*?\.tabsdown__tab:hover/);
	expect(styles).toMatch(/\.tabsdown__tab:focus-visible[\s\S]*?outline:/);
	expect(styles).toMatch(/box-shadow:\s*none/);
	const outlineId = settingId(styleSetting(styles, "title", "Use theme button outline"));
	const outline = matchingRuleBodies(styles, `body.${outlineId}`);
	expect(outline).toContain("--input-shadow");
	expect(outline).toContain("--input-shadow-hover");
	expect(outline).not.toContain("outline:");
	const selectedUnderline = matchingRuleBodies(styles, "personality-underline");
	expect(selectedUnderline).toMatch(/border-block-end-width:\s*var\(--tabsdown-underline-thickness/);
	const underlineHover = matchingRuleBodies(styles, "personality-underline .tabsdown__tab:not(");
	expect(underlineHover).toMatch(/border-block-end-color:\s*var\(--tabsdown-tab-hover-border\)/);
	expect(underlineHover).not.toMatch(/border-block-end-width:/);
	expect(underlineHover).toMatch(/color:\s*var\(--text-normal\)/);
	expect(styles).toMatch(
		/personality-underline[^,{]*\.tabsdown__tab:not\(\[aria-selected="true"\]\):not\(\[aria-expanded="true"\]\):hover/,
	);
	const selectedUnderlineHover = matchingRuleBodies(
		styles,
		'personality-underline .tabsdown__tab[aria-selected="true"]:hover',
	);
	expect(selectedUnderlineHover).not.toMatch(/border-block-end-(color|width):/);
	const globalOverflowScope = ".tabsdown:not(.tabsdown--inline-overflow) > .tabsdown__tablist";
	expect(matchingSelectors(styles, "body.tabsdown-overflow-wrap")).toContain(globalOverflowScope);
	expect(matchingSelectors(styles, "body.tabsdown-overflow-scroll")).toContain(globalOverflowScope);
	expect(matchingRuleBodies(styles, ".tabsdown__tablist")).toContain(
		"gap: var(--tabsdown-gap, 0.25rem)",
	);
	expect(styles).not.toContain("--tabsdown-effective-gap");
	expect(styles).not.toContain("body.tabsdown-overflow-scroll .tabsdown--multi > .tabsdown__tablist");
	expect(styles).toMatch(/\.tabsdown__tab \{[^}]*max-inline-size:\s*100%/);
	expect(styles).toMatch(/\.tabsdown__tab\[hidden\] \{[^}]*display:\s*none/);
	expect(styles).toMatch(/\.tabsdown__tab-label \{[^}]*min-inline-size:\s*0[^}]*overflow-wrap:\s*anywhere/);
	expect(styles).not.toMatch(/\.tabsdown__tab-label \{[^}]*(text-overflow:\s*ellipsis|white-space:\s*nowrap)/);
	expect(styles).toMatch(/\.tabsdown__tab-icon \{[^}]*--icon-size:\s*var\([^,]+,\s*1em\)/);
	expect(styles).toMatch(/\.tabsdown__tab-icon \{[^}]*margin-inline-end:\s*var\([^,]+,\s*0\.35em\)/);

	const defaultDensity = matchingRuleBodies(styles, "body.tabsdown-density-default .tabsdown");
	const compactDensity = matchingRuleBodies(styles, "body.tabsdown-density-compact .tabsdown");
	expect(defaultDensity).not.toContain("--tabsdown-content-spacing");
	const paddingSlider = settingId(styleSetting(styles, "title", "Horizontal padding"));
	expect(defaultDensity).toContain(`var(--${paddingSlider}, 36px)`);
	expect(compactDensity).toContain(`var(--${paddingSlider}, 12px)`);
	const sideSlider = settingId(styleSetting(styles, "title", "Side-list width"));
	for (const position of ["left", "right"]) {
		const sideList = matchingRuleBodies(styles, `.tabsdown--${position} > .tabsdown__tablist`);
		expect(sideList).toContain(
			`var(--${sideSlider}, auto)`,
		);
		expect(sideList).toContain("max-inline-size: calc(");
		expect(sideList).toContain("--tabsdown-side-panel-min");
		expect(sideList).toContain("align-items: stretch");
	}
	const weightId = settingId(styleSetting(styles, "title", "Selected tab font weight"));
	for (const value of ["thinner", "default", "bolder"]) {
		const selectors = [...styles.matchAll(/([^{}]+)\{[^{}]*font-weight:[^{}]*\}/g)]
			.map((match) => match[1] ?? "")
			.filter((selector) => selector.includes(`body.${weightId}-${value}`))
			.join("\n");
		expect(selectors).toMatch(/\[aria-(selected|expanded)="true"\]/);
		expect(selectors).not.toMatch(/\.tabsdown__tab\s*(,|$)/m);
	}
	expect(styles).toMatch(/\.tabsdown--top > \.tabsdown__tablist \{[^}]*margin-block-end:\s*var\(--tabsdown-content-spacing/);
	expect(styles).toMatch(/\.tabsdown--bottom > \.tabsdown__tablist \{[^}]*margin-block-start:\s*var\(--tabsdown-content-spacing/);
	expect(styles).toMatch(/\.tabsdown--left,[\s\S]*?\.tabsdown--right \{[^}]*gap:\s*var\(--tabsdown-content-spacing/);
	const narrow = styles.slice(styles.indexOf("@container (max-width: 28rem)"));
	expect(narrow).toMatch(/inline-size:\s*100%/);
	expect(narrow).toMatch(/max-inline-size:\s*100%/);
	expect(narrow).not.toContain(`var(--${sideSlider})`);
});

test("documents the public horizontal padding variable", () => {
	const readme = readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../README.md"),
		"utf8",
	);
	expect(readme).toContain("--tabsdown-horizontal-padding: 1.5rem");
	expect(readme).not.toContain("--tabsdown-tab-padding-inline");
});

test("panels contain their own margins so height stays stable", () => {
	const styles = readStyles();
	// Anchored, so a position-specific rule ending in the same class does not
	// shadow the base rule this asserts on.
	const panels = /^\.tabsdown__panels \{([^}]*)\}/m.exec(styles)?.[1] ?? "";
	const panel =
		/^\.tabsdown__panel,\s*\n\.tabsdown__content \{([^}]*)\}/m.exec(styles)?.[1] ??
		"";

	expect(panels).toMatch(/display:\s*flow-root/);
	expect(panels).toMatch(/box-sizing:\s*border-box/);
	expect(styles).toMatch(/^\.tabsdown__content \{\s*display:\s*flow-root/m);
	expect(panel).not.toMatch(/\bdisplay\s*:/);
});

test("a narrow block moves its side tab list off the panels' line", () => {
	const styles = readStyles();
	const query = /@container \([^)]*\) \{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? "";

	// A grid here collapsed the panel column to zero width in a narrow pane, and
	// the query has to measure the block, not the viewport, so a note docked in a
	// sidebar recovers too.
	expect(styles).toMatch(/^\.tabsdown \{[^}]*container-type:\s*inline-size/m);
	const sideLayout = /^\.tabsdown--left,\s*\n\.tabsdown--right \{([^}]*)\}/m.exec(styles)?.[1] ?? "";
	expect(sideLayout).not.toContain("grid-template-columns");
	expect(query).toMatch(/flex-basis:\s*100%/);
	expect(query).toMatch(/flex-direction:\s*row/);
});

test("a wrapped right-side tab list stays above its panels", () => {
	const styles = readStyles();

	// Ordering the tab list instead would hand the first line to the panels
	// whenever a long list forces a wrap, at any width, leaving the tabs stranded
	// below the content.
	expect(styles).toMatch(/\.tabsdown--right \{[^}]*flex-direction:\s*row-reverse/);
	expect(styles).not.toMatch(/\.tabsdown--right > \.tabsdown__tablist \{[^}]*order:/);
});

test("side tabs are equal width in wide and narrow layouts", () => {
	const styles = readStyles();
	for (const position of ["left", "right"]) {
		expect(
			matchingRuleBodies(styles, `.tabsdown--${position} > .tabsdown__tablist > .tabsdown__tab`),
		).toContain("flex: 0 0 auto");
		expect(
			matchingRuleBodies(styles, `.tabsdown--${position} > .tabsdown__tablist > .tabsdown__tab`),
		).toContain("min-inline-size: 0");
		const narrow = styles.slice(styles.indexOf("@container (max-width: 28rem)"));
		const forced = matchingRuleBodies(
			narrow,
			`body .tabsdown.tabsdown--${position} > .tabsdown__tablist > .tabsdown__tab.tabsdown__tab`,
		);
		expect(forced).toContain("flex: 1 1 0");
		expect(forced).toContain("inline-size: 0");
	}
	const coarse = styles.slice(
		styles.indexOf("@media (any-pointer: coarse)"),
		styles.indexOf("@container (max-width: 28rem)"),
	);
	expect(coarse).toContain(".tabsdown-top-personality-button");
	expect(coarse).toContain(
		"--tabsdown-tab-min-block-size: var(--tabsdown-tab-min-size)",
	);
});

test("wrapped equal-width rows align and the final row fills the list", () => {
	const styles = readStyles();
	expect(styles).not.toContain("grid-template-columns: repeat");
	expect(styles).toMatch(
		/6em \+ var\(--tabsdown-tab-padding-inline\) \+\s*var\(--tabsdown-tab-padding-inline\)/,
	);
	expect(styles).not.toMatch(
		/ch \+ var\(--tabsdown-tab-padding-inline\)/,
	);
	for (const position of ["top", "bottom"] as const) {
		const selector = `body.tabsdown-overflow-wrap.tabsdown-${position}-alignment-equal-width`;
		expect(matchingRuleBodies(styles, selector)).toContain(
			"flex: 1 1 var(--tabsdown-equal-wrap-basis)",
		);
	}
	const narrow = styles.slice(styles.indexOf("@container (max-width: 28rem)"));
	expect(narrow).toContain("tabsdown-left-alignment-equal-width");
	expect(narrow).toContain("tabsdown-right-alignment-equal-width");
	expect(narrow).toContain("flex: 1 1 var(--tabsdown-equal-wrap-basis)");
	expect(narrow).toContain("inline-size: auto");
});
