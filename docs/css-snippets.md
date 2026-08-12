# CSS snippets

Open **Settings → Appearance → CSS snippets**, select the folder icon, and create `tabsdown.css`. Add only the rules you want to change:

```css
.tabsdown {
	--tabsdown-gap: 0.5rem;
	--tabsdown-radius: 999px;
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

After saving the file, return to **CSS snippets**, select **Reload snippets**, and enable `tabsdown`. You may need to adjust the overrides after changing themes.
