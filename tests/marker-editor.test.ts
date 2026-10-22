// eslint-disable-next-line import/no-extraneous-dependencies -- Obsidian supplies the public CM6 runtime under test.
import { ChangeSet, Compartment, EditorState, type Extension } from "@codemirror/state";
// eslint-disable-next-line import/no-extraneous-dependencies -- Obsidian supplies the public CM6 runtime under test.
import { EditorView } from "@codemirror/view";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { App, PluginManifest } from "obsidian";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import TabsdownPlugin from "../src/main";
import { editorInfoEffect, editorInfoField, editorLivePreviewField, MarkdownView, renderMock, TFile } from "./obsidian.mock";
import { stubResizeObserver } from "./panel-size";

const marker = "Before\n\n%% tabs %%\n%% tab: One %%\nFirst\n%% tab: Two %%\nSecond\n%% endtabs %%\n\nAfter";
const fenced = "Before\n\n```tabsdown\ntab: One\nFirst\ntab: Two\nSecond\n```\n\nAfter";
const cleanups: Array<() => void> = [];

function key(element: HTMLElement, value: string, modifiers: KeyboardEventInit = {}): void {
	element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers }));
}

async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function setup(source = marker, options: { live?: boolean; readOnly?: boolean } = {}) {
	const file = new TFile("Note.md");
	const pushScope = vi.fn();
	const popScope = vi.fn();
	const leaves = vi.fn<() => Array<{ view: MarkdownView & { getMode(): string } }>>(() => []);
	const app = {
		vault: { on: vi.fn(), getAbstractFileByPath: () => file },
		metadataCache: { on: vi.fn() },
		workspace: { getLeavesOfType: leaves, getActiveViewOfType: () => null, trigger: vi.fn() },
		keymap: { pushScope, popScope },
		scope: {},
	} as unknown as App;
	const plugin = new TabsdownPlugin(app, {} as PluginManifest);
	let extension: Extension | undefined;
	vi.spyOn(plugin, "registerEditorExtension").mockImplementation((value) => { extension = value; });
	plugin.load();
	if (!extension) throw new Error("Plugin did not register its editor extension");
	const parent = document.body.appendChild(document.createElement("div"));
	let replay = false;
	const undoStack: Array<{ undo: ChangeSet; redo: ChangeSet }> = [];
	const redoStack: typeof undoStack = [];
	const undo = vi.fn(() => {
		const entry = undoStack.pop();
		if (!entry) return;
		replay = true;
		try { view.dispatch({ changes: entry.undo }); } finally { replay = false; }
		redoStack.push(entry);
	});
	const redo = vi.fn(() => {
		const entry = redoStack.pop();
		if (!entry) return;
		replay = true;
		try { view.dispatch({ changes: entry.redo }); } finally { replay = false; }
		undoStack.push(entry);
	});
	const info = new Compartment();
	const readOnly = new Compartment();
	const view = new EditorView({
		parent,
		state: EditorState.create({ doc: source, extensions: [
			info.of(editorInfoField.init(() => ({ file, editor: { undo, redo } }))),
			editorLivePreviewField.init(() => options.live ?? true),
			readOnly.of(EditorState.readOnly.of(options.readOnly ?? false)), extension,
		] }),
		dispatchTransactions: (transactions, host) => {
			for (const transaction of transactions) {
				if (transaction.docChanged && !replay) {
					undoStack.push({ undo: transaction.changes.invert(transaction.startState.doc), redo: transaction.changes });
					redoStack.length = 0;
				}
			}
			host.update(transactions);
		},
	});
	cleanups.push(() => { view.destroy(); plugin.unload(); parent.remove(); });
	await settle();
	return {
		view, plugin, parent, undo, redo, pushScope, popScope, leaves, file,
		setReadOnly: (value: boolean) => view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) }),
		switchFile: (next: TFile) => view.dispatch({ effects: editorInfoEffect.of({ file: next, editor: { undo, redo } }) }),
		widget: () => parent.querySelector<HTMLElement>(".tabsdown-marker-widget")!,
		panel: (index = 0) => parent.querySelectorAll<HTMLElement>(".tabsdown__panel")[index]!,
		child: () => {
			const dom = parent.querySelector<HTMLElement>(".tabsdown-inline-editor .cm-editor");
			if (!dom) throw new Error("Expected an active tab editor");
			return EditorView.findFromDOM(dom)!;
		},
	};
}

