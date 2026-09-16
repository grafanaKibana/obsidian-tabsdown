# CSS snippets

Open **Settings → Appearance → CSS snippets**, select the folder icon, and create `tabsdown.css`. Add only the rules you want to change:

```css
.tabsdown {
	--tabsdown-gap: 0.5rem;
	--tabsdown-resolved-radius: 999px;
	--tabsdown-content-spacing: 1rem;
	--tabsdown-horizontal-padding: 1.5rem;
}

.tabsdown__tab {
	background-color: var(--background-secondary);
	color: var(--text-muted);
}

.tabsdown__tab[aria-selected="true"] {
	background-color: var(--interactive-accent);
	color: var(--text-on-accent);
}
```

The background rules above target the **Button** personality. If Style Settings is installed, select **Settings → Style Settings → Tabsdown → Personality → Button** before using them.

`--tabsdown-resolved-radius` directly overrides the effective radius for the outside corners of each Button row and column, and for the Rail track. Rail tab radii are calculated from that radius minus the track padding, clamped at zero. Adjacent Button corners keep the theme's `--radius-s`. Underline and Separator tabs remain square. To use `--tabsdown-radius` instead, select **Custom** for the Style Settings corner radius.

`--tabsdown-horizontal-padding` accepts CSS lengths such as `px` or `rem`. It is the Default/base value; Compact density derives one-third of it, so `1.5rem` becomes `0.5rem` in Compact.

After saving the file, return to **CSS snippets**, select **Reload snippets**, and enable `tabsdown`. You may need to adjust the overrides after changing themes.
