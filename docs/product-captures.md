# Product captures

The portable Playwright tool in `.github/actions/product-captures/` captures the real product and renders PNG artwork through reusable templates. This repository's scenes, build command, ready conditions, product name, optional subtitle, palette, and output sizes live in `product-captures.json`.

## Local runs

Planning does not install dependencies, build the product, start servers or browsers, write images, or publish anything:

```sh
node .github/actions/product-captures/cli.mjs --dry-run
node .github/actions/product-captures/cli.mjs --list
```

Install the isolated tool once, then render the configured product:

```sh
npm ci --prefix .github/actions/product-captures
node .github/actions/product-captures/node_modules/playwright/cli.js install chromium
node .github/actions/product-captures/cli.mjs
```

The default is a fresh capture from the current checkout. The prepare command builds the plugin. Light/dark scenes run actual Obsidian in isolated instances using a copy of the curated demo vault; the pinned app and installer are downloaded automatically. Linux capture requires Xvfb and a window manager, provided by the GitHub Action. Authored release posters are preserved but are not configured sources.

Select a light/dark pair or inspect a deliberate theme override:

```sh
node .github/actions/product-captures/cli.mjs --only hero,hero-dark --dry-run
node .github/actions/product-captures/cli.mjs --only hero --theme dark --capture-mode existing --dry-run
node .github/actions/product-captures/cli.mjs --skip-prepare
```

When reusing this toolkit for a web source, a running server can replace the managed build/server:

```sh
node .github/actions/product-captures/cli.mjs --base-url http://127.0.0.1:4179 --skip-prepare
```

To reframe saved capture inputs deliberately, use `--capture-mode existing`. This never pretends to be a fresh capture. Fresh failures stop rather than silently reusing old images. `--output-dir` accepts another directory inside this repository. `--scale 2` increases pixel density. `output.theme` accepts `light` or `dark`; `capturesByTheme` maps each theme to its source IDs. `--theme` overrides the output theme and selects the matching source, including in existing mode. It preserves selected output IDs: `--only hero --theme dark` therefore writes dark artwork to `hero.png`. Stored capture theme values can also use the `$theme` placeholder.

## Artwork configuration

Artwork contains the product name and an optional platform lockup. Set `project.subtitle` to an empty string to omit it. `project.artDirection` selects `porcelain` (Baseline-led close-up) or `studio` (dark photographic atmosphere); `project.layout` selects `site-top`, `column`, `horizontal`, `desktop-centered`, or the legacy `side`, `wide`, `reverse`, and `desktop-side` layouts. `imageZoom` controls feature scale, `imageOffsetX` selects the horizontal focal crop, and outputs may override the direction, layout, and zoom. Screenshots remain upright. Contained desktop layouts preserve the complete source viewport; other layouts may use configured focal crops. `output.showProduct: false` removes the whole product panel and its source dependencies. Fade controls `fadeStart`, `fadeEnd`, and `blurStart` are normalized fractions in `0..1`, with `fadeStart < fadeEnd`; defaults are `0.67`, `1`, and `0.62`. Project values may be overridden per output.

The studio photograph is a fixed decorative asset, not generated during release runs. Website `siteBackdrop`/`siteTint` use CSS optical folds without forest photography. Configured visible product panels use actual light/dark captures. Authored or illustrative plugin stills may instead use the explicit `image` provider; preview GIFs must use real product captures. This pipeline exports PNGs and does not alter GIF files.

## Release and manual automation

The **Product captures** GitHub workflow supports manual runs; dry-run is enabled by default. Its inputs select capture mode, outputs, template, theme, width, height, preview URL, an optional release tag, and whether to open a PNG update PR. Default manual runs leave output/theme filters empty and plan both themes; disable dry-run to generate them. To select a pair, set `only` to `hero,hero-dark`; use `theme` only for an intentional override. Release publication generates both themes and uploads artwork plus its provenance manifest and opens a review-only PR for finished PNGs. The workflow never merges it.

Repositories that already create releases with `GITHUB_TOKEN` call the action directly after successful publication, because those releases do not trigger a second `release.published` workflow. Other repositories run the capture workflow when a release is published. No new release-creation policy is introduced. Changes must be committed and landed before GitHub can run these workflows; workflows were not dispatched during implementation.

This repository configures 8 PNGs as 4 light/dark pairs in `docs/assets/product-captures/`. Base IDs/filenames such as `hero.png`, `themes.png`, and `social.png` are light; matching `hero-dark.png`, `themes-dark.png`, and `social-dark.png` are dark. Raw captures are in its `captures/` folder. The local `gallery.html` and `manifest.json` provide previews and provenance and are ignored by Git. CI artifacts retain both. Image update PRs include finished PNGs only. README `<picture>` sources select `hero-dark.png` for dark mode and `hero.png` for light mode/fallback; existing link destinations are preserved.

## Reuse in another repository

Copy the standalone toolkit or use its installer:

```sh
node .github/actions/product-captures/install.mjs --repo /path/to/new-repo --id new-project --title "New project" --url http://127.0.0.1:4179 --dry-run
node .github/actions/product-captures/install.mjs --repo /path/to/new-repo --id new-project --title "New project" --url http://127.0.0.1:4179 --server "npm run preview" --prepare "npm ci && npm run build" --apply
```

The installer refuses to overwrite an existing tool, config, or workflow. Update the product name, optional subtitle, capture scenes, and background palette for the new product. Keep dependencies, app versions, fonts and capture environment pinned for consistent renders. Source configs are trusted repository code: build commands and JavaScript readiness expressions must not come from untrusted runtime inputs.

The standalone package has its own Node contract tests and browser smoke test. Host lint/format tools exclude only this separately owned package; `product-captures-check.yml` checks it and validates this repository's dry-run plan on relevant changes.

## Current artwork

The purple `column` layout places `Tabsdown` / `for Obsidian` at the top/bottom identity positions. Actual Obsidian captures supply light and dark UI. Authored release posters remain author assets and are not configured capture sources. Each base output uses its light source; its `-dark` partner uses the dark source. `horizontal` and `horizontal-dark` retain the alternate layout. `studioTint` grades the fixed background photograph without tinting product pixels. Official Obsidian assets, where used, remain unchanged.

Plugin studio backgrounds keep their original tint in both UI themes: Quartz stays blue; Tabsdown, Colsdown, and Flowmaid stay purple. Light/dark capture selection and lighting gradients may adapt, but the dark ground and photographic grade stay fixed. Headings and the official white Obsidian wordmark remain light for contrast on that ground; the official asset bytes are unchanged.
