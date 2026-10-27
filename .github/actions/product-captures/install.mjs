#!/usr/bin/env node
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertInsideReal,validateUrl} from './lib/config.mjs';

const sourceRoot=path.dirname(fileURLToPath(import.meta.url));
const valueFlags=new Set(['repo','id','title','url','server','prepare']);

/** Parse explicit bootstrap inputs; planning is the default and overwrites are unsupported. */
export function parseInstallOptions(args) {
  const options={};
  for(let index=0;index<args.length;index++) {
    const match=/^--([a-z-]+)(?:=(.*))?$/.exec(args[index]);
    if(!match)throw new Error(`Unexpected bootstrap argument: ${args[index]}`);
    const [,name,inline]=match;
    if(Object.hasOwn(options,name))throw new Error(`Repeated bootstrap option: --${name}`);
    if(['apply','dry-run','help'].includes(name)) {
      if(inline!==undefined)throw new Error(`--${name} takes no value`);
      options[name]=true;
    } else if(valueFlags.has(name)) {
      const value=inline??args[++index];
      if(!value||value.startsWith('--'))throw new Error(`Missing value for --${name}`);
      options[name]=value;
    } else throw new Error(`Unknown bootstrap option: --${name}`);
  }
  if(options.help)return options;
  if(options.apply&&options['dry-run'])throw new Error('Choose --apply or --dry-run, not both');
  for(const key of ['repo','id','title','url'])if(!options[key])throw new Error(`Bootstrap requires --${key}`);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.id))throw new Error('Project id must use lowercase words separated by hyphens');
  if(!options.title.trim()||options.title.length>300)throw new Error('Project title must contain 1–300 characters');
  const url=validateUrl(options.url,'capture URL');
  if(options.server&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('--server requires a loopback --url');
  return options;
}

/** Create a validated web scene from literal caller inputs, without running supplied commands. */
export function createExampleConfig(options) {
  const config={
    version:1,
    project:{id:options.id,title:options.title,subtitle:'',backgroundStyle:'solid',artDirection:'porcelain',layout:'site-top',siteBackdrop:true,siteTint:'#e1e8e5',edgeBleed:.06,accent:'#718d77',background:'#f3f3ef'},
    outputDir:'docs/assets/product-captures',
    captures:['light','dark'].map(theme=>({id:`overview-${theme}`,provider:'web',url:options.url,viewport:{width:1440,height:900},colorScheme:theme,ready:{selector:'body'}})),
    outputs:[['hero','showcase'],['feature','feature'],['showcase','showcase']].flatMap(([id,template])=>['light','dark'].map(theme=>({id:`${id}${theme==='dark'?'-dark':''}`,template,theme,captures:[`overview-${theme}`],capturesByTheme:{light:['overview-light'],dark:['overview-dark']},width:1600,height:1000}))),
  };
  if(options.prepare)config.prepare={command:options.prepare,cwd:'.'};
  if(options.server)config.server={command:options.server,cwd:'.',url:options.url,timeoutMs:120000};
  return config;
}

/** Supply release and manual entry points while passing manual inputs as data to the composite action. */
export function exampleWorkflow() {
  return `name: Product captures

# Releases created with GITHUB_TOKEN do not trigger release workflows.
# In that case, also invoke the local action inside the existing release workflow.
on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      dry_run:
        description: Validate without installing, building, capturing, or publishing.
        type: boolean
        default: true
      capture_mode:
        description: Fresh product capture or explicit configured image inputs.
        type: choice
        options: [fresh, existing]
        default: fresh
      only:
        description: Comma-separated output IDs; empty renders all.
        type: string
        default: ''
      template:
        description: Optional editorial, feature, or showcase override.
        type: string
        default: ''
      theme:
        description: Optional light or dark override.
        type: string
        default: ''
      width:
        description: Optional output width.
        type: string
        default: ''
      height:
        description: Optional output height.
        type: string
        default: ''
      base_url:
        description: Optional running preview origin; skips the configured product build.
        type: string
        default: ''
      release_tag:
        description: Optional existing release to capture and attach artwork to.
        type: string
        default: ''
      update_pr:
        description: Open a review-only image update PR; never merges.
        type: boolean
        default: false

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: product-captures-\${{ github.event.release.tag_name || inputs.release_tag || github.ref }}
  cancel-in-progress: false

jobs:
  captures:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    steps:
      - name: Check out the capture source
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.release.tag_name || inputs.release_tag || github.sha }}
          persist-credentials: false
      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Generate product artwork
        uses: ./.github/actions/product-captures
        with:
          dry-run: \${{ github.event_name == 'workflow_dispatch' && inputs.dry_run && 'true' || 'false' }}
          capture-mode: \${{ inputs.capture_mode || 'fresh' }}
          only: \${{ inputs.only }}
          template: \${{ inputs.template }}
          theme: \${{ inputs.theme }}
          width: \${{ inputs.width }}
          height: \${{ inputs.height }}
          base-url: \${{ inputs.base_url }}
          skip-prepare: \${{ inputs.base_url != '' && 'true' || 'false' }}
          release-tag: \${{ github.event.release.tag_name || inputs.release_tag }}
          update-pr: \${{ (github.event_name == 'release' || inputs.update_pr) && 'true' || 'false' }}
`;
}

