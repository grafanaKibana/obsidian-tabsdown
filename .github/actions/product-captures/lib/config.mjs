import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMPLATES = ['editorial', 'feature', 'showcase'];
const BACKGROUNDS = ['solid', 'ribbons', 'contours', 'blocks'];
const ART_DIRECTIONS = ['porcelain', 'studio'];
const THEMES = ['light', 'dark'];
const LAYOUTS = ['side', 'wide', 'reverse', 'column', 'horizontal', 'desktop-side', 'desktop-centered', 'site-top'];
const COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const VALUES = new Set(['config','only','template','theme','width','height','scale','base-url','output-dir','capture-mode']);
const FLAGS = new Set(['dry-run','list','skip-prepare','help','version']);

/** Parse supported CLI switches without evaluating shell content. */
export function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!match) throw new Error(`Unexpected argument: ${args[i]}`);
    const [, key, inline] = match;
    if (Object.hasOwn(options, key)) throw new Error(`Repeated option: --${key}`);
    if (FLAGS.has(key)) {
      if (inline !== undefined) throw new Error(`--${key} takes no value`);
      options[key] = true;
    } else if (VALUES.has(key)) {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[key] = value;
    } else throw new Error(`Unknown option: --${key}`);
  }
  if (options.template && !TEMPLATES.includes(options.template)) throw new Error('Unknown template');
  if (options.theme && !['light','dark'].includes(options.theme)) throw new Error('Theme must be light or dark');
  if (options['capture-mode'] && !['fresh','existing'].includes(options['capture-mode'])) throw new Error('Capture mode must be fresh or existing');
  for (const key of ['width','height']) if (options[key]) options[key] = dimension(options[key], key);
  if (options.scale) {
    options.scale = Number(options.scale);
    if (!Number.isFinite(options.scale) || options.scale < 1 || options.scale > 3) throw new Error('Scale must be between 1 and 3');
  }
  if (options['base-url']) validateUrl(options['base-url'], '--base-url');
  return options;
}

