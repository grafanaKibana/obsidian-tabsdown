import { Component, MarkdownRenderChild, type MarkdownPostProcessorContext, type MarkdownSectionInformation, type Plugin } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMarkerReading, type MarkerMarkdownRenderer } from "../src/marker-reading";

const block = "%% tabs %%\n%% tab: One %%\nFirst\n%% tab: Two %%\nSecond\n%% endtabs %%";

function fixture(source = block, render?: MarkerMarkdownRenderer) {
	const lifecycle = new Component();
	lifecycle.load();
	let processor: (element: HTMLElement, context: MarkdownPostProcessorContext) => void = () => {};
	const plugin = Object.assign(lifecycle, {
		registerMarkdownPostProcessor(callback: typeof processor) { processor = callback; },
	});
	const renderer = vi.fn<MarkerMarkdownRenderer>(render ?? ((_markdown, element) => {
		element.appendChild(document.createElement("section")).textContent = "Rendered";
		return Promise.resolve();
	}));
	registerMarkerReading(plugin as unknown as Plugin, renderer);
	const container = document.body.appendChild(document.createElement("div"));
	container.className = "markdown-preview-section";
	const infos = new Map<HTMLElement, MarkdownSectionInformation>();
	function section(lineStart: number, lineEnd: number, options: { detached?: boolean; text?: string; docId?: string } = {}) {
		const element = document.createElement("div");
		const original = element.appendChild(document.createElement("p"));
		original.textContent = options.text ?? `Source ${lineStart}`;
		if (!options.detached) container.append(element);
		infos.set(element, { text: source, lineStart, lineEnd });
		const owner = lifecycle.addChild(new MarkdownRenderChild(element));
		const context: MarkdownPostProcessorContext = {
			docId: options.docId ?? "document", sourcePath: "note.md", frontmatter: undefined,
			addChild: (child) => { owner.addChild(child); },
			getSectionInfo: (node) => infos.get(node) ?? null,
		};
		return { element, original, owner, context, process: () => processor(element, context) };
	}
	return { lifecycle, renderer, container, infos, section };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function footnoteReference(parent: HTMLElement, id: string, label = id): void {
	const reference = parent.appendChild(document.createElement("sup"));
	reference.className = "footnote-ref";
	const link = reference.appendChild(document.createElement("a"));
	link.setAttribute("href", `#${id}`);
	link.setAttribute("data-footref", label);
	link.textContent = "[1]";
}

function footnoteFooter(parent: HTMLElement, ids: string[]): HTMLElement {
	const footer = parent.appendChild(document.createElement("section"));
	footer.className = "footnotes";
	const list = footer.appendChild(document.createElement("ol"));
	for (const id of ids) {
		const entry = list.appendChild(document.createElement("li"));
		entry.id = id;
		entry.textContent = "Native definition.";
	}
	return footer;
}

afterEach(() => { document.body.replaceChildren(); });

describe("marker Reading View coordination", () => {
	it("waits for every nonblank line across sections and supplies the authoritative source bounds", async () => {
		const f = fixture();
		const first = f.section(0, 1);
		const middle = f.section(2, 3);
		const last = f.section(4, 5);
		first.process(); last.process();
		expect(f.renderer).not.toHaveBeenCalled();
		middle.process();
		expect(first.original.classList.contains("tabsdown-marker-hidden")).toBe(false);
		await settle();
		expect(f.renderer).toHaveBeenCalledTimes(1);
		const call = f.renderer.mock.calls[0]!;
		expect(call[0]).toBe(block);
		expect(call[2].getSectionInfo(call[1])).toEqual({ text: block, lineStart: 0, lineEnd: 5 });
		expect([first, middle, last].every((section) => section.original.hidden)).toBe(true);
		expect([first, middle, last].every((section) => section.original.classList.contains("tabsdown-marker-hidden"))).toBe(true);
		expect(first.element.querySelector<HTMLElement>(".tabsdown-marker-reading")?.hidden).toBe(false);
		f.lifecycle.unload();
		expect([first, middle, last].every((section) => !section.original.hidden)).toBe(true);
		expect([first, middle, last].every((section) => !section.original.classList.contains("tabsdown-marker-hidden"))).toBe(true);
		expect(f.container.querySelector(".tabsdown-marker-reading")).toBeNull();
	});

	it("renders shared surrounding paragraphs and adjacent layouts together without swallowing neighboring sections", async () => {
		const source = `Heading\n\nBefore\n${block}\nBetween\n${block}\nAfter\n\nFooter`;
		const f = fixture(source);
		const heading = f.section(0, 0);
		const shared = f.section(2, 16);
		const footer = f.section(18, 18);
		heading.process(); shared.process(); footer.process();
		await settle();
		expect(f.renderer).toHaveBeenCalledTimes(1);
		expect(f.renderer.mock.calls[0]![0]).toBe(`Before\n${block}\nBetween\n${block}\nAfter\n`);
		expect(shared.original.hidden).toBe(true);
		expect(heading.original.hidden).toBe(false);
		expect(footer.original.hidden).toBe(false);
		f.lifecycle.unload();
	});

	it("retains original visibility on failure and releases children created during the failed render", async () => {
		const disposed = vi.fn();
		const report = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new Error("Rendering failed");
		const f = fixture(block, (_markdown, _element, _context, owner) => {
			owner.addChild(new Component()).register(disposed);
			return Promise.reject(error);
		});
		const section = f.section(0, 5);
		section.process(); await settle();
		expect(section.original.hidden).toBe(false);
		expect(section.original.classList.contains("tabsdown-marker-hidden")).toBe(false);
		expect(report).toHaveBeenCalledWith("Tabsdown failed to render marker tabs in note.md.", error);
		expect(disposed).toHaveBeenCalledTimes(1);
		expect(section.element.querySelector(".tabsdown-marker-reading")).toBeNull();
		f.lifecycle.unload();
	});

	it.each(["source", "range", "removed", "unload"])("does not commit an asynchronous render after %s changes", async (change) => {
		let finish!: () => void;
		const f = fixture(block, () => new Promise<void>((resolve) => { finish = resolve; }));
		const section = f.section(0, 5);
		section.process();
		expect(section.original.hidden).toBe(false);
		if (change === "source") f.infos.set(section.element, { text: `${block}\nChanged`, lineStart: 0, lineEnd: 5 });
		if (change === "range") f.infos.set(section.element, { text: block, lineStart: 1, lineEnd: 5 });
		if (change === "removed") section.element.remove();
		if (change === "unload") f.lifecycle.unload();
		finish(); await settle();
		expect(section.original.hidden).toBe(false);
		expect(section.element.querySelector(".tabsdown-marker-reading")).toBeNull();
		f.lifecycle.unload();
	});

	it.each(["children", "content"])("retries once when native async rendering changes section %s", async (change) => {
		const finishes: Array<() => void> = [];
		const disposed = vi.fn();
		const f = fixture(block, (_markdown, _element, _context, owner) => {
			owner.register(disposed);
			return new Promise<void>((resolve) => { finishes.push(resolve); });
		});
		const section = f.section(0, 5);
		section.process();
		const native = change === "children" ? document.createElement("p") : section.original;
		if (change === "children") section.original.replaceWith(native);
		native.textContent = "Finished native Markdown";
		finishes[0]!(); await settle();
		expect(f.renderer).toHaveBeenCalledTimes(2);
		expect(disposed).toHaveBeenCalledTimes(1);
		expect(native.hidden).toBe(false);
		expect(f.container.querySelectorAll(".tabsdown-marker-reading")).toHaveLength(1);
		finishes[1]!(); await settle();
		expect(native.hidden).toBe(true);
		expect(f.renderer).toHaveBeenCalledTimes(2);
		f.lifecycle.unload();
		expect(disposed).toHaveBeenCalledTimes(2);
		expect(native.hidden).toBe(false);
		expect(f.container.querySelector(".tabsdown-marker-reading")).toBeNull();
	});

	it("cancels a pending native-DOM retry when its section unloads", async () => {
		const finishes: Array<() => void> = [];
		const f = fixture(block, () => new Promise<void>((resolve) => { finishes.push(resolve); }));
		const section = f.section(0, 5);
		section.process();
		section.original.textContent = "Finished native Markdown";
		finishes[0]!(); await settle();
		expect(f.renderer).toHaveBeenCalledTimes(2);
		section.owner.unload();
		finishes[1]!(); await settle();
		expect(section.original.hidden).toBe(false);
		expect(f.renderer).toHaveBeenCalledTimes(2);
		expect(f.container.querySelector(".tabsdown-marker-reading")).toBeNull();
		f.lifecycle.unload();
	});

	it("hides a native footnote footer only after replacement succeeds and restores it on unload", async () => {
		let finish!: () => void;
		const source = block.replace("First", "First[^1].\n\n[^1]: Definition.");
		const f = fixture(source, (_markdown, element) => {
			footnoteReference(element, "fn-1-synthetic", "fn-1-native");
			footnoteFooter(element, ["fn-1-synthetic"]);
			return new Promise<void>((resolve) => { finish = resolve; });
		});
		const section = f.section(0, 7);
		footnoteReference(section.original, "fn-1-native");
		const footer = f.section(8, 8);
		const footnotes = footnoteFooter(footer.original, ["fn-1-native"]);
		const entry = footnotes.querySelector("li")!;
		section.process(); footer.process();
		expect(footnotes.hidden).toBe(false);
		finish(); await settle();
		expect(entry.hidden).toBe(true);
		expect(footnotes.hidden).toBe(true);
		expect(footer.original.hidden).toBe(false);
		section.owner.unload();
		expect(entry.hidden).toBe(false);
		expect(footnotes.hidden).toBe(false);
		expect(entry.classList.contains("tabsdown-marker-hidden")).toBe(false);
		f.lifecycle.unload();
	});

	it("preserves shared outside references and other footer entries, including sections arriving later", async () => {
		const source = `${block}\n\nOutside[^shared].`;
		const f = fixture(source, (_markdown, element) => {
			footnoteReference(element, "fn-private-synthetic", "fn-private");
			footnoteReference(element, "fn-shared-synthetic", "fn-shared");
			footnoteFooter(element, ["fn-private-synthetic", "fn-shared-synthetic"]);
			return Promise.resolve();
		});
		const section = f.section(0, 5);
		footnoteReference(section.original, "fn-private");
		footnoteReference(section.original, "fn-shared");
		section.process(); await settle();
		const footer = f.section(8, 8);
		const footnotes = footnoteFooter(footer.original, ["fn-private", "fn-shared", "fn-unused"]);
		footer.process(); await settle();
		const [privateEntry, sharedEntry, unusedEntry] = Array.from(footnotes.querySelectorAll("li"));
		expect(privateEntry!.hidden).toBe(true);
		expect(sharedEntry!.hidden).toBe(true);
		expect(unusedEntry!.hidden).toBe(false);
		expect(footnotes.hidden).toBe(false);
		const outside = f.section(7, 7);
		footnoteReference(outside.original, "fn-shared");
		outside.process(); await settle();
		expect(privateEntry!.hidden).toBe(true);
		expect(sharedEntry!.hidden).toBe(false);
		expect(footnotes.hidden).toBe(false);
		f.lifecycle.unload();
		expect(privateEntry!.hidden).toBe(false);
	});

	it.each(["reference", "definition"])("preserves native footnotes when the replacement lacks its %s", async (missing) => {
		const f = fixture(block, (_markdown, element) => {
			if (missing !== "reference") footnoteReference(element, "fn-synthetic", "shared");
			if (missing !== "definition") footnoteFooter(element, ["fn-synthetic"]);
			return Promise.resolve();
		});
		const section = f.section(0, 5);
		footnoteReference(section.original, "fn-native", "shared");
		const footer = f.section(6, 6);
		const footnotes = footnoteFooter(footer.original, ["fn-native"]);
		section.process(); footer.process(); await settle();
		expect(footnotes.hidden).toBe(false);
		expect(footnotes.querySelector("li")!.hidden).toBe(false);
		f.lifecycle.unload();
	});

	it("does not classify a shared surrounding section or synthetic panel reference as marker-only", async () => {
		const source = `Outside[^1].\n\n${block}`;
		const f = fixture(source, (_markdown, element) => {
			footnoteReference(element, "fn-shared-synthetic", "fn-shared");
			footnoteReference(element, "fn-synthetic");
			footnoteFooter(element, ["fn-shared-synthetic", "fn-synthetic"]);
			return Promise.resolve();
		});
		const shared = f.section(0, 7);
		footnoteReference(shared.original, "fn-shared");
		const footer = f.section(8, 8);
		footnoteFooter(footer.original, ["fn-shared", "fn-synthetic"]);
		shared.process(); footer.process(); await settle();
		expect(Array.from(footer.original.querySelectorAll("li")).every((entry) => !entry.hidden)).toBe(true);
		f.lifecycle.unload();
	});

	it("observes pre-insertion sections and cancels pending observers on teardown", async () => {
		const f = fixture();
		const section = f.section(0, 5, { detached: true });
		section.process();
		expect(f.renderer).not.toHaveBeenCalled();
		f.container.append(section.element);
		await settle();
		expect(f.renderer).toHaveBeenCalledTimes(1);
		expect(section.original.hidden).toBe(true);
		const pending = f.section(0, 5, { detached: true, docId: "other" });
		pending.process(); pending.owner.unload();
		f.container.append(pending.element);
		await settle();
		expect(f.renderer).toHaveBeenCalledTimes(1);
		f.lifecycle.unload();
	});

	it("disposes older source renders without hiding or restoring over a newer render", async () => {
		const finishes: Array<() => void> = [];
		const disposed = vi.fn();
		const f = fixture(block, (_markdown, element, _context, owner) => {
			owner.register(disposed);
			element.appendChild(document.createElement("p")).textContent = "Rendered";
			return new Promise<void>((resolve) => { finishes.push(resolve); });
		});
		const section = f.section(0, 5);
		section.process();
		const updated = block.replace("First", "Updated");
		f.infos.set(section.element, { text: updated, lineStart: 0, lineEnd: 5 });
		section.process();
		expect(disposed).toHaveBeenCalledTimes(1);
		expect(f.renderer).toHaveBeenCalledTimes(2);
		finishes[1]!(); await settle();
		expect(section.original.hidden).toBe(true);
		finishes[0]!(); await settle();
		expect(section.original.hidden).toBe(true);
		expect(section.element.querySelectorAll(".tabsdown-marker-reading")).toHaveLength(1);
		f.lifecycle.unload();
		expect(disposed).toHaveBeenCalledTimes(2);
		expect(section.original.hidden).toBe(false);
	});

	it("ignores synthetic tab panels, widgets, fenced bodies, and incomplete marker layouts", () => {
		for (const className of ["tabsdown", "tabsdown-marker-widget", "tabsdown-marker-reading"]) {
			const f = fixture();
			const section = f.section(0, 5);
			section.element.className = className;
			section.process();
			expect(f.renderer).not.toHaveBeenCalled();
			f.lifecycle.unload();
		}
		for (const source of [`\`\`\`tabs\n--- One\n${block}\n--- Two\ntext\n\`\`\``, block.replace("%% endtabs %%", "")]) {
			const f = fixture(source);
			f.section(0, source.split("\n").length - 1).process();
			expect(f.renderer).not.toHaveBeenCalled();
			f.lifecycle.unload();
		}
	});

	it("restores previously hidden elements and text nodes exactly when a section unloads", async () => {
		const f = fixture();
		const section = f.section(0, 5);
		section.original.hidden = true;
		section.original.classList.add("tabsdown-marker-hidden");
		const text = document.createTextNode("Original text");
		section.element.append(text);
		section.process(); await settle();
		expect(text.parentElement?.hidden).toBe(true);
		expect(text.parentElement?.classList.contains("tabsdown-marker-hidden")).toBe(true);
		section.owner.unload();
		expect(section.original.hidden).toBe(true);
		expect(section.original.classList.contains("tabsdown-marker-hidden")).toBe(true);
		expect(text.parentElement).toBe(section.element);
		expect(section.element.childNodes).toHaveLength(2);
		f.lifecycle.unload();
	});
});
