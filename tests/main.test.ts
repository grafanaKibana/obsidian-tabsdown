import type { App, PluginManifest } from "obsidian";
import { beforeEach, expect, test, vi } from "vitest";
import TabsdownPlugin from "../src/main";
import {
	MarkdownView,
	TFile,
	menuItems,
	menuShowAtMouseEventMock,
	menuShowAtPositionMock,
	noticeMock,
	openModals,
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
		vault: {
			on,
			getAbstractFileByPath: vi.fn(() => null),
			cachedRead: vi.fn(),
			process: vi.fn(),
		},
		metadataCache: { on },
		workspace: {
			getLeavesOfType: vi.fn(() => []),
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

function openContextMenu(element: HTMLElement, clientX = 10, clientY = 10): void {
	element.dispatchEvent(new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
		clientX,
		clientY,
	}));
}

function renderedBlocks(container: HTMLElement): HTMLElement[] {
	const nested: HTMLElement[] = [];
	container.querySelectorAll<HTMLElement>(".tabsdown").forEach((block) => nested.push(block));
	return [container, ...nested];
}

beforeEach(() => {
	processorRegistrationMock.mockReset();
	renderMock.mockReset();
	renderMock.mockImplementation(async (_app, markdown, element) => {
		element.textContent = markdown;
	});
	menuItems.splice(0);
	menuShowAtMouseEventMock.mockReset();
	menuShowAtPositionMock.mockReset();
	openModals.splice(0);
	noticeMock.mockReset();
});

function writablePlugin(initial: string, editorCount: number): {
	app: App;
	file: TFile;
	files: Map<string, TFile>;
	plugin: TabsdownPlugin;
	editors: Array<{ getValue: ReturnType<typeof vi.fn>; replaceRange: ReturnType<typeof vi.fn> }>;
	cachedRead: ReturnType<typeof vi.fn<() => Promise<string>>>;
	process: ReturnType<typeof vi.fn<
		(file: TFile, transform: (text: string) => string) => Promise<string>
	>>;
	views: MarkdownView[];
} {
	const file = new TFile("Note.md");
	const files = new Map([[file.path, file]]);
	let vaultText = initial;
	const editors = Array.from({ length: editorCount }, () => ({
		getValue: vi.fn(() => initial),
		replaceRange: vi.fn(),
	}));
	const views = editors.map((editor) => {
		const view = new MarkdownView(editor, file);
		Object.assign(view, { getMode: () => "source" });
		return view;
	});
	const process = vi.fn(async (_file: TFile, transform: (text: string) => string) => {
		vaultText = transform(vaultText);
		return vaultText;
	});
	const cachedRead = vi.fn(async () => vaultText);
	const on = vi.fn(() => ({}));
	const app = {
		vault: {
			on,
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			cachedRead,
			process,
		},
		metadataCache: { on },
		workspace: {
			getActiveViewOfType: () => views[0] ?? null,
			getLeavesOfType: () => views.map((view) => ({ view })),
			trigger: vi.fn(),
		},
	} as unknown as App;
	return {
		app,
		file,
		files,
		plugin: new TabsdownPlugin(app, {
			id: "tabsdown", name: "Tabsdown", version: "1", minAppVersion: "1",
			description: "", author: "", isDesktopOnly: false, dir: "",
		}),
		editors,
		cachedRead,
		process,
		views,
	};
}

async function openWritableModal(
	plugin: TabsdownPlugin,
	source: string,
	beforeOpen?: (children: Array<{ load(): void; unload(): void }>) => void,
): Promise<Array<{ load(): void; unload(): void }>> {
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected processor");
	const container = document.body.appendChild(document.createElement("div"));
	const children: Array<{ load(): void; unload(): void }> = [];
	void handler(source, container, {
		sourcePath: "Note.md",
		addChild: (child: { load(): void; unload(): void }) => {
			children.push(child);
			child.load();
		},
		getSectionInfo: () => ({ lineStart: 0, lineEnd: 5, text: source }),
	});
	openContextMenu(container);
	beforeOpen?.(children);
	await menuItems[0]?.callback?.(new MouseEvent("click"));
	return children;
}

async function saveOpenModal(): Promise<void> {
	const modal = openModals[0];
	const save = Array.from(modal?.contentEl.querySelectorAll("button") ?? []).find(
		(button) => button.textContent === "Save",
	);
	save?.click();
	await flush();
}

