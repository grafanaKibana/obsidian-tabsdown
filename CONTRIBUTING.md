# Contributing

Tabsdown is intentionally small: Markdown remains the source of truth, Obsidian's public renderer handles panel content, and optional plugins are integrations rather than runtime dependencies.

## Before opening a pull request

1. Open or select an issue.
2. Keep the change inside that issue's acceptance criteria.
3. Do not add private Obsidian APIs, runtime dependencies, plugin-specific adapters, or source-mutating tab behavior.
4. Build DOM with Obsidian's `createEl` helpers in files that import `obsidian`. Only the runtime-agnostic modules — the ones the Quartz port and the jsdom tests reuse — use `ownerDocument.createElement`, and the `obsidianmd/prefer-create-el` override in `eslint.config.mts` lists exactly those files.
5. Run:

   ```bash
   npm ci
   npm run check
   ```

6. Test the affected behavior in the relevant Obsidian modes and platforms.

## Development

Use Node 24 for release parity.

```bash
npm install
npm run dev
```

For manual testing, copy or link this repository into:

```text
<Vault>/.obsidian/plugins/tabsdown/
```

Build `main.js`, reload Obsidian, then enable **Tabsdown** under **Settings → Community plugins**.

The demo vault must always contain the latest plugin built from the same commit, so anyone can open `demo/` in Obsidian and exercise the current behavior. After any change that affects the plugin or its release assets, run `npm run demo` and commit all changed files under `demo/.obsidian/plugins/tabsdown/`; never leave the demo vault on an older build. CI fails the `quality` check when the committed demo plugin does not match the source.

Tabsdown is the only plugin enabled in the tracked demo state. Style Settings, BRAT, Templater, Dataview, and Datacore are tracked as manifests and styles only, because `main.js` is ignored for everything but Tabsdown. Install and enable them through **Settings → Community plugins** before using the parts of `Tabsdown test matrix.md` that need them.

## Pull requests

- Use one short-lived branch per change, branched from `main` and squash-merged back into it.
- Link the issue in the pull request body with a closing keyword, such as `Closes #17`.
- Prefer one independently verifiable issue per pull request.
- Include command output and manual test evidence.
- Treat inaccessible focus, leaked render children, source mutation, and release-contract failures as blockers.

Pull requests into `main` need the `quality` check. `main` cannot be force-pushed or deleted.

## Releases

`main` is always releasable, and a release is cut on demand rather than as a side effect of merging.

1. Run `npm run version -- <x.y.z>`, which updates `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` together. Merge that bump into `main` like any other change.
2. Run the **Release** workflow with **dry-run** checked. It builds, verifies, and prints the notes it would publish, without tagging anything.
3. Complete the relevant manual testing, then run the workflow again with **dry-run** unchecked. The workflow creates the exact unprefixed tag for the current `main` head, prepares a draft, uploads `main.js`, `manifest.json`, and `styles.css`, and publishes the latest release only after every asset succeeds.

If an upload fails, the release remains a resumable draft; re-running the workflow refreshes its notes and draft assets before publication. Tagging accepts an existing tag only when it points at the commit being released.

Do not replace a published tag or its assets; corrections require a higher version.

### Tagging permissions

The workflow tags with the default `GITHUB_TOKEN`, which requires the `release tags` ruleset to restrict `update` and `deletion` but **not** `creation`. A user-owned repository cannot grant the GitHub Actions app a ruleset bypass, so restoring a `creation` restriction breaks every release at the tagging step, and would mean reintroducing an owner-scoped personal access token. Tags stay immutable either way: the remaining rules still forbid moving or deleting one.

Submit only a published stable release through the current [Obsidian Community site](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin): sign in, link the GitHub owner, open **Plugins → New plugin**, enter this repository URL, accept the policies and maintenance commitment, and submit. Do not open a manual submission pull request to `obsidianmd/obsidian-releases`. Only the initial release is submitted through the Community site; later versions are discovered from published GitHub Releases.

Automated-review changes require a higher patch release and the same release gates before using **Retry**. Do not claim Community Plugins availability until review passes and the listing is published.
