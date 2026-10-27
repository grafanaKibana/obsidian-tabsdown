# Portable product captures

Capture the real product with Playwright, then place the result in a reusable HTML/CSS composition. This standalone Node 22 tool works locally and as a composite GitHub Action. It does not require a hosted image service or an AI image-generation API.

Two art-direction families ship: `porcelain` uses a magnified upright product crop, restrained white surface, and a separate platform lockup; `studio` uses a dark photographic environment, coherent lighting, and a product close-up. `column` and `horizontal` arrange plugin artwork; `site-top` arranges primary website artwork. Legacy `side`, `wide`, and `reverse` arrangements remain available. Existing `editorial`, `feature`, and `showcase` template IDs remain supported; `feature` compares two configured views. Only the product name and optional platform text are added to artwork. Plugin crops may be intentional; full-desktop layouts preserve the entire viewport. Screenshot rotation, skew, and perspective are never used.

## Run

From a repository containing `product-captures.json`:

```sh
node .github/actions/product-captures/cli.mjs --dry-run
node .github/actions/product-captures/cli.mjs --list
npm ci --prefix .github/actions/product-captures
node .github/actions/product-captures/node_modules/playwright/cli.js install chromium
node .github/actions/product-captures/cli.mjs
```

The planning commands do not install packages, start processes, use the network, check for built input files, or create directories. `--dry-run` is available before installing dependencies.

Options:

| Option | Purpose |
| --- | --- |
| `--config path.json` | Use another repository-owned configuration. |
| `--only hero,social` | Generate selected output IDs. |
| `--template editorial` | Override the selected compositions' template. |
| `--theme light` | Override capture and composition theme; also supports `dark`. |
| `--width 1600 --height 1000` | Override output dimensions. |
| `--scale 2` | Increase pixel density; supported range is 1–3. |
| `--base-url http://127.0.0.1:4179` | Replace the web origin and skip the managed server. Combine with `--skip-prepare` for a running preview. |
| `--skip-prepare` | Reuse an explicitly prebuilt product. |
| `--capture-mode existing` | Deliberately use configured source images rather than launch the product. |
| `--output-dir path` | Write somewhere else inside the configuration directory. |

Fresh capture failures are errors, never a reason to silently use old artwork. Existing-image mode is recorded explicitly in the output manifest. Outputs are staged until all requested captures and compositions succeed. The manifest is the final completion marker. Keep finished PNGs in Git; review generated-image PRs before merging.

## Configure scenes

See `example.product-captures.json`. All paths are relative to the config file, and managed outputs stay inside that directory. IDs use lowercase words separated by hyphens. Config files are trusted source code: prepare/server commands and JavaScript readiness expressions must be reviewed with the repository.

Each `web` capture has a URL, viewport, color scheme, optional `localStorage`, capture-only `styles`, interactions, and a ready selector or expression. A stored value of `$theme` uses the effective capture theme. Capture dependencies wait for fonts and visible images; animations and carets are disabled for the screenshot.

Each `obsidian` capture specifies a dedicated fixture vault, note, local built plugin directory, and pinned application/installer versions. `obsidian-launcher` downloads the real app and installs the plugin in a disposable copied vault with isolated user configuration. Playwright connects to that instance over a loopback debugging port. The personal app and vault are not targeted. `PRODUCT_CAPTURE_OBSIDIAN_CACHE` optionally shares downloaded installers between local repositories; the default cache stays inside the repository. Linux requires Xvfb and a window manager; the Action installs and manages them. Obsidian-specific permission interactions, such as allowing a Mermaid diagram in the trusted disposable fixture, belong in that scene's explicit actions.

The `image` provider reads an authored local image directly, suitable for an exported document or an intentionally static source. It is identified as existing media in provenance.

`project.title` is the product name. `project.subtitle` is optional; use a short platform line such as `for Obsidian`, or leave it empty. Artwork has no marketing headlines, footer captions, or appearance labels. `outputs` select source IDs, template, and dimensions.

