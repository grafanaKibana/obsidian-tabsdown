import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { actionOptions, captureArgs, checkedOutputDirectory, finishedImages, publicationImages, publicationTarget, updateImagesPullRequest, uploadRelease } from '../workflow.mjs';

const toolkit = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Run a callback in a disposable checkout-shaped directory. */
function fixture(callback) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'capture-action-'));
  try { return callback(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('manual values become literal argv entries and cannot become shell commands', () => {
  const value = 'https://example.test/$(touch owned); echo `whoami`';
  const options = actionOptions({ CAPTURE_DRY_RUN: 'false', CAPTURE_BASE_URL: value, CAPTURE_ONLY: 'hero,feature' });
  const args = captureArgs(options);
  assert.equal(args[args.indexOf('--base-url') + 1], value);
  assert.equal(args[args.indexOf('--only') + 1], 'hero,feature');
  assert.ok(!args.includes('--dry-run'));
  for (const value of ['yes', 'TRUE', '1', 'false\ntrue']) assert.throws(() => actionOptions({ CAPTURE_DRY_RUN: value }), /must be true or false/u);
});

test('every side-effecting action step requires the validated non-dry plan output', () => {
  const source = readFileSync(path.join(toolkit, 'action.yml'), 'utf8');
  const steps = source.split(/^    - /mu).slice(1);
  for (const step of steps) {
    if (step.startsWith('name: Validate and plan captures\n')) continue;
    assert.match(step, /\n      if: steps\.plan\.outputs\.dry-run == 'false'/u, step.split('\n')[0]);
  }
});

test('output paths cannot escape the checkout or select its root', () => fixture((root) => {
  assert.throws(() => checkedOutputDirectory(root, root), /non-root/u);
  assert.throws(() => checkedOutputDirectory(root, '../elsewhere'), /inside the checkout/u);
  assert.throws(() => checkedOutputDirectory(root, 'docs/new\npath'), /inside the checkout/u);
  assert.equal(checkedOutputDirectory(root, 'docs/assets/pictures').relative, 'docs/assets/pictures');
  symlinkSync(os.tmpdir(), path.join(root, 'outside'));
  assert.throws(() => checkedOutputDirectory(root, 'outside'), /symlink/u);
  assert.throws(() => checkedOutputDirectory(root, 'outside/not-created-yet'), /symlink/u);
}));

test('PR publication selects only finished top-level PNGs and rejects linked files', () => fixture((root) => {
  const output = path.join(root, 'docs/pictures');
  mkdirSync(path.join(output, 'captures'), { recursive: true });
  writeFileSync(path.join(output, 'hero.png'), 'image');
  writeFileSync(path.join(output, 'captures/raw.png'), 'raw');
  assert.deepEqual(finishedImages(root, output).map((image) => image.relative), ['docs/pictures/hero.png']);
  const external = path.join(root, 'external.png');
  writeFileSync(external, 'external');
  symlinkSync(external, path.join(output, 'linked.png'));
  assert.throws(() => finishedImages(root, output), /Unsafe generated image/u);
}));

test('publication uses only manifest outputs and rejects stale capture provenance', () => fixture((root) => {
  const output = path.join(root, 'docs/pictures');
  mkdirSync(output, { recursive: true });
  const config = JSON.stringify({ outputDir: 'docs/pictures' });
  writeFileSync(path.join(root, 'product-captures.json'), config);
  for (const name of ['hero.png', 'stale.png']) writeFileSync(path.join(output, name), 'image');
  const manifest = { version: 1, captureMode: 'fresh', configHash: createHash('sha256').update(config).digest('hex'), outputs: [{ file: 'hero.png' }] };
  const manifestPath = path.join(output, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const options = actionOptions({ CAPTURE_DRY_RUN: 'false' });
  assert.deepEqual(publicationImages(options, root).images.map((image) => image.name), ['hero.png']);
  assert.throws(() => publicationImages({ ...options, captureMode: 'existing' }, root), /mode/u);
  writeFileSync(path.join(root, 'product-captures.json'), JSON.stringify({ outputDir: 'docs/pictures', changed: true }));
  assert.throws(() => publicationImages(options, root), /current configuration/u);
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, outputs: [{ file: '../private.png' }] }));
  assert.throws(() => finishedImages(root, output, true), /invalid finished image/u);
}));

test('invalid publication targets fail before gh is invoked', () => {
  assert.deepEqual(publicationTarget('owner/repo', 'v1.2.3'), { repository: 'owner/repo', releaseTag: 'v1.2.3' });
  for (const tag of ['--repo=other/repo', 'v1\ncommand', '../main', 'v1;echo']) {
    assert.throws(() => publicationTarget('owner/repo', tag), /Invalid release tag/u);
  }
  assert.throws(() => publicationTarget('../other/repo', 'v1'), /owner\/repository/u);
});

test('dry-run publication never inspects the filesystem or invokes GitHub', () => {
  const options = actionOptions({ CAPTURE_DRY_RUN: 'true', CAPTURE_RELEASE_TAG: 'v1', CAPTURE_UPDATE_PR: 'true' });
  assert.doesNotThrow(() => uploadRelease(options, '/nonexistent-checkout'));
  assert.doesNotThrow(() => updateImagesPullRequest(options, '/nonexistent-checkout'));
});