beforeEach(() => {
	const observer = stubResizeObserver();
	cleanups.push(() => observer.restore());
	Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
	Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
	renderMock.mockReset();
	renderMock.mockImplementation(async (_app, markdown, element) => {
		// Preserve the inert nested-layout slots as Obsidian's Markdown renderer
		// does, while retaining paragraphs as the editable panel click targets.
		const slots = /<div data-tabsdown-placeholder="([^"]+)"><\/div>/g;
		let cursor = 0;
		for (const match of markdown.matchAll(slots)) {
			const before = markdown.slice(cursor, match.index);
			if (before) element.appendChild(document.createElement("p")).textContent = before;
			const slot = element.appendChild(document.createElement("div"));
			slot.dataset.tabsdownPlaceholder = match[1];
			cursor = match.index + match[0].length;
		}
		const after = markdown.slice(cursor);
		if (after || cursor === 0) element.appendChild(document.createElement("p")).textContent = after;
	});
});

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	document.body.replaceChildren();
});

describe.each([["markers", marker], ["fences", fenced]])("in-place editing with %s", (_name, source) => {
	test("plugin registration renders tabs and content clicks enter a real body editor", async () => {
		const fixture = await setup(source);
		expect(fixture.parent.querySelectorAll('[role="tab"]')).toHaveLength(2);
		fixture.panel().querySelector("p")!.click();
		expect(fixture.child().state.doc.toString()).toBe("First");
		expect(fixture.pushScope).toHaveBeenCalledOnce();
	});

	test("typing preserves the widget, child editor, selection and other tab", async () => {
		const fixture = await setup(source);
		key(fixture.widget(), "Enter");
		const widget = fixture.widget();
		const child = fixture.child();
		child.dispatch({ changes: { from: 0, insert: "Typed " }, selection: { anchor: 6 } });
		expect(fixture.view.state.doc.toString()).toBe(source.replace("First", "Typed First"));
		expect(fixture.widget()).toBe(widget);
		expect(fixture.child()).toBe(child);
		expect(child.state.selection.main.head).toBe(6);
		expect(child.state.doc.toString()).toBe("Typed First");
	});

	test("switching selects the second body without changing source", async () => {
		const fixture = await setup(source);
		const tabs = fixture.parent.querySelectorAll<HTMLElement>('[role="tab"]');
		tabs[1]!.click();
		await settle();
		expect(fixture.view.state.doc.toString()).toBe(source);
		expect(fixture.panel(0).hidden).toBe(true);
		fixture.panel(1).querySelector("p")!.click();
		const child = fixture.child();
		child.dispatch({ changes: { from: 0, to: child.state.doc.length, insert: "Updated second" } });
		expect(fixture.view.state.doc.toString()).toBe(source.replace("Second", "Updated second"));
		expect(fixture.child()).toBe(child);
	});

	test("host body edits and host Undo/Redo synchronize the existing child", async () => {
		const fixture = await setup(source);
		key(fixture.widget(), "Enter");
		const child = fixture.child();
		const position = fixture.view.state.doc.toString().indexOf("First");
		fixture.view.dispatch({ changes: { from: position, to: position + 5, insert: "Changed" } });
		expect(fixture.child()).toBe(child);
		expect(child.state.doc.toString()).toBe("Changed");
		key(child.contentDOM, "z", { ctrlKey: true });
		expect(fixture.undo).toHaveBeenCalledOnce();
		expect(fixture.child()).toBe(child);
		expect(child.state.doc.toString()).toBe("First");
		key(child.contentDOM, "y", { ctrlKey: true });
		expect(fixture.redo).toHaveBeenCalledOnce();
		expect(fixture.child()).toBe(child);
		expect(child.state.doc.toString()).toBe("Changed");
	});

	test("deleting the entire body preserves the delimiter newline and can continue typing", async () => {
		const fixture = await setup(source);
		key(fixture.widget(), "Enter");
		const child = fixture.child();
		child.dispatch({ changes: { from: 0, to: child.state.doc.length } });
		expect(fixture.view.state.doc.toString()).toBe(source.replace("First\n", "\n"));
		expect(fixture.child()).toBe(child);
		expect(child.state.doc.toString()).toBe("");
		child.dispatch({ changes: { from: 0, insert: "Again" } });
		expect(fixture.view.state.doc.toString()).toBe(source.replace("First", "Again"));
	});

	test("Enter inserts a newline without replacing or closing the editor", async () => {
		const fixture = await setup(source);
		key(fixture.widget(), "Enter");
		const child = fixture.child();
		key(child.contentDOM, "Enter");
		expect(fixture.child()).toBe(child);
		expect(child.state.doc.toString()).toBe("\nFirst");
		expect(fixture.view.state.doc.toString()).toBe(source.replace("First", "\nFirst"));
	});
});

