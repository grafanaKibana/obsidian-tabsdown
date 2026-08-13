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
	callback?: (event: MouseEvent | KeyboardEvent) => unknown;
	setTitle(title: string): this { this.title = title; return this; }
	onClick(callback: (event: MouseEvent | KeyboardEvent) => unknown): this {
		this.callback = callback;
		return this;
	}
}
export class Menu extends Component {
	setParentElement(_element: HTMLElement): this { return this; }
	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		callback(item);
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

export const openModals: Modal[] = [];
export class Modal {
	containerEl = document.createElement("div");
	modalEl = document.createElement("div");
	titleEl = document.createElement("h2");
	contentEl = document.createElement("div");
	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") this.close();
	};
	constructor(public app: unknown) {
		this.containerEl.append(this.titleEl, this.contentEl);
	}
	setTitle(title: string): this { this.titleEl.textContent = title; return this; }
	open(): void {
		document.addEventListener("keydown", this.onKeyDown);
		document.body.append(this.containerEl);
		openModals.push(this);
		this.onOpen();
	}
	close(): void {
		document.removeEventListener("keydown", this.onKeyDown);
		this.containerEl.remove();
		this.onClose();
	}
	onOpen(): void {}
	onClose(): void {}
}

class DropdownComponent {
	selectEl = document.createElement("select");
	addOption(value: string, display: string): this {
		this.selectEl.add(new Option(display, value));
		return this;
	}
	setValue(value: string): this { this.selectEl.value = value; return this; }
	onChange(callback: (value: string) => unknown): this {
		this.selectEl.addEventListener("change", () => callback(this.selectEl.value));
		return this;
	}
}

class ButtonComponent {
	buttonEl = document.createElement("button");
	setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
	setCta(): this { return this; }
	setDisabled(disabled: boolean): this { this.buttonEl.disabled = disabled; return this; }
	onClick(callback: (event: MouseEvent) => unknown): this {
		this.buttonEl.addEventListener("click", (event) => void callback(event));
		return this;
	}
}

export class Setting {
	settingEl = document.createElement("div");
	nameEl = document.createElement("div");
	controlEl = document.createElement("div");
	constructor(container: HTMLElement) {
		this.settingEl.append(this.nameEl, this.controlEl);
		container.append(this.settingEl);
	}
	setName(name: string): this { this.nameEl.textContent = name; return this; }
	addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
		const dropdown = new DropdownComponent();
		callback(dropdown);
		this.controlEl.append(dropdown.selectEl);
		return this;
	}
	addButton(callback: (button: ButtonComponent) => unknown): this {
		const button = new ButtonComponent();
		callback(button);
		this.controlEl.append(button.buttonEl);
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
