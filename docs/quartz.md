# Publishing with Quartz

Obsidian renders `tabsdown` blocks inside the app. To render the same syntax on a [Quartz](https://quartz.jzhao.xyz/) site, install the separate [quartz-tabsdown](https://github.com/grafanaKibana/quartz-tabsdown) plugin:

```bash
npx quartz plugin add github:grafanaKibana/quartz-tabsdown
```

The Quartz plugin shares Tabsdown's parser and appearance defaults. Interactive tabs need JavaScript. Without it, Quartz renders every panel in order under its label.

Tabsdown 1.4.0 saves every per-block setting as `property=value`, including `position=` and `layout=`, and requires matching parser, configuration, and CSS support. Keep the Obsidian and Quartz plugins on matching 1.4.0-compatible releases; an older Quartz plugin may render the panels but ignore or misread these values. Track downstream adoption in [quartz-tabsdown issue #12](https://github.com/grafanaKibana/quartz-tabsdown/issues/12).