test("Source Mode exposes Markdown and mounts no tabs widget", async () => {
	const fixture = await setup(marker, { live: false });
	expect(fixture.widget()).toBeNull();
	expect(fixture.view.state.doc.toString()).toBe(marker);
});

test("rendered tab bodies use Reading View whitespace and Markdown styling while the editor preserves Markdown whitespace", async () => {
	const style = document.head.appendChild(document.createElement("style"));
	// Obsidian scopes native Markdown list indentation to .markdown-rendered.
	// The host editor preserves source whitespace; rendered bodies must not.
	style.textContent = `
		.markdown-rendered ul { padding-inline-start: 30px; }
		.callout { margin: 1em 0; }
		.markdown-source-view.mod-cm6 .callout { margin: 0; }
	` + readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");
	cleanups.push(() => style.remove());
	renderMock.mockImplementation(async (_app, _markdown, element) => {
		element.appendChild(document.createElement("p")).textContent = "A paragraph.";
		const list = element.appendChild(document.createElement("ul"));
		list.appendChild(document.createElement("li")).textContent = "A list item.";
		element.appendChild(document.createElement("div")).className = "callout";
	});
	const fixture = await setup(marker.replace("First", "A paragraph.\n\n- A list item."));
	fixture.parent.classList.add("markdown-source-view", "mod-cm6");
	fixture.view.contentDOM.style.whiteSpace = "break-spaces";
	const hostCallout = fixture.parent.appendChild(document.createElement("div"));
	hostCallout.className = "callout";
	const reading = document.body.appendChild(document.createElement("div"));
	reading.className = "markdown-rendered";
	const readingList = reading.appendChild(document.createElement("ul"));
	const readingCallout = reading.appendChild(document.createElement("div"));
	readingCallout.className = "callout";
	cleanups.push(() => reading.remove());

	expect(getComputedStyle(fixture.view.contentDOM).whiteSpace).toBe("break-spaces");
	expect(getComputedStyle(fixture.widget()).whiteSpace).toBe("normal");
	expect(getComputedStyle(fixture.panel().querySelector("ul")!).paddingInlineStart)
		.toBe(getComputedStyle(readingList).paddingInlineStart);
	expect(getComputedStyle(readingList).paddingInlineStart).toBe("30px");
	expect(getComputedStyle(fixture.panel().querySelector(".callout")!).margin)
		.toBe(getComputedStyle(readingCallout).margin);
	expect(getComputedStyle(readingCallout).marginTop).not.toBe("0px");
	expect(getComputedStyle(hostCallout).margin).toBe("0px");
	fixture.panel().querySelector("p")!.click();
	expect(["pre-wrap", "break-spaces"]).toContain(getComputedStyle(fixture.child().contentDOM).whiteSpace);
	expect(fixture.child().state.doc.toString()).toBe("A paragraph.\n\n- A list item.");
});

test("read-only Live Preview renders tabs but refuses in-place editing", async () => {
	const fixture = await setup(marker, { readOnly: true });
	key(fixture.widget(), "Enter");
	fixture.panel().click();
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.pushScope).not.toHaveBeenCalled();
});

test("Escape restores rendered content and releases the host keyboard scope", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	key(fixture.child().contentDOM, "Escape");
	await settle();
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.panel().querySelector("p")!.hidden).toBe(false);
	expect(fixture.popScope).toHaveBeenCalledOnce();
});

