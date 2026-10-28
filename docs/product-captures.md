# Product captures

Scenes and output selections live in product-captures.json. Review configuration commands as source code.

Clone https://github.com/grafanaKibana/product-captures once, then plan with Node 22:

```sh
node /absolute/path/to/product-captures/cli.mjs --config /absolute/path/to/this-repo/product-captures.json --dry-run
```

Planning needs no installed SDK. Install dependencies and Chromium once in the shared checkout for real capture. See the shared README for scene, composition, fixture, and preparation options.

The local workflow metadata calls shared capture and validation workflows at v1. Manual runs default to dry-run; review output PNGs before merging generated-image PRs. Pin workflow and direct-action references to an immutable version or full SHA to freeze behavior; compatible v1 updates apply on rerun.

Releases created with GITHUB_TOKEN do not trigger another release workflow. In that release job, call grafanaKibana/product-captures/actions/capture@v1 directly after successful release creation, with dry-run: 'false' and the exact release-tag. Keep only one capture invocation per release. Publishing requires contents: write; image update PRs also require pull-requests: write. Never execute untrusted PR configuration with a write token.

## This repository

Fresh capture builds the current Tabsdown plugin and opens its authored fixture in the pinned Obsidian app. Existing mode explicitly reuses the configured light/dark screenshots.

The checked-in workflows keep repository events and manual choices locally and call the shared workflows at `v1`. Manual runs default to dry-run and fresh mode. Shared validation runs on relevant pull requests and default-branch pushes, including authored fixture changes. Release jobs that create releases with GITHUB_TOKEN invoke the remote composite directly after successful publication, preserving their existing conditions and release tags.

Use an explicit theme override only when intended: `--only hero --theme dark` retains the selected output ID and writes dark artwork to `hero.png`. To select its approved dark partner, use `--only hero-dark`.

## Artwork configuration

Artwork contains the product name and an optional platform lockup. Set `project.subtitle` to an empty string to omit it. `project.artDirection` selects `porcelain` (Baseline-led close-up) or `studio` (dark photographic atmosphere); `project.layout` selects `site-top`, `column`, `horizontal`, `desktop-centered`, or the legacy `side`, `wide`, `reverse`, and `desktop-side` layouts. `imageZoom` controls feature scale, `imageOffsetX` selects the horizontal focal crop, and outputs may override the direction, layout, and zoom. Screenshots remain upright. Contained desktop layouts preserve the complete source viewport; other layouts may use configured focal crops. `output.showProduct: false` removes the whole product panel and its source dependencies. Fade controls `fadeStart`, `fadeEnd`, and `blurStart` are normalized fractions in `0..1`, with `fadeStart < fadeEnd`; defaults are `0.67`, `1`, and `0.62`. Project values may be overridden per output.

The studio photograph is a fixed decorative asset, not generated during release runs. Website `siteBackdrop`/`siteTint` use CSS optical folds without forest photography. Configured visible product panels use actual light/dark captures. Authored or illustrative plugin stills may instead use the explicit `image` provider; preview GIFs must use real product captures. This pipeline exports PNGs and does not alter GIF files.

## Current artwork

The purple `column` layout places `Tabsdown` / `for Obsidian` at the top/bottom identity positions. Actual Obsidian captures supply light and dark UI. Authored release posters remain author assets and are not configured capture sources. Each base output uses its light source; its `-dark` partner uses the dark source. `horizontal` and `horizontal-dark` retain the alternate layout. `studioTint` grades the fixed background photograph without tinting product pixels. Official Obsidian assets, where used, remain unchanged.

Plugin studio backgrounds keep their original tint in both UI themes: Quartz stays blue; Tabsdown, Colsdown, and Flowmaid stay purple. Light/dark capture selection and lighting gradients may adapt, but the dark ground and photographic grade stay fixed. Headings and the official white Obsidian wordmark remain light for contrast on that ground; the official asset bytes are unchanged.
