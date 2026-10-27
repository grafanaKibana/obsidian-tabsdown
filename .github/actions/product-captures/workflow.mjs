import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const actionRoot = path.dirname(fileURLToPath(import.meta.url));

/** Read action inputs without evaluating any input as shell source. */
export function actionOptions(env = process.env) {
  const boolean = (name, fallback = false) => {
    const value = env[`CAPTURE_${name}`];
    if (value === undefined || value === '') return fallback;
    if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
    return value === 'true';
  };
  return {
    config: env.CAPTURE_CONFIG || 'product-captures.json',
    dryRun: boolean('DRY_RUN', true),
    captureMode: env.CAPTURE_MODE || 'fresh',
    only: env.CAPTURE_ONLY || '',
    template: env.CAPTURE_TEMPLATE || '',
    theme: env.CAPTURE_THEME || '',
    width: env.CAPTURE_WIDTH || '',
    height: env.CAPTURE_HEIGHT || '',
    scale: env.CAPTURE_SCALE || '',
    baseUrl: env.CAPTURE_BASE_URL || '',
    outputDir: env.CAPTURE_OUTPUT_DIR || '',
    skipPrepare: boolean('SKIP_PREPARE'),
    releaseTag: env.CAPTURE_RELEASE_TAG || '',
    updatePr: boolean('UPDATE_PR'),
  };
}

/** Produce a literal argv vector; quotes, substitutions, and newlines remain data. */
export function captureArgs(options, dryRun = options.dryRun) {
  const args = [path.join(actionRoot, 'cli.mjs'), '--config', options.config, '--capture-mode', options.captureMode];
  const pairs = [['only', '--only'], ['template', '--template'], ['theme', '--theme'], ['width', '--width'], ['height', '--height'], ['scale', '--scale'], ['baseUrl', '--base-url'], ['outputDir', '--output-dir']];
  for (const [key, flag] of pairs) if (options[key]) args.push(flag, options[key]);
  if (options.skipPrepare) args.push('--skip-prepare');
  if (dryRun) args.push('--dry-run');
  return args;
}

/** Require generated files to remain inside the repository checkout. */
export function checkedOutputDirectory(root, directory) {
  const absolute = path.resolve(root, directory);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || /[\r\n]/u.test(relative)) {
    throw new Error('The action output directory must be a non-root path inside the checkout');
  }
  let ancestor = absolute;
  while (!existsSync(ancestor) && ancestor !== root) ancestor = path.dirname(ancestor);
  const physical = path.relative(realpathSync(root), realpathSync(ancestor));
  if (physical.startsWith('..') || path.isAbsolute(physical)) throw new Error('The output directory escapes the checkout through a symlink');
  return { absolute, relative: relative.split(path.sep).join('/') };
}

/** Discover finished PNGs only, excluding raw captures and auxiliary metadata. */
export function finishedImages(root, directory, requireManifest = false) {
  const output = checkedOutputDirectory(root, directory);
  const manifestPath = path.join(output.absolute, 'manifest.json');
  let files;
  if (existsSync(manifestPath)) {
    if (path.dirname(realpathSync(manifestPath)) !== realpathSync(output.absolute)) throw new Error('Unsafe capture manifest symlink');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.outputs) || !manifest.outputs.length) throw new Error('Invalid completed capture manifest');
    files = manifest.outputs.map((entry) => entry.file);
    if (new Set(files).size !== files.length || files.some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/u.test(name))) throw new Error('Manifest contains invalid finished image paths');
  } else {
    if (requireManifest) throw new Error('Publication requires the completed capture manifest');
    files = readdirSync(output.absolute).filter((name) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/u.test(name));
  }
  return files.sort().map((name) => {
    const absolute = path.join(output.absolute, name);
    if (!statSync(absolute).isFile() || path.dirname(realpathSync(absolute)) !== realpathSync(output.absolute)) throw new Error(`Unsafe generated image: ${name}`);
    return { absolute, relative: `${output.relative}/${name}`, name };
  });
}

/** Require publication provenance to match this configuration and explicit capture mode. */
export function publicationImages(options, root = process.cwd()) {
  const configPath = path.resolve(root, options.config);
  const configText = readFileSync(configPath, 'utf8');
  const config = JSON.parse(configText);
  const output = path.resolve(path.dirname(configPath), options.outputDir || config.outputDir || 'docs/assets/product-captures');
  const images = finishedImages(root, output, true);
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.captureMode !== options.captureMode) throw new Error('Capture manifest mode does not match this publication run');
  if (manifest.configHash !== createHash('sha256').update(configText).digest('hex')) throw new Error('Capture manifest does not match the current configuration');
  return { output, images, manifestPath };
}