test("external structural edits dispose the old child instead of writing stale body offsets", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	const position = marker.indexOf("One");
	fixture.view.dispatch({ changes: { from: position, to: position + 3, insert: "Renamed" } });
	await settle();
	expect(child.dom.isConnected).toBe(false);
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.popScope).toHaveBeenCalledOnce();
	expect(fixture.parent.querySelector('[role="tab"]')!.textContent).toContain("Renamed");
});

test("composition retains the editor across blur until composition ends", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	child.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
	const outside = document.body.appendChild(document.createElement("button"));
	outside.focus();
	await settle();
	expect(fixture.child()).toBe(child);
	child.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
	await settle();
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
});

test("destroying the host with a pending blur callback releases the child and scope once", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	child.contentDOM.dispatchEvent(new FocusEvent("blur"));
	fixture.view.destroy();
	await settle();
	expect(child.dom.isConnected).toBe(false);
	expect(fixture.popScope).toHaveBeenCalledOnce();
});

test("select-all and undo route to the active body and host history", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	key(child.contentDOM, "a", { ctrlKey: true });
	expect(child.state.selection.main.from).toBe(0);
	expect(child.state.selection.main.to).toBe(5);
	child.dispatch(child.state.replaceSelection("Replacement"));
	expect(fixture.view.state.doc.toString()).toBe(marker.replace("First", "Replacement"));
	key(child.contentDOM, "z", { ctrlKey: true });
	expect(fixture.view.state.doc.toString()).toBe(marker);
	expect(fixture.child()).toBe(child);
	expect(child.state.doc.toString()).toBe("First");
	key(child.contentDOM, "y", { ctrlKey: true });
	expect(fixture.view.state.doc.toString()).toBe(marker.replace("First", "Replacement"));
	expect(fixture.child()).toBe(child);
});

test("switching away from an edited body restores rendered Markdown without source edits", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	fixture.child().dispatch({ changes: { from: 0, insert: "New " } });
	const source = fixture.view.state.doc.toString();
	const tabs = fixture.parent.querySelectorAll<HTMLElement>('[role="tab"]');
	tabs[1]!.click();
	await settle();
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.view.state.doc.toString()).toBe(source);
	tabs[0]!.click();
	await settle();
	expect(fixture.panel().textContent).toContain("New First");
	expect(fixture.popScope).toHaveBeenCalledOnce();
});

test("blockquote source mapping survives multiline edits without changing other body text", async () => {
	const source = marker.replace(/^(%%|First|Second)/gm, "> $1");
	const fixture = await setup(source);
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	child.dispatch({ changes: { from: 0, to: 5, insert: "Edited\nline" } });
	expect(fixture.view.state.doc.toString()).toBe(source.replace("First", "Edited\n> line"));
	expect(fixture.child()).toBe(child);
	expect(child.state.doc.toString()).toBe("Edited\nline");
});

test("second tab keeps its body mapping after Undo and another inline edit", async () => {
	const fixture = await setup();
	fixture.parent.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click();
	await settle();
	fixture.panel(1).querySelector("p")!.click();
	const child = fixture.child();
	child.dispatch({ changes: { from: 0, to: 6, insert: "Changed" } });
	key(child.contentDOM, "z", { ctrlKey: true });
	expect(fixture.child()).toBe(child);
	expect(fixture.view.state.doc.toString()).toBe(marker);
	child.dispatch({ changes: { from: 0, insert: "Now " } });
	expect(fixture.view.state.doc.toString()).toBe(marker.replace("Second", "Now Second"));
	expect(fixture.widget().querySelector('[aria-selected="true"]')!.textContent).toContain("Two");
});

test("ArrowDown from the selected tab opens its own body", async () => {
	const fixture = await setup();
	const second = fixture.parent.querySelectorAll<HTMLElement>('[role="tab"]')[1]!;
	second.click();
	await settle();
	second.focus();
	key(second, "ArrowDown");
	expect(fixture.child().state.doc.toString()).toBe("Second");
});

test("horizontal boundary arrows leave the body and restore host focus", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	key(child.contentDOM, "ArrowLeft");
	await settle();
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.view.hasFocus).toBe(true);
	expect(fixture.view.state.doc.toString()).toBe(marker);
	expect(fixture.popScope).toHaveBeenCalledOnce();
});

