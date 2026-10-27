import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

/** Reserve an unused loopback port for this isolated application's debugger. */
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

/** Resolve only vault and plugin paths contained in the configuration's repository. */
async function ownedPath(root, value) {
  const result = path.resolve(root, value);
  if (result !== root && !result.startsWith(`${root}${path.sep}`)) throw new Error('Obsidian input must stay inside the repository');
  const physical = await realpath(result);
  if (physical !== root && !physical.startsWith(`${root}${path.sep}`)) throw new Error('Obsidian input symlink must stay inside the repository');
  return physical;
}

/** Capture the real plugin in a disposable vault and isolated Obsidian installation. */
export async function captureObsidian({ capture, root, path: destination, chromium, timeoutMs = 120000, registerCleanup }) {
  const { default: ObsidianLauncher } = await import('obsidian-launcher');
  const options = capture.obsidian;
  if (!/^\d+\.\d+\.\d+$/.test(options.appVersion ?? '') || !/^\d+\.\d+\.\d+$/.test(options.installerVersion ?? '')) {
    throw new Error('Obsidian captures require pinned appVersion and installerVersion');
  }
  const cache = path.join(root, '.product-captures-cache', 'obsidian');
  await mkdir(cache, { recursive: true });
  const session = await mkdtemp(path.join(cache, 'session-'));
  const vault = path.join(session, 'vault');
  const sourceVault = await ownedPath(root, options.vault);
  const pluginDir = await ownedPath(root, options.pluginDir ?? '.');
  const plugin = JSON.parse(await readFile(path.join(pluginDir, 'manifest.json'), 'utf8'));
  const launcher = new ObsidianLauncher({ cacheDir: process.env.PRODUCT_CAPTURE_OBSIDIAN_CACHE ?? cache });
  let instance;
  let browser;
  let page;
  let cancelled = false;
  let cleanupPromise;
  /** Close only this launcher's process, configuration, and copied vault. */
  async function cleanup() {
    cancelled = true;
    if (cleanupPromise) await cleanupPromise;
    cleanupPromise = (async () => {
      await browser?.close().catch(() => {});
      if (instance?.proc && instance.proc.exitCode === null) {
        instance.proc.kill('SIGTERM');
        await Promise.race([once(instance.proc, 'exit').catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
        if (instance.proc.exitCode === null) instance.proc.kill('SIGKILL');
      }
      if (instance?.configDir) await rm(instance.configDir, { recursive: true, force: true });
      await rm(session, { recursive: true, force: true });
    })();
    try { await cleanupPromise; } finally { cleanupPromise = undefined; }
  }
  const unregisterCleanup = registerCleanup?.(cleanup) ?? (() => {});
  try {
    await cp(sourceVault, vault, { recursive: true, filter: source => !source.split(path.sep).includes('.obsidian') });
    if (cancelled) throw new Error('Obsidian capture interrupted');
    const port = await freePort();
    instance = await launcher.launch({
      appVersion: options.appVersion,
      installerVersion: options.installerVersion,
      vault,
      copy: false,
      plugins: [pluginDir],
      args: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--no-sandbox', '--disable-gpu'],
      spawnOptions: { stdio: 'ignore', env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } },
    });
    if (cancelled) throw new Error('Obsidian capture interrupted');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (cancelled) throw new Error('Obsidian capture interrupted');
      if (instance.proc.exitCode !== null) throw new Error(`Isolated Obsidian exited with code ${instance.proc.exitCode}`);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    if (!browser) throw new Error('Timed out connecting to isolated Obsidian; Linux needs Xvfb and a window manager');
    const context = browser.contexts()[0];
    page = context.pages().find(candidate => candidate.url().startsWith('app://'));
    while (!page && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      page = context.pages().find(candidate => candidate.url().startsWith('app://'));
    }
    if (!page) throw new Error('Obsidian did not open a vault window');
    await page.setViewportSize(capture.viewport ?? { width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: capture.colorScheme ?? 'light' });
    await page.waitForFunction(() => Boolean(globalThis.app?.workspace?.layoutReady), null, { timeout: timeoutMs });
    await page.waitForFunction(id => Boolean(globalThis.app?.plugins?.plugins?.[id]), plugin.id, { timeout: timeoutMs });
    await page.evaluate(async ({ note, theme }) => {
      const app = globalThis.app;
      app.vault.setConfig('showInlineTitle', false);
      app.vault.setConfig('readableLineLength', false);
      document.body.classList.toggle('theme-dark', theme === 'dark');
      document.body.classList.toggle('theme-light', theme !== 'dark');
      app.workspace.leftSplit?.collapse();
      app.workspace.rightSplit?.collapse();
      const file = app.vault.getAbstractFileByPath(note);
      if (!file || file.extension !== 'md') throw new Error(`Capture note not found: ${note}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await leaf.setViewState({ type: 'markdown', state: { file: note, mode: 'preview' }, active: true });
      await document.fonts.ready;
    }, { note: options.note, theme: capture.colorScheme ?? 'light' });
    await page.locator('.markdown-preview-view').last().waitFor({ state: 'visible', timeout: timeoutMs });
    for (const action of capture.actions ?? []) {
      if (action.type === 'click') await page.locator(action.selector).first().click();
      else if (action.type === 'fill') await page.locator(action.selector).first().fill(action.value);
      else if (action.type === 'scroll') await page.evaluate(({ x, y }) => document.querySelector('.markdown-preview-view')?.scrollTo(x, y), { x: action.x ?? 0, y: action.y ?? 0 });
    }
    if (capture.ready?.selector) await page.locator(`.workspace-leaf.mod-active .markdown-preview-view ${capture.ready.selector}`).last().waitFor({ state: 'visible', timeout: timeoutMs });
    if (capture.ready?.expression) await page.waitForFunction(capture.ready.expression, null, { timeout: timeoutMs });
    if (capture.styles) await page.addStyleTag({ content: capture.styles });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await mkdir(path.dirname(destination), { recursive: true });
    await page.screenshot({ path: destination, animations: 'disabled', caret: 'hide' });
    const viewport = page.viewportSize();
    return { provider: 'obsidian', appVersion: options.appVersion, installerVersion: options.installerVersion, pluginId: plugin.id, pluginVersion: plugin.version, isolatedVault: true, width: viewport.width, height: viewport.height };
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(cache, 'last-failed.png') }).catch(() => {});
    throw error;
  } finally {
    unregisterCleanup();
    await cleanup();
  }
}