/** Run an executable without a shell and fail with its exit status. */
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status}`);
  return result;
}

/** Validate the core plan before installing dependencies or starting browsers. */
export function planAction(options, root = process.cwd()) {
  command(process.execPath, captureArgs(options, true), { cwd: root });
  const configFile = path.resolve(root, options.config);
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const configRoot = path.dirname(configFile);
  const output = checkedOutputDirectory(root, path.resolve(configRoot, options.outputDir || config.outputDir || 'docs/assets/product-captures'));
  const needsObsidian = options.captureMode === 'fresh' && config.captures.some((capture) => capture.provider === 'obsidian');
  const plan = { output, needsObsidian, dryRun: options.dryRun };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `artifact-path=${output.relative}\nneeds-obsidian=${needsObsidian}\ndry-run=${options.dryRun}\n`);
  }
  return plan;
}

/** Capture under a disposable Linux display only when a real Obsidian scene needs one. */
export function runAction(options, root = process.cwd()) {
  if (options.dryRun) return planAction(options, root);
  const config = JSON.parse(readFileSync(path.resolve(root, options.config), 'utf8'));
  const obsidian = options.captureMode === 'fresh' && config.captures.some((capture) => capture.provider === 'obsidian');
  if (process.platform === 'linux' && obsidian && !process.env.DISPLAY) {
    return command('xvfb-run', ['--auto-servernum', process.execPath, fileURLToPath(import.meta.url), 'run'], { cwd: root });
  }
  let windowManager;
  try {
    if (process.platform === 'linux' && obsidian) windowManager = spawn('openbox', [], { stdio: 'ignore' });
    return command(process.execPath, captureArgs(options, false), { cwd: root });
  } finally {
    windowManager?.kill('SIGTERM');
  }
}

/** Invoke the GitHub CLI API using JSON on stdin instead of interpolated shell text. */
function githubApi(repository, endpoint, body, method = body ? 'POST' : 'GET') {
  const args = ['api', '--method', method, `repos/${repository}/${endpoint}`];
  if (body !== undefined) args.push('--input', '-');
  const result = spawnSync('gh', args, { input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`GitHub API ${method} ${endpoint}: ${result.stderr.trim()}`);
    error.status = /HTTP 404/u.test(result.stderr) ? 404 : result.status;
    throw error;
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

/** Accept repository/tag names as data while rejecting invalid publication targets. */
export function publicationTarget(repository, releaseTag) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository || '')) throw new Error('GITHUB_REPOSITORY must be owner/repository');
  if (releaseTag && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(releaseTag) || releaseTag.includes('..'))) throw new Error('Invalid release tag');
  return { repository, releaseTag };
}

/** Attach finished artwork and its provenance manifest to the explicitly selected release. */
export function uploadRelease(options, root = process.cwd()) {
  if (options.dryRun || !options.releaseTag) return;
  const target = publicationTarget(process.env.GITHUB_REPOSITORY, options.releaseTag);
  const { images, manifestPath } = publicationImages(options, root);
  if (!images.length) throw new Error('No finished PNG images to publish');
  const files = images.map((image) => image.absolute);
  files.push(manifestPath);
  command('gh', ['release', 'upload', target.releaseTag, ...files, '--repo', target.repository, '--clobber'], { cwd: root });
}

/** Open a review-only generated-image PR through Git data APIs, without touching the checkout or index. */
export function updateImagesPullRequest(options, root = process.cwd()) {
  if (options.dryRun || !options.updatePr) return;
  const { repository, releaseTag } = publicationTarget(process.env.GITHUB_REPOSITORY, options.releaseTag);
  const { images } = publicationImages(options, root);
  if (!images.length) throw new Error('No finished PNG images for an update PR');
  const repo = githubApi(repository, '');
  const base = repo.default_branch;
  const version = releaseTag || process.env.GITHUB_SHA?.slice(0, 12) || 'manual';
  const branch = `docs/product-captures-${version.replace(/[^A-Za-z0-9._-]/gu, '-')}`;
  const message = `docs: refresh product captures for ${version}`;
  const baseRef = githubApi(repository, `git/ref/heads/${encodeURIComponent(base)}`);
  let branchRef;
  try { branchRef = githubApi(repository, `git/ref/heads/${encodeURIComponent(branch)}`); }
  catch (error) { if (error.status !== 404) throw error; }
  const parent = branchRef?.object.sha || baseRef.object.sha;
  const commit = githubApi(repository, `git/commits/${parent}`);
  if (branchRef && !commit.message.startsWith(message)) throw new Error(`Refusing to update an existing branch not owned by this image run: ${branch}`);
  const entries = [];
  for (const image of images) {
    const content = readFileSync(image.absolute).toString('base64');
    const blob = githubApi(repository, 'git/blobs', { content, encoding: 'base64' });
    let existing;
    try { existing = githubApi(repository, `contents/${image.relative.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branchRef ? branch : base)}`); }
    catch (error) { if (error.status !== 404) throw error; }
    if (existing?.sha !== blob.sha) entries.push({ path: image.relative, mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (!entries.length) { console.log('Generated images already match the target branch.'); return; }
  const tree = githubApi(repository, 'git/trees', { base_tree: commit.tree.sha, tree: entries });
  const next = githubApi(repository, 'git/commits', { message, tree: tree.sha, parents: [parent] });
  if (branchRef) githubApi(repository, `git/refs/heads/${encodeURIComponent(branch)}`, { sha: next.sha, force: false }, 'PATCH');
  else githubApi(repository, 'git/refs', { ref: `refs/heads/${branch}`, sha: next.sha });
  const owner = repository.split('/')[0];
  const pulls = githubApi(repository, `pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (!pulls.length) {
    const body = `Regenerated product screenshots from ${releaseTag ? `release ${releaseTag}` : `commit ${process.env.GITHUB_SHA || 'the selected manual run'}`}.\n\nOnly finished PNG artwork is included. Review the images before merging; this workflow never merges the PR.\n\nRun: ${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID || ''}`;
    const pull = githubApi(repository, 'pulls', { title: message, head: branch, base, body });
    console.log(`Image update PR: ${pull.html_url}`);
  } else console.log(`Image update PR: ${pulls[0].html_url}`);
}

/** Dispatch the action's internal commands; dry-runs never publish or launch processes. */
export function main(argv = process.argv.slice(2)) {
  const options = actionOptions();
  const operation = argv[0] || 'plan';
  if (operation === 'plan') return planAction(options);
  if (operation === 'run') return runAction(options);
  if (operation === 'release') return uploadRelease(options);
  if (operation === 'pr') return updateImagesPullRequest(options);
  throw new Error(`Unknown action operation: ${operation}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
