# Embedding tabs from another plugin

A plugin that already owns live DOM panels can pass them to Tabsdown for the same styling and animation. Tabsdown moves the panels into its layout; it does not clone them or render them as Markdown.

```ts
interface TabsdownApi {
	mountTabs(
		container: HTMLElement,
		options: {
			label: string;
			selection?: string | null;
			tabs: readonly {
				id: string;
				label: string;
				panel: HTMLElement;
			}[];
			onSelectionChange?: (
				selection: string | null,
				previous: string | null,
			) => void;
		},
	): {
		readonly selection: string | null;
		setSelection(id: string | null): void;
		setAvailable(id: string, available: boolean): void;
		destroy(): void;
	};
}

const tabsdown = this.app.plugins.getPlugin("tabsdown") as TabsdownApi | null;
const tabs = tabsdown?.mountTabs(container, {
	label: "**Trace** and watch",
	selection: null,
	tabs: [
		{ id: "trace", label: "**Trace**", panel: traceElement },
		{ id: "watch", label: "`Watch`", panel: watchElement },
	],
	onSelectionChange(selection) {
		// null when the open panel was collapsed
	},
});

tabs?.setSelection("trace");
tabs?.setAvailable("watch", false);
tabs?.destroy();
```

Mounted tabs act as a collapsible switch. Selection starts at `null` unless you pass an initial ID, and activating the open tab closes it. Fenced `tabsdown` blocks keep their normal first-tab-selected behavior.

- `destroy()` restores the panels' original `id`, `role`, `tabindex`, `hidden`, and `aria-labelledby` values, then returns them to `container`. Calling it twice is safe. Tabsdown also destroys active controllers when the plugin is disabled.
- Buttons use native Enter, Space, and Tab behavior. The group is not announced as a tab list because it can start with no selection. If a focused tab becomes unavailable, focus moves to the next available tab.
- Tabsdown names panels that need a name. A panel with `aria-label` or `aria-labelledby` keeps it, and a panel with its own controls stays out of the tab order so those controls come first.
- After `destroy()`, Tabsdown does not move focus. If teardown follows user input, focus the element that replaces the controls.
- `onSelectionChange` runs after user activation or when making a tab unavailable closes its panel. It does not run on mount or after your own `setSelection` calls, and calling the controller from the handler is safe.
- Mount into the document so Tabsdown can resolve animation and reduced-motion styles. A detached container falls back to a fixed animation duration.
- Do not mount inside a rendered `tabsdown` panel. A Markdown refresh can replace that panel without tearing down your controls.
