import { MarkdownRenderChild, MarkdownView, Plugin } from "obsidian";
import { parseTabs } from "./parser";
import { TabBlockRenderChild, renderTabsDiagnostic } from "./render";
import { mountTabs, type MountTabsOptions, type TabsController } from "./tabs";

export type { MountTabsOptions, TabSpec, TabsController } from "./tabs";

const INTERACTIVE_SELECTOR =
	'a, audio, button, iframe, input, label, select, summary, textarea, video, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="switch"]';

export default class TabsdownPlugin extends Plugin {
	private freshnessGeneration = 0;
	private readonly mountedTabs = new Set<TabsController>();

	onload(): void {
		const markContentStale = (): void => {
			this.freshnessGeneration += 1;
		};

		this.registerEvent(this.app.vault.on("create", markContentStale));
		this.registerEvent(this.app.vault.on("modify", markContentStale));
		this.registerEvent(this.app.vault.on("delete", markContentStale));
		this.registerEvent(this.app.vault.on("rename", markContentStale));
		this.registerEvent(
			this.app.metadataCache.on("changed", markContentStale),
		);

		this.registerMarkdownCodeBlockProcessor("tabsdown", (source, element, context) => {
			const renderedSection = context.getSectionInfo(element);
			const addRenderChild = (child: MarkdownRenderChild): void => {
				child.registerDomEvent(element, "click", (event) => {
					const target = event.target;
					if (event.defaultPrevented || !(target instanceof Element)) {
						return;
					}

					const interactive = target.closest(INTERACTIVE_SELECTOR);
					if (interactive && element.contains(interactive)) {
						return;
					}

					const view =
						this.app.workspace.getActiveViewOfType(MarkdownView);
					if (
						!view ||
						view.getMode() !== "source" ||
						view.file?.path !== context.sourcePath
					) {
						return;
					}

					const section =
						context.getSectionInfo(element) ?? renderedSection;
					if (!section) {
						return;
					}

					view.editor.setCursor({
						line: Math.min(section.lineStart + 1, section.lineEnd),
						ch: 0,
					});
					view.editor.focus();
				});
				context.addChild(child);
			};

			const result = parseTabs(source);
			if (!result.ok) {
				renderTabsDiagnostic(element, result.diagnostic);
				addRenderChild(new MarkdownRenderChild(element));
				return;
			}

			addRenderChild(
				new TabBlockRenderChild(
					this.app,
					element,
					context.sourcePath,
					result.tabs,
					result.configuration ?? [],
					() => this.freshnessGeneration,
				),
			);
		});

		const refreshStyleSettings = (): boolean => {
			const stylesLoaded = Array.from(
				document.head.querySelectorAll("style"),
			).some((style) =>
				style.textContent?.includes("\nname: Tabsdown\nid: tabsdown\n"),
			);
			if (!stylesLoaded) return false;

			this.app.workspace.trigger("parse-style-settings");
			return true;
		};

		if (!refreshStyleSettings()) {
			const observer = new MutationObserver(() => {
				if (refreshStyleSettings()) observer.disconnect();
			});
			observer.observe(document.head, { childList: true });
			this.register(() => observer.disconnect());
		}
	}

	onunload(): void {
		for (const controller of this.mountedTabs) controller.destroy();
	}

	mountTabs(container: HTMLElement, options: MountTabsOptions): TabsController {
		const controller = mountTabs(container, options);
		const destroy = controller.destroy.bind(controller);
		controller.destroy = (): void => {
			destroy();
			this.mountedTabs.delete(controller);
		};
		this.mountedTabs.add(controller);
		return controller;
	}
}
