<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/grafanaKibana/obsidian-tabsdown/HEAD/docs/assets/product-captures/hero-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/grafanaKibana/obsidian-tabsdown/HEAD/docs/assets/product-captures/hero.png">
  <img src="https://raw.githubusercontent.com/grafanaKibana/obsidian-tabsdown/HEAD/docs/assets/product-captures/hero.png" alt="Tabsdown: related Markdown content organized in nested tabs.">
</picture>

<p align="center">
Theme-native Markdown tabs for Obsidian. Works in Reading View and Live Preview on desktop and mobile.
</p>

<p align="center">
<a href="https://obsidian.md/plugins?id=tabsdown"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Install_in_Obsidian.svg?variant=default&amp;size=sm&amp;font=geist&amp;mode=dark&amp;logo=obsidian&amp;color=a079ff&amp;logoColor=18181b&amp;valueColor=18181b&amp;labelTextColor=18181b&amp;gradient=a079ff%2Cac8aff%2C110"><img alt="Install in Obsidian" src="https://shieldcn.dev/badge/Install_in_Obsidian.svg?variant=default&amp;size=sm&amp;font=geist&amp;mode=light&amp;logo=obsidian&amp;color=7c3aed&amp;logoColor=ffffff&amp;valueColor=ffffff&amp;labelTextColor=ffffff&amp;gradient=7c3aed%2C8650eb%2C110" style="display:inline-block;margin:0;vertical-align:middle"></picture></a>
<a href="https://github.com/grafanaKibana/obsidian-tabsdown/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/release/grafanaKibana/obsidian-tabsdown/stable.svg?variant=outline&amp;size=sm&amp;font=geist&amp;mode=dark&amp;label=Version&amp;gradient=18181b%2C18181b%2C90&amp;labelTextColor=fafafa"><img alt="Latest version" src="https://shieldcn.dev/github/release/grafanaKibana/obsidian-tabsdown/stable.svg?variant=outline&amp;size=sm&amp;font=geist&amp;mode=light&amp;label=Version&amp;gradient=fafafa%2Cfafafa%2C90&amp;labelTextColor=18181b" style="display:inline-block;margin:0;vertical-align:middle"></picture></a>
<a href="https://github.com/grafanaKibana/obsidian-tabsdown/actions/workflows/ci.yml"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/ci/grafanaKibana/obsidian-tabsdown.svg?variant=outline&amp;size=sm&amp;font=geist&amp;mode=dark&amp;label=CI&amp;workflow=ci.yml&amp;branch=main&amp;statusDot=true&amp;gradient=18181b%2C18181b%2C90&amp;labelTextColor=fafafa"><img alt="CI status" src="https://shieldcn.dev/github/ci/grafanaKibana/obsidian-tabsdown.svg?variant=outline&amp;size=sm&amp;font=geist&amp;mode=light&amp;label=CI&amp;workflow=ci.yml&amp;branch=main&amp;statusDot=true&amp;gradient=fafafa%2Cfafafa%2C90&amp;labelTextColor=18181b" style="display:inline-block;margin:0;vertical-align:middle"></picture></a>
</p>

Keep related sections of a note together: an overview and its details, examples in different languages, or reference material beside an explanation. Each tab holds Markdown, and selecting a label shows its body.

<details>
<summary>Watch Tabsdown in Obsidian</summary>

<a href="https://github.com/grafanaKibana/obsidian-tabsdown/pull/93#user-content-capture-light">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/grafanaKibana/obsidian-tabsdown/c73d8800fbcf8bea6e6d84c27556188f9bf6149f/docs/assets/tabsdown-showcase-dark.png">
  <img src="https://raw.githubusercontent.com/grafanaKibana/obsidian-tabsdown/c73d8800fbcf8bea6e6d84c27556188f9bf6149f/docs/assets/tabsdown-showcase-light.png" alt="Tabsdown video preview: create tabs with comment markers and write directly in Live Preview." loading="lazy" width="1280">
