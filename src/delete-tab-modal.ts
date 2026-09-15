import { App, Modal, Setting } from "obsidian";

export class DeleteTabModal extends Modal {
	private resolve?: (confirmed: boolean) => void;
	private confirmed = false;

	constructor(app: App, private readonly label: string) {
		super(app);
	}

	confirm(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle("Delete tab?");
		this.contentEl.createEl("p").textContent = `Delete “${this.label}” and all of its content?`;
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => {
				button.buttonEl.classList.add("mod-warning");
				button.setButtonText("Delete tab").onClick(() => {
					this.confirmed = true;
					this.close();
				});
			});
	}

	onClose(): void {
		this.resolve?.(this.confirmed);
		this.resolve = undefined;
	}
}