/** Resolve a repository-authored path without permitting traversal outside its config root. */
export function inside(root, value, label = 'path') {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`Invalid ${label}`);
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} must stay inside the configuration directory`);
  return resolved;
}

/** Reject existing symlinks that would direct output writes outside the configuration root. */
export async function assertInsideReal(root,value,label='output') {
  let current=inside(root,value,label);
  for(;;) {
    try {inside(root,await fs.realpath(current),`${label} symlink`);return;}
    catch(error) {
      if(error.code!=='ENOENT')throw error;
      if(current===root)throw error;
      current=path.dirname(current);
    }
  }
}

/** Validate supported HTTP capture locations; credentials belong outside configuration. */
export function validateUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${label}: ${value}`); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${label} must be HTTP(S) without URL credentials`);
  return url;
}

/** Validate composition choices while keeping source capture and publication planning unchanged. */
function validateArtDirection(value, label) {
  if (value.artDirection !== undefined && !ART_DIRECTIONS.includes(value.artDirection)) throw new Error(`Unknown ${label} art direction`);
  if (value.layout !== undefined && !LAYOUTS.includes(value.layout)) throw new Error(`Unknown ${label} layout`);
  if (value.imageZoom !== undefined && (typeof value.imageZoom !== 'number' || !Number.isFinite(value.imageZoom) || value.imageZoom < .6 || value.imageZoom > 2)) throw new Error(`${label} imageZoom must be a finite number between 0.6 and 2`);
  if (value.imageOffsetX !== undefined && (typeof value.imageOffsetX !== 'number' || !Number.isFinite(value.imageOffsetX) || value.imageOffsetX < -600 || value.imageOffsetX > 600)) throw new Error(`${label} imageOffsetX must be a finite number between -600 and 600`);
  if (value.edgeBleed !== undefined && (typeof value.edgeBleed !== 'number' || !Number.isFinite(value.edgeBleed) || value.edgeBleed < 0 || value.edgeBleed > .15)) throw new Error(`${label} edgeBleed must be a finite number between 0 and 0.15`);
  for (const key of ['fadeStart','fadeEnd','blurStart']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1)) throw new Error(`${label} ${key} must be a finite fraction between 0 and 1`);
  if (value.fadeStart !== undefined && value.fadeEnd !== undefined && value.fadeStart >= value.fadeEnd) throw new Error(`${label} fadeStart must precede fadeEnd`);
}

/** Load and validate a config without starting processes, importing browsers, or writing files. */
export async function loadPlan(options, cwd = process.cwd()) {
  const configPath = path.resolve(cwd, options.config ?? 'product-captures.json');
  const root = await fs.realpath(path.dirname(configPath));
  const text = await fs.readFile(configPath, 'utf8');
  let config;
  try { config = JSON.parse(text); } catch (error) { throw new Error(`Invalid JSON in ${configPath}: ${error.message}`); }
  if (!config || config.version !== 1) throw new Error('Config version must be 1');
  if (!config.project || !ID.test(config.project.id ?? '') || typeof config.project.title !== 'string' || !config.project.title.trim()) throw new Error('Project requires an id and title');
  if (config.project.subtitle !== undefined && typeof config.project.subtitle !== 'string') throw new Error('Project subtitle must be a string');
  validateArtDirection(config.project, 'project');
  if (config.project.studioTint !== undefined && (typeof config.project.studioTint !== 'string' || !COLOR.test(config.project.studioTint))) throw new Error('Project studioTint must be a literal hex color');
  for (const key of ['studioShade','studioGlow','siteTint']) if (config.project[key] !== undefined && (typeof config.project[key] !== 'string' || !COLOR.test(config.project[key]))) throw new Error(`Project ${key} must be a literal hex color`);
  if (config.project.siteBackdrop !== undefined && typeof config.project.siteBackdrop !== 'boolean') throw new Error('Project siteBackdrop must be a boolean');
  if (config.project.backdropPosition !== undefined && !['left','center','right'].includes(config.project.backdropPosition)) throw new Error('Project backdropPosition must be left, center, or right');
  if (config.project.backgroundStyle !== undefined && !BACKGROUNDS.includes(config.project.backgroundStyle)) throw new Error('Unknown project background style');
  if (config.project.palette !== undefined && (!Array.isArray(config.project.palette) || config.project.palette.length < 3 || config.project.palette.length > 5 || config.project.palette.some(value => typeof value !== 'string' || !COLOR.test(value)))) throw new Error('Project palette requires 3-5 literal hex colors');
  if (!Array.isArray(config.captures) || !Array.isArray(config.outputs) || !config.outputs.length) throw new Error('Config requires capture and output arrays');
  const captureIds = new Set();
  for (const capture of config.captures) {
    if (!capture || typeof capture !== 'object') throw new Error('Capture must be an object');
    if (!ID.test(capture.id ?? '') || captureIds.has(capture.id)) throw new Error(`Invalid or duplicate capture id: ${capture.id}`);
    captureIds.add(capture.id);
    if (!['web','obsidian','image'].includes(capture.provider)) throw new Error(`Invalid provider for ${capture.id}`);
    if (capture.provider === 'web') {
      if (typeof capture.url !== 'string' || !capture.url) throw new Error(`Missing URL for ${capture.id}`);
      if (!capture.url.startsWith('/')) validateUrl(capture.url, `URL for ${capture.id}`);
    }
    if (capture.provider === 'image' && !capture.path) throw new Error(`Missing image path for ${capture.id}`);
    for (const key of ['path','fallback']) if (capture[key]) inside(root, capture[key], `${capture.id}.${key}`);
    if (capture.provider === 'obsidian') {
      if (!capture.obsidian || !capture.obsidian.vault || !capture.obsidian.note) throw new Error(`Obsidian capture ${capture.id} requires a vault and note`);
      inside(root, capture.obsidian.vault, 'Obsidian vault');
      if (capture.obsidian.pluginDir) inside(root, capture.obsidian.pluginDir, 'Obsidian plugin directory');
      if (typeof capture.obsidian.note !== 'string' || capture.obsidian.note.includes('\0') || path.isAbsolute(capture.obsidian.note) || capture.obsidian.note.split(/[\\/]/).includes('..')) throw new Error('Obsidian note must be a vault-relative path');
      for (const key of ['appVersion','installerVersion']) if (!/^\d+\.\d+\.\d+$/.test(capture.obsidian[key] ?? '')) throw new Error(`Obsidian ${key} must be an exact pinned version`);
    }
    if (capture.viewport) {
      capture.viewport.width = dimension(capture.viewport.width, 'viewport width');
      capture.viewport.height = dimension(capture.viewport.height, 'viewport height');
    }
    if (capture.colorScheme && !['light','dark'].includes(capture.colorScheme)) throw new Error('Invalid capture colorScheme');
    if (capture.localStorage !== undefined && (!capture.localStorage || typeof capture.localStorage !== 'object' || Array.isArray(capture.localStorage) || Object.values(capture.localStorage).some(value=>typeof value!=='string'))) throw new Error('localStorage must map keys to string values');
    if (capture.styles !== undefined && typeof capture.styles !== 'string') throw new Error('Capture styles must be a CSS string');
    if (capture.ready && ((capture.ready.selector && typeof capture.ready.selector !== 'string') || (capture.ready.expression && typeof capture.ready.expression !== 'string'))) throw new Error('Invalid ready condition');
    if (capture.actions !== undefined && !Array.isArray(capture.actions)) throw new Error('Actions must be an array');
    for (const action of capture.actions ?? []) {
      if (!['click','fill','scroll'].includes(action.type)) throw new Error(`Unknown action: ${action.type}`);
      if (['click','fill'].includes(action.type) && typeof action.selector !== 'string') throw new Error('Action requires selector');
      if (action.type === 'fill' && typeof action.value !== 'string') throw new Error('Fill action requires string value');
      if (action.type === 'scroll' && [action.x ?? 0, action.y ?? 0].some(v => !Number.isFinite(v))) throw new Error('Invalid scroll coordinates');
    }
  }
  const outputIds = new Set();
  for (const output of config.outputs) {
    if (!output || typeof output !== 'object') throw new Error('Output must be an object');
    validateArtDirection(output, 'output');
    if (output.showProduct !== undefined && typeof output.showProduct !== 'boolean') throw new Error('Output showProduct must be a boolean');
    if (output.imageFit !== undefined && !['crop','contain'].includes(output.imageFit)) throw new Error('Output imageFit must be crop or contain');
    if (output.theme !== undefined && !THEMES.includes(output.theme)) throw new Error('Output theme must be light or dark');
    if (output.frameHeight !== undefined && (typeof output.frameHeight !== 'number' || !Number.isFinite(output.frameHeight) || output.frameHeight < .1 || output.frameHeight > .7)) throw new Error('Output frameHeight must be a finite number between 0.1 and 0.7');
    if (output.subtitle !== undefined && typeof output.subtitle !== 'string') throw new Error('Output subtitle must be a string');
    if (output.backgroundStyle !== undefined && !BACKGROUNDS.includes(output.backgroundStyle)) throw new Error('Unknown output background style');
    if (!ID.test(output.id ?? '') || outputIds.has(output.id)) throw new Error(`Invalid or duplicate output id: ${output.id}`);
    outputIds.add(output.id);
    if (!TEMPLATES.includes(output.template)) throw new Error(`Invalid template for ${output.id}`);
    const themed = output.capturesByTheme !== undefined;
    if (themed) {
      const mapping = output.capturesByTheme;
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).length !== 2 || THEMES.some(theme => !Object.hasOwn(mapping,theme) || !Array.isArray(mapping[theme]) || (output.showProduct !== false && !mapping[theme].length) || mapping[theme].some(id => !captureIds.has(id)))) throw new Error(`Output ${output.id} capturesByTheme requires valid light and dark capture arrays`);
    }
    if ((output.captures !== undefined || !themed) && (!Array.isArray(output.captures) || (output.showProduct !== false && !themed && !output.captures.length) || output.captures.some(id => !captureIds.has(id)))) throw new Error(`Output ${output.id} references missing captures`);
    if (output.width !== undefined) output.width = dimension(output.width, 'output width');
    if (output.height !== undefined) output.height = dimension(output.height, 'output height');
  }
  for (const key of ['prepare','server']) if (config[key]) {
    if (typeof config[key].command !== 'string' || !config[key].command.trim()) throw new Error(`${key} requires command`);
    inside(root, config[key].cwd ?? '.', `${key}.cwd`);
    if (config[key].timeoutMs !== undefined && (!Number.isInteger(config[key].timeoutMs) || config[key].timeoutMs < 100 || config[key].timeoutMs > 600000)) throw new Error(`Invalid ${key} timeoutMs`);
  }
  if (config.server) {
    const url = validateUrl(config.server.url, 'server.url');
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Managed servers must use a loopback URL');
    if (config.server.timeoutMs !== undefined && (!Number.isInteger(config.server.timeoutMs) || config.server.timeoutMs < 100 || config.server.timeoutMs > 600000)) throw new Error('Invalid server timeoutMs');
  }
  const selected = options.only ? options.only.split(',') : [...outputIds];
  if (selected.some(id => !outputIds.has(id))) throw new Error(`Unknown output in --only: ${options.only}`);
  const outputs = config.outputs.filter(output => selected.includes(output.id)).map(output => {
    const theme = options.theme ?? output.theme ?? ((output.artDirection ?? config.project.artDirection ?? 'porcelain') === 'studio' ? 'dark' : 'light');
    const fadeStart = output.fadeStart ?? config.project.fadeStart ?? .67;
    const fadeEnd = output.fadeEnd ?? config.project.fadeEnd ?? 1;
    if (fadeStart >= fadeEnd) throw new Error(`Output ${output.id} effective fadeStart must precede fadeEnd`);
    return {...output,theme,captures:output.capturesByTheme ? [...output.capturesByTheme[theme]] : output.captures,template:options.template ?? output.template,width:options.width ?? output.width ?? 1600,height:options.height ?? output.height ?? 1000};
  });
  const scale = options.scale ?? 1;
  for (const output of outputs) if (output.width * output.height * scale * scale > 40000000) throw new Error('Output exceeds 40 megapixels');
  const required = new Set(outputs.filter(output => output.showProduct !== false).flatMap(output => output.captures));
  const captures = config.captures.filter(capture => required.has(capture.id));
  const outputDir = inside(root, options['output-dir'] ?? config.outputDir ?? 'docs/assets/product-captures', 'output directory');
  if (outputDir === root) throw new Error('Output directory must not be the configuration root');
  const baseUrl = options['base-url'] ?? config.server?.url;
  for (const capture of captures) if (capture.provider === 'web') {
    if (options['base-url']) {
      const original = new URL(capture.url, baseUrl);
      capture.resolvedUrl = new URL(original.pathname + original.search, baseUrl).href;
    } else capture.resolvedUrl = new URL(capture.url, baseUrl).href;
  }
  return {config,configPath,root,outputDir,outputs,captures,scale,theme:options.theme,captureMode:options['capture-mode'] ?? 'fresh',skipPrepare:Boolean(options['skip-prepare']),skipServer:Boolean(options['base-url']),dryRun:Boolean(options['dry-run']),configHash:createHash('sha256').update(text).digest('hex')};
}

/** Return a portable operation plan without including arbitrary commands or input secrets. */
export function describePlan(plan) {
  return {version:1,project:plan.config.project.id,dryRun:plan.dryRun,captureMode:plan.captureMode,outputDirectory:plan.outputDir,prepare:plan.captureMode==='fresh' && !plan.skipPrepare && Boolean(plan.config.prepare),server:plan.captureMode==='fresh' && !plan.skipServer && Boolean(plan.config.server) && plan.captures.some(capture=>capture.provider==='web'),captures:plan.captures.map(({id,provider})=>({id,provider})),outputs:plan.outputs.map(({id,template,width,height,theme})=>({id,template,width,height,theme,scale:plan.scale}))};
}

/** Validate a positive integer dimension within practical screenshot limits. */
function dimension(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 100 || number > 6000) throw new Error(`${label} must be an integer between 100 and 6000`);
  return number;
}
