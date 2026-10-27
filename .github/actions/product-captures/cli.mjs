#!/usr/bin/env node
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {spawnSync} from 'node:child_process';
import { parseOptions,loadPlan,describePlan,assertInsideReal } from './lib/config.mjs';

const HELP=`Portable product captures\n\nUsage: node cli.mjs [--config product-captures.json] [options]\n\n--dry-run                 Validate and print a plan; no writes, browser, or commands\n--list                    List configured outputs without running\n--only hero,feature        Select output IDs\n--template editorial|feature|showcase\n--theme light|dark         Override capture and composition theme\n--width 1600 --height 1000 Override output dimensions (100–6000)\n--scale 1                 Device scale factor (1–3)\n--base-url URL            Capture a running site; skip managed server startup\n--output-dir PATH         Config-root-relative output directory\n--skip-prepare            Skip the configured build command\n--capture-mode fresh|existing  Existing uses explicit fallback images\n--help --version\n`;

/** Record current source identity without requiring Git, a commit, or package metadata to exist. */
export async function sourceMetadata(root) {
  const revision=spawnSync('git',['-C',root,'rev-parse','--verify','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000});
  const candidate=revision.status===0?revision.stdout.trim():'';
  const commit=/^[a-f0-9]{40,64}$/i.test(candidate)?candidate:null;
  let version=null;
  for(const filename of ['package.json','manifest.json'])try{const value=JSON.parse(await fs.readFile(path.join(root,filename),'utf8')).version;if(typeof value==='string'&&value.length<=100&&!/[\r\n\0]/.test(value)){version=value;break;}}catch{}
  return {commit,version};
}

/** Run validated captures and compositions; dry run has no mutation boundary crossings. */
export async function run(args,cwd=process.cwd()) {
  const options=parseOptions(args);
  if(options.help){console.log(HELP);return;}
  if(options.version){console.log('1.0.0');return;}
  const plan=await loadPlan(options,cwd);
  if(options.list){console.log(plan.outputs.map(output=>output.id).join('\n'));return describePlan(plan);}
  if(plan.dryRun){console.log(JSON.stringify(describePlan(plan),null,2));return describePlan(plan);}
  const {chromium}=await import('playwright');
  const {runCommand,startServer}=await import('./lib/process.mjs');
  const {captureSource}=await import('./lib/capture.mjs');
  const {renderOutput}=await import('./lib/render.mjs');
  let server,browser,staging;
  let wasInterrupted=false,cleanupPromise;
  const cancellation=new AbortController();
  const cleanups=new Set();
  /** Register each owned resource before its next asynchronous operation. */
  function registerCleanup(callback){cleanups.add(callback);if(wasInterrupted)void Promise.resolve().then(callback).catch(()=>{});return()=>cleanups.delete(callback);}
  /** Drain owned resource cleanup before allowing normal promise unwinding to finish. */
  function cleanup(){
    if(cleanupPromise)return cleanupPromise;
    cleanupPromise=(async()=>{
      const callbacks=[...cleanups];cleanups.clear();
      const results=await Promise.allSettled(callbacks.map(callback=>Promise.resolve().then(callback)));
      try{await browser?.close();}finally{browser=undefined;try{await server?.stop();}finally{server=undefined;if(staging)await fs.rm(staging,{recursive:true,force:true});staging=undefined;}}
      const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    })();
    return cleanupPromise;
  }
  /** Abort resource work without bypassing adapter and command finally blocks. */
  const interrupted=()=>{wasInterrupted=true;process.exitCode=130;cancellation.abort(new Error('Capture interrupted'));void cleanup().catch(()=>{});};
  const checkInterrupted=()=>{if(wasInterrupted)throw cancellation.signal.reason;};
  process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
  try {
    await assertInsideReal(plan.root,plan.outputDir);
    checkInterrupted();
    if(!plan.skipPrepare && plan.config.prepare && plan.captureMode==='fresh')await runCommand(plan.config.prepare,plan.root,{registerCleanup});
    checkInterrupted();
    if(!plan.skipServer && plan.config.server && plan.captureMode==='fresh' && plan.captures.some(c=>c.provider==='web'))server=await startServer(plan.config.server,plan.root,{registerCleanup});
    checkInterrupted();
    await fs.mkdir(path.join(plan.outputDir,'captures'),{recursive:true});
    await assertInsideReal(plan.root,path.join(plan.outputDir,'captures'));
    for(const file of [...plan.outputs.map(output=>`${output.id}.png`),'manifest.json','gallery.html',...plan.captures.map(capture=>`captures/${capture.id}.png`)])await assertInsideReal(plan.root,path.join(plan.outputDir,file));
    staging=await fs.mkdtemp(path.join(plan.outputDir,'.run-'));
    await fs.mkdir(path.join(staging,'captures'));
    browser=await chromium.launch({headless:true});
    if(wasInterrupted){await browser.close();browser=undefined;checkInterrupted();}
    const captures=[];
    for(const capture of plan.captures){
      const destination=path.join(staging,'captures',`${capture.id}.png`);
      checkInterrupted();
      const metadata=await captureSource({capture,plan,browser,chromium,destination,registerCleanup,signal:cancellation.signal});
      captures.push({id:capture.id,path:destination,...metadata});
      console.log(`Captured ${capture.id} (${metadata.mode})`);
    }
    for(const output of plan.outputs){
      checkInterrupted();
      await renderOutput({browser,project:plan.config.project,output,captures:output.showProduct===false?[]:output.captures.map(id=>captures.find(c=>c.id===id)),theme:output.theme,scale:plan.scale,destination:path.join(staging,`${output.id}.png`)});
      console.log(`Rendered ${output.id}.png`);
    }
    checkInterrupted();
    const manifest={version:1,toolVersion:'1.0.0',project:plan.config.project.id,source:await sourceMetadata(plan.root),configHash:plan.configHash,captureMode:plan.captureMode,theme:plan.theme??'configured',scale:plan.scale,captures:captures.map(({path:filename,...capture})=>({...capture,file:`captures/${capture.id}.png`})),outputs:plan.outputs.map(({id,template,width,height,theme})=>({id,template,theme,file:`${id}.png`,width:width*plan.scale,height:height*plan.scale}))};
    await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    await fs.writeFile(path.join(staging,'gallery.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(plan.config.project.title)} captures</title><style>body{margin:32px;font:16px system-ui;color:#242424;background:#f7f7f5}main{max-width:1200px;margin:auto}img{width:100%;display:block}figure{margin:32px 0}figcaption{margin-top:12px}a{color:inherit}</style><main><h1>${escape(plan.config.project.title)}</h1><p>Capture mode: ${plan.captureMode}. See manifest.json for provenance.</p>${manifest.outputs.map(output=>`<figure><a href="${output.file}"><img src="${output.file}" alt="${escape(output.id)}"></a><figcaption>${escape(output.id)} · ${escape(output.template)} · ${escape(output.theme)}</figcaption></figure>`).join('')}</main></html>`);
    // Publish only after every requested capture and render succeeded; manifest is the final completion marker.
    checkInterrupted();
    for(const file of [...manifest.captures.map(capture=>capture.file),...manifest.outputs.map(output=>output.file),'gallery.html','manifest.json'])await fs.rename(path.join(staging,file),path.join(plan.outputDir,file));
    return manifest;
  } finally {try{await cleanup();}finally{process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);}}
}

if(process.argv[1] && realpathSync(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(error=>{console.error(`product-captures: ${error.message}`);if(!process.exitCode)process.exitCode=1;});