const innerMarkers = "%% tabs %%\n%% tab: Inner one %%\nNested first\n%% tab: Inner two %%\nNested second\n%% endtabs %%";
const innerFenced = "```tabsdown\ntab: Inner one\nNested first\ntab: Inner two\nNested second\n```";

test.each([
	["marker in fenced", "````tabsdown\ntab: Outer one\nParent before\n" + innerMarkers + "\nParent after\ntab: Outer two\nOuter sibling\n````"],
	["fenced in marker", "%% tabs %%\n%% tab: Outer one %%\nParent before\n" + innerFenced + "\nParent after\n%% tab: Outer two %%\nOuter sibling\n%% endtabs %%"],
])("%s edits the innermost active body and preserves parent and siblings", async (_name, source) => {
	const fixture = await setup(source);
	const paragraph = await vi.waitFor(() => {
		const target = Array.from(fixture.widget().querySelectorAll("p")).find((element) => element.textContent?.trim() === "Nested first");
		expect(target).toBeDefined();
		return target!;
	});
	paragraph.click();
	const child = fixture.child();
	expect(child.state.doc.toString()).toBe("Nested first");
	child.dispatch({ changes: { from: 0, to: child.state.doc.length, insert: "Updated nested" } });
	expect(fixture.view.state.doc.toString()).toBe(source.replace("Nested first", "Updated nested"));
	expect(fixture.child()).toBe(child);
});

test("inserting host lines before the layout keeps second-body edits on the moved source", async () => {
	const fixture = await setup();
	fixture.view.dispatch({ changes: { from: 0, insert: "Prepended\n\n" } });
	await settle();
	fixture.parent.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click();
	await settle();
	fixture.panel(1).querySelector("p")!.click();
	fixture.child().dispatch({ changes: { from: 0, insert: "Moved " } });
	expect(fixture.view.state.doc.toString()).toBe("Prepended\n\n" + marker.replace("Second", "Moved Second"));
});

test("incomplete fences reveal focused host source, and closing the fence restores preview", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	child.dispatch({ changes: { from: 0, insert: "```\n" }, selection: { anchor: 4 } });
	await settle();
	expect(fixture.widget()).toBeNull();
	expect(child.dom.isConnected).toBe(false);
	expect(fixture.view.hasFocus).toBe(true);
	expect(fixture.view.state.doc.toString()).toBe(marker.replace("First", "```\nFirst"));
	const cursor = fixture.view.state.selection.main.head;
	expect(fixture.view.state.doc.sliceString(cursor, cursor + 5)).toBe("First");
	fixture.view.dispatch({ changes: { from: cursor, insert: "Continued " } });
	const closeAt = fixture.view.state.doc.toString().indexOf("\n%% tab: Two");
	fixture.view.dispatch({ changes: { from: closeAt, insert: "\n```" } });
	await settle();
	expect(fixture.widget()).not.toBeNull();
	expect(fixture.panel().textContent).toContain("Continued First");
	const invalidAt = fixture.view.state.doc.toString().indexOf("Two");
	fixture.view.dispatch({ changes: { from: invalidAt, to: invalidAt + 3, insert: "One" } });
	await settle();
	expect(fixture.widget()).toBeNull();
});

test("switching files with identical content disposes the old controller", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const previous = fixture.child();
	const widget = fixture.widget();
	fixture.switchFile(new TFile("Other.md"));
	await settle();
	expect(previous.dom.isConnected).toBe(false);
	expect(fixture.widget()).not.toBe(widget);
	expect(fixture.popScope).toHaveBeenCalledOnce();
	key(fixture.widget(), "Enter");
	expect(fixture.child()).not.toBe(previous);
	expect(fixture.view.state.doc.toString()).toBe(marker);
});

test("a public read-only reconfiguration closes the active body editor", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	fixture.setReadOnly(true);
	await settle();
	expect(child.dom.isConnected).toBe(false);
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.popScope).toHaveBeenCalledOnce();
	key(fixture.widget(), "Enter");
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.view.state.doc.toString()).toBe(marker);
});