Set `project.artDirection` to `porcelain` or `studio`, `project.layout` to `site-top`, `column`, `horizontal`, `desktop-centered`, or a legacy layout, and optional `imageZoom` to control the feature scale. Optional `imageOffsetX` shifts the focal crop horizontally in pixels normalized to a 1600px artboard; zero leaves it unchanged. Outputs can override those choices for social crops or comparisons. Optional `output.frameHeight` limits a wide frame to a fraction of the artboard height (0.1–0.7), allowing a clean crop between content blocks. `project.subtitle` is the optional platform lockup; an empty string omits it. The bundled photographic plate is decorative generated imagery, stored once with provenance; ordinary regeneration makes no image-generation calls. Product imagery comes from the explicitly configured source: real capture or an authored still image. Preview GIFs require real product capture. Fonts, plate, and captures are embedded before rendering, with no remote render assets.

The old full-window-containment assumption is deliberately removed: a stable focal crop is often what makes the product readable. Use a curated fixture with meaningful content, and compare the image at actual README display size. Release/manual capture behavior and publication boundaries are unchanged.

## GitHub Actions

Copy this folder to `.github/actions/product-captures`, add the root config, and call the action:

```yaml
- uses: ./.github/actions/product-captures
  with:
    dry-run: 'false'
    only: hero,themes,social
```

The Action has inputs matching the main CLI options, plus `release-tag` and `update-pr`. Defaults are dry-run enabled, fresh captures, and publication disabled. Pass the release's exact tag when attaching images. `update-pr: 'true'` opens a separate PNG-only documentation PR through GitHub's Git data API; it never edits the runner's index or auto-merges. Publishing requires `contents: write`, and image PRs also need `pull-requests: write` and repository permission for Actions to create PRs.

Validate inputs before any dependency installation. Real runs install pinned tool dependencies and the matching Chromium, perform the configured build, capture and export, then upload an artifact. Dry runs perform planning only. Output publication checks the completed manifest's configuration hash and capture mode and uploads only requested finished images.

A standalone workflow supports `workflow_dispatch` with dry-run, mode, output selection, template, theme, dimensions, preview origin, release tag, and PR controls. Existing release workflows should call the action directly after a release is successfully created: releases created with `GITHUB_TOKEN` do not cause another `release.published` workflow run. An already-existing release is not a new release; use manual dispatch for intentional regeneration.

## Add another repository

```sh
node install.mjs --repo /path/to/repo --id my-project --title "My project" --url http://127.0.0.1:4179 --dry-run
node install.mjs --repo /path/to/repo --id my-project --title "My project" --url http://127.0.0.1:4179 --server "npm run preview" --prepare "npm ci && npm run build" --apply
```

The installer defaults to planning and refuses to overwrite existing action/config/workflow paths. It copies the runtime, pinned lockfile, assets, tests and a manual/release workflow. Add scenes appropriate to the product, and wire the action directly into token-based release jobs. Host-specific ESLint/Prettier configurations may need a scoped exception for this separately owned package; keep its own contract tests enabled in CI rather than broadly disabling checks.

## Verify

```sh
npm run check
npm run test:browser
```

The contract tests exercise no-write planning, config/path validation, explicit source modes, failed-run preservation, manual argv handling, release/PR boundaries, installer portability and cancellation. The browser smoke test covers real local interaction and all three templates. Use a fixed OS, browser, fonts, application versions and fixture content for repeatable rendering; cross-platform pixel identity is not promised.

Geist is distributed with its SIL Open Font License in `assets/Geist-LICENSE`. Playwright and obsidian-launcher remain separately licensed dependencies.

## Aligned studio and full-desktop layouts

Plugin configs use `layout: "column"`: Obsidian uses purple and Quartz uses blue studio grading. The name is centered at the screenshot top, and the optional platform lockup is centered at its bottom. `layout: "horizontal"` provides the title-above alternative. Official Obsidian icon-and-wordmark SVGs are bundled unchanged; photography tint never applies to the logo. Their official source URLs and hashes are in `assets/obsidian-branding.provenance.json`.

