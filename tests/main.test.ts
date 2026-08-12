import type { App, PluginManifest } from "obsidian";
import { beforeEach, expect, test, vi } from "vitest";
import TabsdownPlugin from "../src/main";
import {
	processorRegistrationMock,
	renderMock,
} from "./obsidian.mock";

interface CapturedEvent {
	name: string;
	callback: () => void;
}

const STYLE_SETTINGS_FIXTURE =
	"/* @settings\n\nname: Tabsdown\nid: tabsdown\n*/";

function createPlugin(): {
	app: App;
	editor: {
		focus: ReturnType<typeof vi.fn>;
		setCursor: ReturnType<typeof vi.fn>;
	};
	events: CapturedEvent[];
	getMode: ReturnType<typeof vi.fn>;
	trigger: ReturnType<typeof vi.fn>;
	plugin: TabsdownPlugin;
} {
	const events: CapturedEvent[] = [];
	const on = (name: string, callback: () => void): object => {
		events.push({ name, callback });
		return {};
	};
	const trigger = vi.fn();
	const editor = {
		focus: vi.fn(),
		setCursor: vi.fn(),
	};
	const getMode = vi.fn(() => "source");
	const app = {
		vault: { on },
		metadataCache: { on },
		workspace: {
			getActiveViewOfType: vi.fn(() => ({
				editor,
				file: { path: "Folder/Note.md" },
				getMode,
			})),
			trigger,
		},
	} as unknown as App;
	const manifest = {
		id: "tabsdown",
		name: "Tabsdown",
		version: "0.1.0",
		minAppVersion: "1.0.0",
		description: "Tabbed blocks.",
		author: "grafanaKibana",
		isDesktopOnly: false,
		dir: "",
	} satisfies PluginManifest;
	return {
		app,
		editor,
		events,
		getMode,
		trigger,
		plugin: new TabsdownPlugin(app, manifest),
	};
}

function flush(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

beforeEach(() => {
	processorRegistrationMock.mockReset();
	renderMock.mockReset();
	renderMock.mockImplementation(async (_app, markdown, element) => {
		element.textContent = markdown;
	});
});

test("registers one processor, forwards sourcePath, and advances freshness events", async () => {
	const { events, plugin } = createPlugin();
	plugin.onload();

	expect(processorRegistrationMock).toHaveBeenCalledOnce();
	expect(processorRegistrationMock.mock.calls[0]?.[0]).toBe("tabsdown");
	expect(events.map((event) => event.name)).toEqual([
		"create",
		"modify",
		"delete",
		"rename",
		"changed",
	]);
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected a tabsdown processor.");
	const container = document.createElement("div");
	const addChild = vi.fn((child: { load(): void }) => child.load());
	void handler(
		"tab: One\nFirst\ntab: Two\nSecond",
		container,
		{
			sourcePath: "Folder/Note.md",
			addChild,
			getSectionInfo: () => null,
		},
	);
	await flush();

	expect(addChild).toHaveBeenCalledOnce();
	expect(renderMock).toHaveBeenCalledWith(
		expect.anything(),
		"First\n",
		expect.any(HTMLElement),
		"Folder/Note.md",
		expect.anything(),
	);

	const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
	buttons[1]?.click();
	buttons[0]?.click();
	await flush();
	expect(renderMock).toHaveBeenCalledTimes(2);

	for (const event of events) event.callback();
	buttons[1]?.click();
	await flush();
	expect(renderMock).toHaveBeenCalledTimes(3);
});

test("refreshes Style Settings only after the plugin stylesheet loads", async () => {
	const { plugin, trigger } = createPlugin();
	plugin.onload();

	expect(trigger).not.toHaveBeenCalled();

	const style = document.createElement("style");
	style.textContent = STYLE_SETTINGS_FIXTURE;
	document.head.append(style);
	await flush();

	expect(trigger).toHaveBeenCalledOnce();
	expect(trigger).toHaveBeenCalledWith("parse-style-settings");

	plugin.unload();
	style.remove();
});

test("renders invalid source as text with only the edit bridge", () => {
	const { plugin } = createPlugin();
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected a tabsdown processor.");
	const container = document.createElement("div");
	const addChild = vi.fn();

	void handler("<img src=x onerror=alert(1)>", container, {
		sourcePath: "Note.md",
		addChild,
		getSectionInfo: () => null,
	});

	expect(addChild).toHaveBeenCalledOnce();
	expect(container.querySelector("img")).toBeNull();
	expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
});

test("moves the Live Preview editing locus into a tapped block", async () => {
	const { editor, getMode, plugin } = createPlugin();
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected a tabsdown processor.");
	const container = document.createElement("div");
	const editorRoot = document.createElement("div");
	editorRoot.setAttribute("contenteditable", "true");
	editorRoot.append(container);
	const addChild = vi.fn((child: { load(): void }) => child.load());
	const section = {
		lineEnd: 8,
		lineStart: 3,
		text: "",
	};
	const getSectionInfo = vi.fn<() => typeof section | null>(() => section);

	void handler(
		"tab: One\nFirst\ntab: Two\nSecond",
		container,
		{ sourcePath: "Folder/Note.md", addChild, getSectionInfo },
	);
	await flush();

	container
		.querySelector<HTMLElement>('[role="tabpanel"]')
		?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

	expect(editor.setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 });
	expect(editor.focus).toHaveBeenCalledOnce();
	expect(getSectionInfo).toHaveBeenCalledTimes(2);

	getSectionInfo.mockReturnValue(null);
	container
		.querySelector<HTMLElement>('[role="tabpanel"]')
		?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	expect(editor.setCursor).toHaveBeenCalledTimes(2);

	container.querySelector<HTMLButtonElement>('[role="tab"]')?.click();
	expect(editor.setCursor).toHaveBeenCalledTimes(2);

	getMode.mockReturnValue("preview");
	container
		.querySelector<HTMLElement>('[role="tabpanel"]')
		?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	expect(editor.setCursor).toHaveBeenCalledTimes(2);
});

