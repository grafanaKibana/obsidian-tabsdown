import { Component } from "obsidian";

/** Temporarily replaces a tab button with an input in the same layout slot. */
export class TabLabelEditor extends Component {
	private element?: HTMLInputElement;
	private error?: HTMLElement;
	private closed = false;
	private saving = false;

	constructor(
		private readonly anchor: HTMLElement,
		private readonly initial: string,
		private readonly adding: boolean,
		private readonly save: (label: string) => Promise<void>,
		private readonly close: (restoreFocus: boolean) => void,
	) {
		super();
	}

	onload(): void {
		const doc = this.anchor.ownerDocument;
		const view = doc.defaultView;
		if (!view) return;
		const list = this.anchor.parentElement;
		if (!list) return;
		const rect = this.anchor.getBoundingClientRect();
		this.anchor.classList.add("tabsdown__tab--editing");
		const appearance = view.getComputedStyle(this.anchor);
		const input = list.createEl("input", { cls: "tabsdown__tab tabsdown-label-editor__input" });
		this.element = input;
		input.type = "text";
		input.size = 1;
		input.value = this.initial;
		input.placeholder = "New tab";
		input.setAttribute("aria-label", this.adding ? "New tab label" : "Rename tab");
		input.style.width = `${rect.width}px`;
		const vertical = view.getComputedStyle(list).flexDirection.startsWith("column");
		input.style.flex = `0 1 ${vertical ? rect.height : rect.width}px`;
		input.style.height = `${rect.height}px`;
		for (const property of ["padding", "border", "background-color", "color", "font", "text-align"]) {
			input.style.setProperty(property, appearance.getPropertyValue(property));
		}
		this.anchor.replaceWith(input);
		const error = list.parentElement!.createDiv({ cls: "tabsdown-label-editor__error" });
		this.error = error;
		list.after(error);
		error.id = `${this.anchor.id}-label-error`;
		error.setAttribute("role", "alert");
		input.setAttribute("aria-describedby", error.id);
		this.registerDomEvent(input, "keydown", (event) => {
			event.stopPropagation();
			if (event.isComposing) return;
			if (event.key === "Escape" && !this.saving) {
				event.preventDefault();
				this.close(true);
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (this.saving) return;
				if (!input.value.trim()) {
					error.textContent = "Tab labels must not be empty.";
					input.setAttribute("aria-invalid", "true");
					return;
				}
				if (!this.adding && input.value === this.initial) {
					this.close(true);
					return;
				}
				this.saving = true;
				input.readOnly = true;
				input.setAttribute("aria-busy", "true");
				void this.save(input.value).then(() => {
					if (!this.closed) this.close(true);
				}, (reason: unknown) => {
					if (this.closed) return;
					this.saving = false;
					input.readOnly = false;
					input.removeAttribute("aria-busy");
					input.setAttribute("aria-invalid", "true");
					error.textContent = reason instanceof Error ? reason.message : String(reason);
					input.focus({ preventScroll: true });
				});
			}
		});
		this.registerDomEvent(input, "blur", () => {
			if (!this.saving) this.close(false);
		});
		input.focus({ preventScroll: true });
		input.select();
	}

	onunload(): void {
		this.closed = true;
		this.anchor.classList.remove("tabsdown__tab--editing");
		this.element?.replaceWith(this.anchor);
		this.error?.remove();
	}
}
