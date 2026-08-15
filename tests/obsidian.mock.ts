import { vi } from "vitest";

Object.defineProperty(Node.prototype, "createEl", {
	configurable: true,
	value<K extends keyof HTMLElementTagNameMap>(
		this: HTMLElement,
		tag: K,
		options?: { cls?: string | string[] },
	): HTMLElementTagNameMap[K] {
		const element = document.createElement(tag);
		if (options?.cls) {
			const classes =
				typeof options.cls === "string" ? options.cls.split(" ") : options.cls;
			element.classList.add(...classes);
		}
		this.append(element);
		return element;
	},
});
Object.defineProperty(HTMLElement.prototype, "empty", {
	configurable: true,
	value(this: HTMLElement): void {
		this.replaceChildren();
	},
});

type RenderFunction = (
	app: unknown,
	markdown: string,
	element: HTMLElement,
	sourcePath: string,
	component: unknown,
) => Promise<void>;

export const renderMock = vi.fn<RenderFunction>();
export const componentUnloadMock = vi.fn<(component: Component) => void>();
export const processorRegistrationMock = vi.fn<
	(
		language: string,
		handler: (
			source: string,
			element: HTMLElement,
			context: unknown,
		) => Promise<unknown> | void,
	) => void
>();

export class Component {
	private readonly cleanup: Array<() => void> = [];
	private readonly children: Component[] = [];
	private loaded = false;

	load(): void {
		this.loaded = true;
		this.onload();
		this.children.forEach((child) => child.load());
	}

	onload(): void {}

	unload(): void {
		for (const child of [...this.children]) child.unload();
		for (const callback of this.cleanup.splice(0).reverse()) callback();
		this.loaded = false;
		this.onunload();
		componentUnloadMock(this);
	}

	onunload(): void {}

	addChild<T extends Component>(component: T): T {
		this.children.push(component);
		if (this.loaded) component.load();
		return component;
	}

	removeChild<T extends Component>(component: T): T {
		const index = this.children.indexOf(component);
		if (index >= 0) this.children.splice(index, 1);
		component.unload();
		return component;
	}

	register(callback: () => void): void {
		this.cleanup.push(callback);
	}

	registerDomEvent(
		element: HTMLElement,
		type: keyof HTMLElementEventMap,
		callback: EventListener,
	): void {
		element.addEventListener(type, callback);
		this.register(() => element.removeEventListener(type, callback));
	}
}

export class MarkdownRenderChild extends Component {
	constructor(public readonly containerEl: HTMLElement) {
		super();
	}
}

export const MarkdownRenderer = { render: renderMock };

export const setIcon = vi.fn((element: HTMLElement, name: string) => {
	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.classList.add("svg-icon", `lucide-${name}`);
	element.append(icon);
});

export class MarkdownView {
	constructor(
		public editor?: unknown,
		public file?: { path: string },
	) {}
}

export class TFile {
	constructor(public path: string) {}
}

export const noticeMock = vi.fn();
export class Notice {
	constructor(message: string) {
		noticeMock(message);
	}
}

export const menuItems: MenuItem[] = [];
export const menuShowAtMouseEventMock = vi.fn();
export const menuShowAtPositionMock = vi.fn();
class MenuItem {
	title = "";
	checked: boolean | null = null;
	submenu?: Menu;
	callback?: (event: MouseEvent | KeyboardEvent) => unknown;
	constructor(readonly parent?: MenuItem) {}
	setTitle(title: string): this { this.title = title; return this; }
	setChecked(checked: boolean | null): this { this.checked = checked; return this; }
	setSubmenu(): Menu {
		this.submenu = new Menu(this);
		return this.submenu;
	}
	onClick(callback: (event: MouseEvent | KeyboardEvent) => unknown): this {
		this.callback = callback;
		return this;
	}
}
export class Menu extends Component {
	readonly items: MenuItem[] = [];
	constructor(private readonly parentItem?: MenuItem) { super(); }
	setParentElement(_element: HTMLElement): this { return this; }
	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem(this.parentItem);
		callback(item);
		this.items.push(item);
		menuItems.push(item);
		return this;
	}
	showAtMouseEvent(event: MouseEvent): this {
		menuShowAtMouseEventMock(event);
		return this;
	}
	showAtPosition(position: unknown, doc?: Document): this {
		menuShowAtPositionMock(position, doc);
		return this;
	}
}

export class Plugin extends Component {
	constructor(public readonly app: unknown) {
		super();
	}

	registerEvent<T>(event: T): T {
		return event;
	}

	registerMarkdownCodeBlockProcessor(
		language: string,
		handler: (
			source: string,
			element: HTMLElement,
			context: unknown,
		) => Promise<unknown> | void,
	): void {
		processorRegistrationMock(language, handler);
	}
}