test("a click inside a nested block reaches the enclosing edit bridge", async () => {
	const { editor, plugin } = createPlugin();
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected a tabsdown processor.");
	const addChild = vi.fn((child: { load(): void }) => child.load());
	const outer = document.createElement("div");
	document.body.append(outer);

	void handler("tab: One\nFirst\ntab: Two\nSecond", outer, {
		sourcePath: "Folder/Note.md",
		addChild,
		getSectionInfo: () => ({ lineEnd: 8, lineStart: 3, text: "" }),
	});
	await flush();

	// A nested block renders through the same processor, but Obsidian reports no
	// section for it.
	const panel = outer.querySelector<HTMLElement>('[role="tabpanel"]');
	const inner = document.createElement("div");
	panel?.append(inner);
	void handler("tab: Inner one\nA\ntab: Inner two\nB", inner, {
		sourcePath: "Folder/Note.md",
		addChild,
		getSectionInfo: () => null,
	});
	await flush();

	inner
		.querySelector<HTMLElement>('[role="tabpanel"]')
		?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

	expect(editor.setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 });
});

test("exposes a tabs API that the plugin tears down on unload", () => {
	const { plugin } = createPlugin();
	plugin.load();
	const container = document.createElement("div");
	document.body.append(container);
	const panel = document.createElement("div");

	const controller = plugin.mountTabs(container, {
		label: "Trace and watch",
		tabs: [{ id: "trace", label: "Trace", panel }],
	});
	controller.setSelection("trace");

	expect(controller.selection).toBe("trace");
	expect(container.querySelector(".tabsdown--mounted")).not.toBeNull();

	plugin.unload();

	expect(container.querySelector(".tabsdown--mounted")).toBeNull();
	expect(panel.parentElement).toBe(container);
	// The consumer may have torn its own controller down first.
	expect(() => {
		controller.destroy();
	}).not.toThrow();
});

test("forgets controllers consumers already destroyed", () => {
	const { plugin } = createPlugin();
	plugin.load();
	const container = document.createElement("div");
	const controller = plugin.mountTabs(container, {
		label: "Trace",
		tabs: [{ id: "trace", label: "Trace", panel: document.createElement("div") }],
	});
	const destroy = vi.spyOn(controller, "destroy");

	controller.destroy();
	plugin.unload();

	expect(destroy).toHaveBeenCalledOnce();
});