test("writes through the sole editor with one replaceRange and never the vault", async () => {
	const source = "tab: One\nA\ntab: Two\nB";
	const text = `~~~tabsdown\n${source}\n~~~`;
	const { plugin, editors, process } = writablePlugin(text, 1);
	await openWritableModal(plugin, source);
	await saveOpenModal();
	expect(editors[0]?.replaceRange).toHaveBeenCalledOnce();
	expect(process).not.toHaveBeenCalled();
});

test("writes the exact CRLF nested callout range from LF processor source", async () => {
	const inner = "tab: Card surface\nUse a bordered surface.\ntab: Flat tabs\nUse tabs directly.\n";
	const source = [
		"tab: Architecture decision",
		"",
		"> [!info] Choose a nested presentation",
		"> ````tabsdown",
		"> tab: Card surface",
		"> Use a bordered surface.",
		"> tab: Flat tabs",
		"> Use tabs directly.",
		"> ````",
		"",
		"tab: Decision outcome",
		"Flat is the default.",
		"",
	].join("\n");
	const text = `\`\`\`\`\`tabsdown\r\n${source.replaceAll("\n", "\r\n")}\`\`\`\`\``;
	const { plugin, editors, process } = writablePlugin(text, 1);
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected processor");
	renderMock.mockImplementation(async (_app, markdown, element) => {
		element.textContent = markdown;
		if (!markdown.includes("> ````tabsdown")) return;
		const nested = element.appendChild(document.createElement("div"));
		void handler(inner, nested, {
			sourcePath: "Note.md",
			addChild: (child: { load(): void }) => child.load(),
			getSectionInfo: () => null,
		});
	});
	const container = document.body.appendChild(document.createElement("div"));
	void handler(source, container, {
		sourcePath: "Note.md",
		addChild: (child: { load(): void }) => child.load(),
		getSectionInfo: () => ({ lineStart: 0, lineEnd: 13, text: source }),
	});
	await flush();
	const blocks = renderedBlocks(container);
	expect(blocks).toHaveLength(2);
	openContextMenu(blocks[1]!);
	await menuItems[menuItems.length - 1]?.callback?.(new MouseEvent("click"));
	vi.spyOn(window.crypto, "randomUUID").mockReturnValue(
		"550e8400-e29b-41d4-a716-446655440000",
	);
	await saveOpenModal();

	expect(process).not.toHaveBeenCalled();
	expect(editors[0]?.replaceRange).toHaveBeenCalledOnce();
	expect(editors[0]?.replaceRange).toHaveBeenCalledWith(
		`config: block-id=550e8400-e29b-41d4-a716-446655440000\r\n> `,
		{ line: 5, ch: 2 },
		{ line: 5, ch: 2 },
	);
});

test("edits the first identical nested block after a structural marker in a static fence", async () => {
	const inner = "tab: One\nA\ntab: Two\nB\n";
	const block = `~~~tabsdown\n${inner}~~~`;
	const source = [
		"tab: First",
		"```text",
		"tab: Structural",
		"```",
		"tab: Nested owner",
		"```bad`info",
		block,
		block,
		"tab: Last",
		"Done",
		"",
	].join("\n");
	const text = `~~~~tabsdown\n${source}~~~~`;
	const { plugin, editors } = writablePlugin(text, 1);
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected processor");
	renderMock.mockImplementation(async (_app, markdown, element) => {
		element.textContent = markdown;
		if (!markdown.includes(`${block}\n${block}`)) return;
		for (let index = 0; index < 2; index += 1) {
			const nested = element.appendChild(document.createElement("div"));
			void handler(inner, nested, {
				sourcePath: "Note.md",
				addChild: (child: { load(): void }) => child.load(),
				getSectionInfo: () => null,
			});
		}
	});
	const container = document.body.appendChild(document.createElement("div"));
	void handler(source, container, {
		sourcePath: "Note.md",
		addChild: (child: { load(): void }) => child.load(),
		getSectionInfo: () => ({ lineStart: 0, lineEnd: 19, text: source }),
	});
	await flush();
	container.querySelectorAll<HTMLButtonElement>(".tabsdown__tab")[2]?.click();
	await flush();
	const blocks = renderedBlocks(container);
	expect(blocks).toHaveLength(3);
	openContextMenu(blocks[1]!);
	await menuItems[menuItems.length - 1]?.callback?.(new MouseEvent("click"));
	vi.spyOn(window.crypto, "randomUUID").mockReturnValue(
		"550e8400-e29b-41d4-a716-446655440000",
	);
	await saveOpenModal();

	expect(editors[0]?.replaceRange).toHaveBeenCalledOnce();
	expect(editors[0]?.replaceRange).toHaveBeenCalledWith(
		"config: block-id=550e8400-e29b-41d4-a716-446655440000\n",
		{ line: 8, ch: 0 },
		{ line: 8, ch: 0 },
	);
});