test('action dry-run validates the core plan without executing prepare or creating outputs', () => fixture((root) => {
  const config = {
    version: 1,
    project: { id: 'fixture', title: 'Fixture' },
    outputDir: 'docs/pictures',
    prepare: { command: `${JSON.stringify(process.execPath)} -e "require('node:fs').writeFileSync('prepare-ran','bad')"` },
    captures: [{ id: 'app', provider: 'image', path: 'not-built-yet.png' }],
    outputs: [{ id: 'hero', template: 'editorial', captures: ['app'] }],
  };
  writeFileSync(path.join(root, 'product-captures.json'), JSON.stringify(config));
  const before = readdirSync(root);
  const env = { ...process.env, CAPTURE_DRY_RUN: 'true', CAPTURE_CONFIG: 'product-captures.json', CAPTURE_MODE: 'fresh' };
  delete env.GITHUB_OUTPUT;
  const result = spawnSync(process.execPath, [path.join(toolkit, 'workflow.mjs'), 'run'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"project"/u);
  assert.deepEqual(readdirSync(root), before);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'product-captures.json'), 'utf8')), config);
}));

test('a malformed dry-run input fails before config lookup or setup', () => fixture((root) => {
  const result = spawnSync(process.execPath, [path.join(toolkit, 'workflow.mjs'), 'plan'], {
    cwd: root,
    env: { ...process.env, CAPTURE_DRY_RUN: 'TRUE', CAPTURE_CONFIG: 'missing.json' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DRY_RUN must be true or false/u);
  assert.doesNotMatch(result.stderr, /ENOENT/u);
  assert.deepEqual(readdirSync(root), []);
}));

test('image PR publication mutates only manifest PNG paths and never the checkout or index', () => fixture((root) => {
  const bin = path.join(root, 'bin');
  const output = path.join(root, 'docs/pictures');
  mkdirSync(bin);
  mkdirSync(output, { recursive: true });
  const config = JSON.stringify({ outputDir: 'docs/pictures' });
  writeFileSync(path.join(root, 'product-captures.json'), config);
  writeFileSync(path.join(output, 'hero.png'), 'image');
  writeFileSync(path.join(output, 'stale.png'), 'old image that must not be included');
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, captureMode: 'fresh', configHash: createHash('sha256').update(config).digest('hex'), outputs: [{ file: 'hero.png' }] }));
  const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const method = args[2];
const endpoint = args[3].replace('repos/owner/repo/', '');
const body = args.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8')) : null;
fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ method, endpoint, body }) + '\\n');
const missing = () => { console.error('gh: Not Found (HTTP 404)'); process.exit(1); };
let result;
if (endpoint === '') result = { default_branch: 'main' };
else if (endpoint === 'git/ref/heads/main') result = { object: { sha: 'base' } };
else if (endpoint.startsWith('git/ref/heads/docs')) missing();
else if (endpoint === 'git/commits/base') result = { message: 'existing product code', tree: { sha: 'base-tree' } };
else if (endpoint === 'git/blobs') result = { sha: 'new-image-blob' };
else if (endpoint.startsWith('contents/')) missing();
else if (endpoint === 'git/trees') result = { sha: 'image-tree' };
else if (endpoint === 'git/commits') result = { sha: 'image-commit' };
else if (endpoint === 'git/refs') result = { object: { sha: body.sha } };
else if (endpoint.startsWith('pulls?')) result = [];
else if (endpoint === 'pulls') result = { html_url: 'https://github.com/owner/repo/pull/1' };
else throw new Error('Unexpected API call: ' + method + ' ' + endpoint);
process.stdout.write(JSON.stringify(result));
`;
  writeFileSync(path.join(bin, 'gh'), fakeGh);
  chmodSync(path.join(bin, 'gh'), 0o755);
  const before = readFileSync(path.join(output, 'hero.png'), 'utf8');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), CAPTURE_DRY_RUN: 'false', CAPTURE_UPDATE_PR: 'true', CAPTURE_CONFIG: 'product-captures.json', CAPTURE_RELEASE_TAG: 'v1.2.3', FAKE_RECORD: path.join(root, 'api.jsonl') };
  const result = spawnSync(process.execPath, [path.join(toolkit, 'workflow.mjs'), 'pr'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(env.FAKE_RECORD, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const tree = calls.find((call) => call.endpoint === 'git/trees');
  assert.deepEqual(tree.body.tree, [{ path: 'docs/pictures/hero.png', mode: '100644', type: 'blob', sha: 'new-image-blob' }]);
  assert.equal(calls.find((call) => call.endpoint === 'pulls').body.base, 'main');
  assert.ok(!calls.some((call) => /merge/u.test(call.endpoint)));
  assert.equal(readFileSync(path.join(output, 'hero.png'), 'utf8'), before);
  assert.ok(!readdirSync(root).includes('.git'));
}));