DevBook uses `site-top`; Legacy Portfolio and the current portfolio use `desktop-centered` containment. All use centered titles above the image, abstract optical surfaces, and lower fade/blur. DevBook has no subtitle and uses a more contrasting sage ground. Portfolio v1 has a longer configured fade. Both portfolio integrations capture 1440×900.

Manual alternatives from a plugin repository:

```sh
node .github/actions/product-captures/cli.mjs --only horizontal --capture-mode existing
```

From a portfolio repository:

```sh
node .github/actions/product-captures/cli.mjs --only centered --capture-mode existing
```

Omit `--capture-mode existing` for a fresh app capture. Workflow manual runs accept the same output IDs in `only`.

## Authored stills and site polish

Static plugin artwork may use authored or illustrative imagery through the existing `image` provider with an explicit local path. It is recorded as image media; it is never silently substituted after a failed fresh capture. Preview GIFs must show the real product; the still-image renderer does not generate or replace GIFs.

`site-top` places a title above a fuller website view, with `edgeBleed` controlling a small intentional overflow and the bottom fade/blur retained. `siteBackdrop` enables an abstract optical surface of directional light folds, graded with `siteTint`. Website compositions do not embed the studio photograph. The contained `desktop-centered` alternative remains available. Blue studio variants can set `studioTint`, `studioShade`, and `studioGlow`; these affect only the backdrop, never official platform branding or product imagery.

## Release posters and identity-only artwork

An `image` capture can point directly to an authored release PNG. Set `output.imageFit` to `"contain"` for `column` or `horizontal` layouts to display the whole poster without clipping; the default `"crop"` preserves existing screenshot framing. Release artwork is a versioned input: changing the configured poster regenerates the composed output on the next release or manual run.

Set `output.showProduct` to `false` and `output.captures` to `[]` to export the name, optional platform lockup, and backdrop without a product panel. When all outputs use this mode, `captures: []` is valid and no source app is launched. Omit prepare/server commands for a source-free configuration. Flowmaid uses this mode; its approved column name and lockup positions are preserved.

## Light and dark exports

Every integrated output has a pair: the original base filename such as `hero.png` is light, and `hero-dark.png` is dark. Each output declares `theme: "light"` or `"dark"` plus `capturesByTheme: { "light": ["overview-light"], "dark": ["overview-dark"] }`. A normal release or unfiltered manual run generates both. The new-repo installer scaffolds both source scenes and three output pairs. Tabsdown and Colsdown use real Obsidian captures; Flowmaid remains source-free.

`--only hero,hero-dark` selects a pair. `--theme dark` intentionally overrides the selected outputs' theme and resolves the dark source through `capturesByTheme`, including `--capture-mode existing`. The IDs and filenames remain those selected; use a separate `--output-dir` for exploratory overrides.

README heroes use GitHub's [documented picture/source pattern](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/quickstart-for-writing-on-github#adding-an-image-to-suit-your-visitors):

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/product-captures/hero-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/product-captures/hero.png">
  <img src="docs/assets/product-captures/hero.png" alt="Product overview">
</picture>
```

`fadeStart`, `fadeEnd`, and `blurStart` configure normalized 0–1 positions on a porcelain window. Defaults are 0.67, 1, and 0.62. Start must precede end; project values can be overridden per output. Portfolio v1 uses 0.4, 0.9, and 0.38 to dissolve gradually before the bottom edge.

Studio backdrops keep their configured product tint and original base exposure in both UI themes: Obsidian plugins stay purple, and Quartz stays blue. UI screenshots and lighting gradients may adapt. White lettering and the official white Obsidian lockup remain readable against that fixed dark studio ground. Website backgrounds retain their own theme treatment.

Identity-only column artwork centers its name and platform line across the full canvas. In the horizontal alternative, both lines are centered in separate rows above the environment. Product columns with screenshots keep their approved side-column alignment.