test("edits the second identical nested block after a structural tab inside a static fence", async () => {
	const inner = "tab: One\nA\ntab: Two\nB\n";
	const block = `~~~tabsdown\n${inner}~~~`;
	const source = [
		"tab: First",
		"```text",
		"tab: Structural",
		"tab: Nested owner",
		block,
		block,
		"```",
		"tab: Last",
		"Done",
		"",
	].join("\n");
	const text = `~~~~tabsdown\n${source}~~~~`;
	const { plugin, editors } = writablePlugin(text, 1);
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected processor");
	renderMock.mockImplementation(async (_app, markdown, element) => {
		element.textContent = markdown;
		if (!markdown.includes(`${block}\n${block}`)) return;
		for (let index = 0; index < 2; index += 1) {
			const nested = element.appendChild(document.createElement("div"));
			void handler(inner, nested, {
				sourcePath: "Note.md",
				addChild: (child: { load(): void }) => child.load(),
				getSectionInfo: () => null,
			});
		}
	});
	const container = document.body.appendChild(document.createElement("div"));
	void handler(source, container, {
		sourcePath: "Note.md",
		addChild: (child: { load(): void }) => child.load(),
		getSectionInfo: () => ({ lineStart: 0, lineEnd: 19, text: source }),
	});
	await flush();
	container.querySelectorAll<HTMLButtonElement>(".tabsdown__tab")[2]?.click();
	await flush();
	const blocks = renderedBlocks(container);
	expect(blocks).toHaveLength(3);
	openContextMenu(blocks[2]!);
	await menuItems[menuItems.length - 1]?.callback?.(new MouseEvent("click"));
	vi.spyOn(window.crypto, "randomUUID").mockReturnValue(
		"550e8400-e29b-41d4-a716-446655440000",
	);
	await saveOpenModal();

	expect(editors[0]?.replaceRange).toHaveBeenCalledOnce();
	expect(editors[0]?.replaceRange).toHaveBeenCalledWith(
		"config: block-id=550e8400-e29b-41d4-a716-446655440000\n",
		{ line: 12, ch: 0 },
		{ line: 12, ch: 0 },
	);
});

test.each([
	[1, 3],
	[2, 9],
] as const)(
	"binds identical nested sibling %i by DOM order when callbacks run in reverse",
	async (triggerIndex, line) => {
		const inner = "tab: One\nA\ntab: Two\nB\n";
		const block = `~~~tabsdown\n${inner}~~~`;
		const source = ["tab: Outer", block, block, "tab: Last", "Done", ""].join("\n");
		const text = `~~~~tabsdown\n${source}~~~~`;
		const { plugin, editors } = writablePlugin(text, 1);
		plugin.onload();
		const handler = processorRegistrationMock.mock.calls[0]?.[1];
		if (!handler) throw new Error("Expected processor");
		renderMock.mockImplementation(async (_app, markdown, element) => {
			element.textContent = markdown;
			if (!markdown.includes(`${block}\n${block}`)) return;
			const nested = [document.createElement("div"), document.createElement("div")];
			element.append(...nested);
			for (const index of [1, 0]) {
				void handler(inner, nested[index]!, {
					sourcePath: "Note.md",
					addChild: (child: { load(): void }) => child.load(),
					getSectionInfo: () => null,
				});
			}
		});
		const container = document.body.appendChild(document.createElement("div"));
		void handler(source, container, {
			sourcePath: "Note.md",
			addChild: (child: { load(): void }) => child.load(),
			getSectionInfo: () => ({ lineStart: 0, lineEnd: 11, text: source }),
		});
		await flush();
		openContextMenu(renderedBlocks(container)[triggerIndex]!);
		await menuItems[menuItems.length - 1]?.callback?.(new MouseEvent("click"));
		vi.spyOn(window.crypto, "randomUUID").mockReturnValue(
			"550e8400-e29b-41d4-a716-446655440000",
		);
		await saveOpenModal();

		expect(editors[0]?.replaceRange).toHaveBeenCalledOnce();
		expect(editors[0]?.replaceRange).toHaveBeenCalledWith(
			"config: block-id=550e8400-e29b-41d4-a716-446655440000\n",
			{ line, ch: 0 },
			{ line, ch: 0 },
		);
	},
);