test.each(["Backspace", "Delete"])("Mod-a and %s delete body text through the public keymap", async (deletionKey) => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	key(child.contentDOM, "a", { ctrlKey: true });
	key(child.contentDOM, deletionKey);
	expect(child.state.doc.toString()).toBe("");
	expect(fixture.view.state.doc.toString()).toBe(marker.replace("First", ""));
	key(child.contentDOM, "Escape");
	await settle();
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.panel().textContent?.trim()).toBe("");
	key(fixture.widget(), "Enter");
	fixture.child().dispatch({ changes: { from: 0, insert: "Continued" } });
	expect(fixture.view.state.doc.toString()).toBe(marker.replace("First", "Continued"));
});

test.each([
	["marker in fenced", "````tabsdown\ntab: Outer one\nParent\n" + innerMarkers + "\ntab: Outer two\nOuter sibling\n````"],
	["fenced in marker", "%% tabs %%\n%% tab: Outer one %%\nParent\n" + innerFenced + "\n%% tab: Outer two %%\nOuter sibling\n%% endtabs %%"],
])("ArrowDown on a nested tab targets %s content", async (_name, source) => {
	const fixture = await setup(source);
	const nestedTab = await vi.waitFor(() => {
		const tab = Array.from(fixture.widget().querySelectorAll<HTMLElement>('[role="tab"]'))
			.find((element) => element.textContent?.includes("Inner one"));
		expect(tab).toBeDefined();
		return tab!;
	});
	nestedTab.focus();
	key(nestedTab, "ArrowDown");
	const child = fixture.child();
	expect(child.state.doc.toString()).toBe("Nested first");
	child.dispatch({ changes: { from: 0, insert: "Inner " } });
	expect(fixture.view.state.doc.toString()).toBe(source.replace("Nested first", "Inner Nested first"));
});

test("identical nested blocks edit their own source occurrence", async () => {
	const source = "%% tabs %%\n%% tab: Outer one %%\n" + innerFenced + "\nBetween\n" + innerFenced + "\n%% tab: Outer two %%\nSibling\n%% endtabs %%";
	const fixture = await setup(source);
	const blocks = await vi.waitFor(() => {
		const nested = fixture.widget().querySelectorAll<HTMLElement>(".tabsdown--nested-odd");
		expect(nested).toHaveLength(2);
		return Array.from(nested);
	});
	blocks[1]!.querySelector<HTMLElement>('[role="tab"]')!.click();
	await settle();
	blocks[1]!.querySelector("p")!.click();
	fixture.child().dispatch({ changes: { from: 0, insert: "Second " } });
	const secondAt = source.lastIndexOf("Nested first");
	const afterSecond = source.slice(0, secondAt) + "Second " + source.slice(secondAt);
	expect(fixture.view.state.doc.toString()).toBe(afterSecond);
	key(fixture.child().contentDOM, "Escape");
	await settle();
	blocks[0]!.querySelector<HTMLElement>('[role="tab"]')!.click();
	await settle();
	blocks[0]!.querySelector("p")!.click();
	fixture.child().dispatch({ changes: { from: 0, insert: "First " } });
	expect(fixture.view.state.doc.toString()).toBe(afterSecond.replace("Nested first", "First Nested first"));
});

test("one source view plus Reading View permits editing while two source views reject it", async () => {
	const fixture = await setup();
	const sourceView = Object.assign(new MarkdownView({}, fixture.file), { getMode: () => "source" });
	const readingView = Object.assign(new MarkdownView({}, fixture.file), { getMode: () => "preview" });
	fixture.leaves.mockReturnValue([{ view: sourceView }, { view: readingView }]);
	key(fixture.widget(), "Enter");
	expect(fixture.child().state.doc.toString()).toBe("First");
	key(fixture.child().contentDOM, "Escape");
	fixture.leaves.mockReturnValue([{ view: sourceView }, { view: Object.assign(new MarkdownView({}, fixture.file), { getMode: () => "source" }) }]);
	key(fixture.widget(), "Enter");
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.view.state.doc.toString()).toBe(marker);
});

test("equivalent widget reuse still disposes its editor and scope on plugin unload", async () => {
	const fixture = await setup();
	key(fixture.widget(), "Enter");
	const child = fixture.child();
	const widget = fixture.widget();
	fixture.setReadOnly(false);
	await settle();
	expect(fixture.widget()).toBe(widget);
	expect(fixture.child()).toBe(child);
	fixture.plugin.unload();
	await settle();
	expect(child.dom.isConnected).toBe(false);
	expect(fixture.parent.querySelector(".tabsdown-inline-editor")).toBeNull();
	expect(fixture.popScope).toHaveBeenCalledOnce();
	fixture.view.destroy();
	expect(fixture.popScope).toHaveBeenCalledOnce();
});