/** Gather shipped files only; dependencies, generated artifacts, and destination repositories are never scanned. */
async function shippedFiles() {
  const required=['cli.mjs','package.json','package-lock.json','action.yml','workflow.mjs','serve.mjs','install.mjs','example.product-captures.json','lib','assets','test'];
  const optional=['README.md','LICENSE','.gitignore'];
  const files=[];
  /** Recursively collect a declared source directory without following symlinks. */
  async function collect(relative) {
    const filename=path.join(sourceRoot,relative);
    const stats=await fs.lstat(filename);
    if(stats.isSymbolicLink())throw new Error(`Refusing to vendor a source symlink: ${relative}`);
    if(stats.isDirectory())for(const entry of (await fs.readdir(filename)).sort())await collect(path.join(relative,entry));
    else if(stats.isFile())files.push({relative,content:await fs.readFile(filename),mode:stats.mode&0o777});
    else throw new Error(`Unsupported shipped source: ${relative}`);
  }
  for(const entry of required)await collect(entry);
  for(const entry of optional)try{await fs.lstat(path.join(sourceRoot,entry));await collect(entry);}catch(error){if(error.code!=='ENOENT')throw error;}
  return files;
}

/** Preflight every destination, then optionally create a self-contained action and root configuration. */
export async function installToolkit(args,cwd=process.cwd()) {
  const options=parseInstallOptions(args);
  if(options.help)return {help:'Usage: node install.mjs --repo PATH --id my-project --title "My project" --url URL [--server COMMAND] [--prepare COMMAND] [--dry-run | --apply]\nDefault: dry-run. Existing action, config, and workflow paths are never overwritten.'};
  const repo=await fs.realpath(path.resolve(cwd,options.repo));
  if(!(await fs.stat(repo)).isDirectory())throw new Error('--repo must be an existing directory');
  const action='.github/actions/product-captures';
  const config='product-captures.json';
  const workflow='.github/workflows/product-captures.yml';
  const existing=[];
  for(const relative of [action,config,workflow]) {
    const destination=path.join(repo,relative);
    await assertInsideReal(repo,destination,'bootstrap destination');
    try{await fs.lstat(destination);existing.push(relative);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(existing.length)throw new Error(`Refusing to overwrite existing paths: ${existing.join(', ')}. Update that installation explicitly instead.`);
  const sources=await shippedFiles();
  const writes=sources.map(file=>({...file,relative:path.join(action,file.relative)}));
  writes.push({relative:config,content:Buffer.from(JSON.stringify(createExampleConfig(options),null,2)+'\n'),mode:0o644});
  writes.push({relative:workflow,content:Buffer.from(exampleWorkflow()),mode:0o644});
  const plan={version:1,dryRun:!options.apply,repo,project:options.id,files:writes.map(file=>file.relative.split(path.sep).join('/'))};
  if(!options.apply)return plan;
  const createdFiles=[];
  const createdDirectories=[];
  /** Create only missing directory components and record each for bounded rollback. */
  async function directory(absolute) {
    if(absolute===repo)return;
    await directory(path.dirname(absolute));
    try{await fs.mkdir(absolute);createdDirectories.push(absolute);}catch(error){if(error.code!=='EEXIST')throw error;if(!(await fs.stat(absolute)).isDirectory())throw new Error(`Destination ancestor is not a directory: ${absolute}`);}
    await assertInsideReal(repo,absolute,'bootstrap directory');
  }
  try {
    for(const file of writes) {
      const destination=path.join(repo,file.relative);
      await directory(path.dirname(destination));
      await fs.writeFile(destination,file.content,{flag:'wx',mode:file.mode});
      createdFiles.push({...file,destination});
    }
    return plan;
  } catch(error) {
    // Roll back only bytes written by this invocation; preserve anything changed concurrently.
    for(const file of createdFiles.reverse())try{if((await fs.readFile(file.destination)).equals(file.content))await fs.unlink(file.destination);}catch{}
    for(const dir of createdDirectories.reverse())try{await fs.rmdir(dir);}catch{}
    throw error;
  }
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))installToolkit(process.argv.slice(2)).then(result=>console.log(result.help??JSON.stringify(result,null,2))).catch(error=>{console.error(`product-captures bootstrap: ${error.message}`);process.exitCode=1;});