test("fails closed when distinct same-file editors exist", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { plugin, editors, process } = writablePlugin(text, 2);
	await openWritableModal(plugin, source);
	await saveOpenModal();
	expect(editors.every((editor) => editor.replaceRange.mock.calls.length === 0)).toBe(true);
	expect(process).not.toHaveBeenCalled();
	expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("More than one editor"));
	expect(openModals[0]?.containerEl.isConnected).toBe(true);
});

test("uses one atomic Vault.process transform only when no editor owns the file", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { plugin, process } = writablePlugin(text, 0);
	await openWritableModal(plugin, source);
	await saveOpenModal();
	expect(process).toHaveBeenCalledOnce();
	expect(process.mock.calls[0]?.[1]).toEqual(expect.any(Function));
});

test("does not open settings after the block unloads during cachedRead", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { cachedRead, plugin } = writablePlugin(text, 0);
	let finishRead: ((value: string) => void) | undefined;
	cachedRead.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
	let children: Array<{ unload(): void }> = [];
	const opening = openWritableModal(plugin, source, (loaded) => { children = loaded; });
	await Promise.resolve();
	children[0]?.unload();
	finishRead?.(text);
	await opening;

	expect(openModals).toHaveLength(0);
	expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("no longer available"));
});

test("does not replace editor text after the block unloads during save", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { editors, plugin } = writablePlugin(text, 1);
	const children = await openWritableModal(plugin, source);
	editors[0]?.getValue.mockImplementationOnce(() => {
		children[0]?.unload();
		return text;
	});
	await saveOpenModal();

	expect(editors[0]?.replaceRange).not.toHaveBeenCalled();
	expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("no longer available"));
});

test("does not mutate in a Vault.process transform after the block unloads", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { plugin, process } = writablePlugin(text, 0);
	let runTransform: (() => void) | undefined;
	let transformed = false;
	process.mockImplementationOnce((_file, transform) => new Promise((resolve, reject) => {
		runTransform = () => {
			try {
				const result = transform(text);
				transformed = result !== text;
				resolve(result);
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		};
	}));
	const children = await openWritableModal(plugin, source);
	const save = Array.from(openModals[0]?.contentEl.querySelectorAll("button") ?? []).find(
		(button) => button.textContent === "Save",
	);
	save?.click();
	await Promise.resolve();
	children[0]?.unload();
	runTransform?.();
	await flush();

	expect(transformed).toBe(false);
	expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("no longer available"));
});

test("cannot cancel after a Vault.process transform has started committing", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { plugin, process } = writablePlugin(text, 0);
	let finishProcess: ((value: string) => void) | undefined;
	let transformed = "";
	const transformCalls = vi.fn();
	process.mockImplementationOnce((_file, transform) => {
		transformCalls();
		transformed = transform(text);
		return new Promise((resolve) => { finishProcess = resolve; });
	});
	await openWritableModal(plugin, source);
	const modal = openModals[0]!;
	const buttons = Array.from(modal.contentEl.querySelectorAll("button"));
	const cancel = buttons.find((button) => button.textContent === "Cancel")!;
	const save = buttons.find(
		(button) => button.textContent === "Save",
	)!;
	save.click();
	await Promise.resolve();

	expect(transformed).not.toBe(text);
	expect(process).toHaveBeenCalledOnce();
	expect(transformCalls).toHaveBeenCalledOnce();
	expect(cancel.disabled).toBe(true);
	expect(save.disabled).toBe(true);
	cancel.click();
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	modal.close();
	expect(modal.containerEl.isConnected).toBe(true);

	finishProcess?.(transformed);
	await flush();

	expect(modal.containerEl.isConnected).toBe(false);
	expect(process).toHaveBeenCalledOnce();
	expect(transformCalls).toHaveBeenCalledOnce();
});

