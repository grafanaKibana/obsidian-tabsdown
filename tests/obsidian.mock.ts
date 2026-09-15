import { vi } from "vitest";

Object.defineProperty(Node.prototype, "createEl", {
	configurable: true,
	value<K extends keyof HTMLElementTagNameMap>(
		this: HTMLElement,
		tag: K,
		options?: { cls?: string | string[] },
	): HTMLElementTagNameMap[K] {
		const element = this.ownerDocument.createElement(tag);
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
Object.defineProperty(HTMLElement.prototype, "createDiv", {
	configurable: true,
	value(this: HTMLElement, options?: { cls?: string | string[] }): HTMLDivElement {
		return this.createEl("div", options);
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
export const menus: Menu[] = [];
export const menuShowAtMouseEventMock = vi.fn();
export const menuShowAtPositionMock = vi.fn();
export class MenuItem {
	icon: string | null = null;
	disabled = false;
	warning = false;
	setDisabled(value: boolean): this { this.disabled = value; return this; }
	setWarning(value: boolean): this { this.warning = value; return this; }
	setIcon(icon: string | null): this { this.icon = icon; return this; }
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
	useNativeMenu = true;
	separatorPositions: number[] = [];
	setUseNativeMenu(value: boolean): this { this.useNativeMenu = value; return this; }
	addSeparator(): this { this.separatorPositions.push(this.items.length); return this; }
	private readonly hideCallbacks: Array<() => unknown> = [];
	constructor(private readonly parentItem?: MenuItem) { super(); menus.push(this); }
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
	onHide(callback: () => unknown): void { this.hideCallbacks.push(callback); }
	hide(): this { this.close(); return this; }
	close(): void {
		for (const callback of this.hideCallbacks.splice(0)) callback();
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

export class Modal {
	readonly contentEl = document.createElement("div");
	constructor(readonly app: unknown) {}
	setTitle(title: string): this { this.contentEl.setAttribute("aria-label", title); return this; }
	open(): void { this.contentEl.setAttribute("role", "dialog"); document.body.append(this.contentEl); this.onOpen(); }
	close(): void { this.contentEl.remove(); this.onClose(); }
	onOpen(): void {}
	onClose(): void {}
}
export class Setting {
	constructor(private readonly element: HTMLElement) {}
	addButton(callback: (button: { buttonEl: HTMLButtonElement; setButtonText(text: string): unknown; onClick(callback: () => void): unknown }) => unknown): this {
		const element = this.element.appendChild(document.createElement("button"));
		const button = {
			buttonEl: element,
			setButtonText(text: string) { element.textContent = text; return button; },
			onClick(fn: () => void) { element.addEventListener("click", fn); return button; },
		};
		callback(button);
		return this;
	}
}
