# Publishing with Quartz

Obsidian renders `tabsdown` blocks inside the app. To render the same syntax on a [Quartz](https://quartz.jzhao.xyz/) site, install the separate [quartz-tabsdown](https://github.com/grafanaKibana/quartz-tabsdown) plugin:

```bash
npx quartz plugin add github:grafanaKibana/quartz-tabsdown
```

The Quartz plugin shares Tabsdown's parser and appearance defaults. Interactive tabs need JavaScript. Without it, Quartz renders every panel in order under its label.