</picture>
</a>

[Watch in light theme](https://github.com/grafanaKibana/obsidian-tabsdown/pull/93#user-content-capture-light) | [Watch in dark theme](https://github.com/grafanaKibana/obsidian-tabsdown/pull/93#user-content-capture-dark)

</details>

## Get started

[Install and enable Tabsdown](#install), then paste this into a note:

```markdown
%% tabs %%
%% tab: Overview %%
Read the summary here.

%% tab: Checklist %%
- [ ] Review the details
- [ ] Update this note
%% endtabs %%
```

Keep each marker on its own line and give every tab a unique, non-empty label. A layout needs at least two tabs. Open Reading View to read it, or use Live Preview to read and edit it.

## Editing

Click the active body, or focus its tab and press Down, to edit its Markdown. Arrows move into and out of the layout. Cmd/Ctrl+A selects the active body’s text, and Undo/Redo uses the note’s history. Escape restores the rendered body. Switching tabs keeps your edits; switching alone does not change the note.

The active body uses a plain Markdown editor, without Obsidian’s rich Live Preview or third-party suggestions. Incomplete layout syntax may reveal the note’s source. If the same note is open in multiple editing panes, close the extra editor before editing a tab.

Right-click a block to **Add tab**. Double-click a label to rename it; Enter saves and Escape cancels. **Delete tab** is in the tab’s context menu, requires confirmation, and is disabled when only two tabs remain.

## Configuration

Use the block’s context menu for position, overflow, density, personality, palette, and alignment. To keep those settings in the source, put `%% config: position=left, personality=rail %%` before the first tab. [Style Settings](docs/style-settings.md) supplies global defaults.

Labels support bold, italic, strikethrough, inline code, and bundled Lucide icons, such as `%% tab: icon:code Python %%`. Other label Markdown stays literal.

## Source formats

Bodies can contain embeds, queries, callouts, math, Mermaid, and compatible plugin blocks rendered by Obsidian. Nested layouts keep their own labels, settings, and active tabs. Marker and fenced layouts can nest inside each other.

For a fenced layout, use:

````markdown
```tabsdown
tab: Overview
Read the summary here.
tab: Checklist
- [ ] Review the details
```
````

Keep `tab:` and optional `config:` lines at column zero. Use matching backtick or tilde fences and make the outer fence longer than any matching fences inside it. Source Mode exposes the complete layout syntax.

## Guides

- [Marker and editing examples](demo/Marker%20tabs.md) — Write and edit marker layouts, including nested tabs.
- [Tab authoring](demo/Tab%20authoring.md) — Add, rename, and delete tabs from the rendered layout.
- [Demo test matrix](demo/Tabsdown%20test%20matrix.md) — Explore content, nesting, and interaction examples.
- [Style Settings](docs/style-settings.md) — Set global appearance defaults and understand block overrides.
- [CSS snippets](docs/css-snippets.md) — Customize spacing, colors, and tab shapes with a vault snippet.
- [Quartz publishing](docs/quartz.md) — Render tabs on a Quartz site with the separate publishing plugin.
- [Templater recipes](docs/templater.md) — Generate tab layouts from static or prompted templates.
- [Embedding tabs from another plugin](docs/embedding-tabs.md) — Use `mountTabs` to display existing plugin panels.

## Install

Install with [BRAT](https://github.com/TfTHacker/obsidian42-brat) using `grafanaKibana/obsidian-tabsdown`, or copy `main.js`, `manifest.json`, and `styles.css` from the same [release](https://github.com/grafanaKibana/obsidian-tabsdown/releases) into `<Vault>/.obsidian/plugins/tabsdown/`. Reload Obsidian and enable **Tabsdown**.

Runs locally on desktop and mobile, with no network requests, telemetry, or account.

[Report an issue](https://github.com/grafanaKibana/obsidian-tabsdown/issues) | [Contributing](CONTRIBUTING.md) | [License](LICENSE)