test("keeps the captured file owner across renames before open and save", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { file, files, plugin, editors, process } = writablePlugin(text, 1);
	const rename = (path: string): void => {
		files.delete(file.path);
		file.path = path;
		files.set(path, file);
	};

	await openWritableModal(plugin, source, () => rename("Renamed.md"));
	rename("Renamed again.md");
	await saveOpenModal();

	expect(editors[0]?.replaceRange).toHaveBeenCalledOnce();
	expect(process).not.toHaveBeenCalled();
});

test("fails closed when the rendered path is reused by another file", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { file, files, plugin } = writablePlugin(text, 0);

	await openWritableModal(plugin, source, () => {
		files.set(file.path, new TFile(file.path));
	});

	expect(openModals).toHaveLength(0);
	expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("deleted or replaced"));
});

test("fails closed when the captured file is deleted before save", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { file, files, plugin, process } = writablePlugin(text, 0);
	await openWritableModal(plugin, source);
	files.delete(file.path);
	await saveOpenModal();

	expect(process).not.toHaveBeenCalled();
	expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("deleted or replaced"));
	expect(openModals[0]?.containerEl.isConnected).toBe(true);
});

test("aborts the vault transform when an editor opens while process is pending", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { file, plugin, process, views } = writablePlugin(text, 0);
	const editor = { getValue: vi.fn(() => text), replaceRange: vi.fn() };
	process.mockImplementationOnce(async (_file, transform) => {
		views.push(new MarkdownView(editor, file));
		return transform(text);
	});
	await openWritableModal(plugin, source);
	await saveOpenModal();

	expect(process).toHaveBeenCalledOnce();
	expect(editor.replaceRange).not.toHaveBeenCalled();
	expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("editor opened"));
});

test("allows retry after Vault.process fails", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { plugin, process } = writablePlugin(text, 0);
	process.mockRejectedValueOnce(new Error("disk busy"));
	await openWritableModal(plugin, source);

	await saveOpenModal();
	expect(noticeMock).toHaveBeenCalledWith("disk busy");
	expect(openModals[0]?.containerEl.isConnected).toBe(true);
	expect(
		Array.from(openModals[0]?.contentEl.querySelectorAll("button") ?? []).every(
			(button) => !button.disabled,
		),
	).toBe(true);
	await saveOpenModal();

	expect(process).toHaveBeenCalledTimes(2);
	expect(openModals[0]?.containerEl.isConnected).toBe(false);
});

test("writes through a sole inactive editor", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { app, plugin, editors, process } = writablePlugin(text, 1);
	vi.spyOn(app.workspace, "getActiveViewOfType").mockReturnValue(null);
	await openWritableModal(plugin, source);
	await saveOpenModal();

	expect(editors[0]?.replaceRange).toHaveBeenCalledOnce();
	expect(process).not.toHaveBeenCalled();
});

test("anchors keyboard context menus to the target and pointer menus to the event", async () => {
	const source = "tab: One\nA\ntab: Two\nB\n";
	const text = `~~~tabsdown\n${source}~~~`;
	const { plugin } = writablePlugin(text, 0);
	plugin.onload();
	const handler = processorRegistrationMock.mock.calls[0]?.[1];
	if (!handler) throw new Error("Expected processor");
	const container = document.body.appendChild(document.createElement("div"));
	void handler(source, container, {
		sourcePath: "Note.md",
		addChild: (child: { load(): void }) => child.load(),
		getSectionInfo: () => ({ lineStart: 0, lineEnd: 5, text: source }),
	});
	const trigger = container.querySelector<HTMLButtonElement>('[role="tab"]');
	vi.spyOn(trigger!, "getBoundingClientRect").mockReturnValue({
		bottom: 42, height: 10, left: 7, right: 27, top: 32, width: 20,
		x: 7, y: 32, toJSON: () => ({}),
	});

	openContextMenu(trigger!, 0, 0);
	expect(menuShowAtPositionMock).toHaveBeenCalledWith(
		{ x: 7, y: 42, width: 20 },
		trigger?.ownerDocument,
	);
	expect(menuShowAtMouseEventMock).not.toHaveBeenCalled();

	openContextMenu(trigger!, 10, 10);
	expect(menuShowAtMouseEventMock).toHaveBeenCalledOnce();
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