test("external parent text updates appear after leaving a nested editor", async () => {
	const source = "%% tabs %%\n%% tab: Outer one %%\nParent before\n" + innerFenced + "\nParent after\n%% tab: Outer two %%\nSibling\n%% endtabs %%";
	const fixture = await setup(source);
	const paragraph = await vi.waitFor(() => {
		const target = Array.from(fixture.widget().querySelectorAll("p")).find((element) => element.textContent?.trim() === "Nested first");
		expect(target).toBeDefined();
		return target!;
	});
	paragraph.click();
	const before = fixture.view.state.doc.toString().indexOf("Parent before");
	fixture.view.dispatch({ changes: { from: before, to: before + "Parent before".length, insert: "Parent changed" } });
	await settle();
	const childDOM = fixture.parent.querySelector<HTMLElement>(".tabsdown-inline-editor .cm-content");
	if (childDOM) key(childDOM, "Escape");
	await settle();
	expect(fixture.panel().textContent).toContain("Parent changed");
	expect(fixture.panel().textContent).not.toContain("Parent before");
});

for (const [syntax, original, labels] of [
	["markers", marker, ["%% tab: One %%\n", "%% tab: Two %%\n"]],
	["fences", fenced, ["tab: One\n", "tab: Two\n"]],
] as const) {
	test.each([0, 1])(`${syntax} zero-line empty body %i retains the same editor across consecutive characters`, async (index) => {
		const source = original.replace(index === 0 ? "First\n" : "Second\n", "");
		const fixture = await setup(source);
		const tab = fixture.widget().querySelectorAll<HTMLElement>('[role="tab"]')[index]!;
		tab.click();
		await settle();
		key(tab, "ArrowDown");
		const child = fixture.child();
		expect(child.state.doc.toString()).toBe("");
		child.dispatch(child.state.replaceSelection("x"));
		expect(fixture.child()).toBe(child);
		expect(child.state.selection.main.head).toBe(1);
		child.dispatch(child.state.replaceSelection("y"));
		expect(fixture.child()).toBe(child);
		expect(child.state.doc.toString()).toBe("xy");
		expect(child.state.selection.main.head).toBe(2);
		const label = labels[index]!;
		const expected = source.replace(label, label + "xy\n");
		expect(fixture.view.state.doc.toString()).toBe(expected);
		expect(fixture.view.state.selection.main.head).toBe(expected.indexOf("xy\n") + 2);
	});
}

test("a quoted nested zero-line final body keeps the same editor while adding its first source line", async () => {
	const inner = innerFenced.replace("Nested second\n", "");
	const source = ("%% tabs %%\n%% tab: Outer one %%\nParent before\n" + inner + "\nParent after\n%% tab: Outer two %%\nSibling\n%% endtabs %%")
		.split("\n").map((line) => "> " + line).join("\n");
	const fixture = await setup(source);
	const tab = await vi.waitFor(() => {
		const target = Array.from(fixture.widget().querySelectorAll<HTMLElement>('[role="tab"]'))
			.find((element) => element.textContent?.includes("Inner two"));
		expect(target).toBeDefined();
		return target!;
	});
	tab.click();
	await settle();
	key(tab, "ArrowDown");
	const child = fixture.child();
	expect(child.state.doc.toString()).toBe("");
	child.dispatch(child.state.replaceSelection("x"));
	expect(fixture.child()).toBe(child);
	child.dispatch(child.state.replaceSelection("y"));
	expect(fixture.child()).toBe(child);
	expect(child.state.doc.toString()).toBe("xy");
	expect(child.state.selection.main.head).toBe(2);
	const expected = source.replace("> tab: Inner two\n", "> tab: Inner two\n> xy\n");
	expect(fixture.view.state.doc.toString()).toBe(expected);
	expect(fixture.view.state.selection.main.head).toBe(expected.indexOf("xy\n") + 2);
});
