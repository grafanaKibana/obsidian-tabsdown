import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {parseOptions,loadPlan,describePlan,inside,assertInsideReal} from '../lib/config.mjs';
import {captureSource} from '../lib/capture.mjs';
import {runCommand,startServer} from '../lib/process.mjs';
import net from 'node:net';
import {sourceMetadata} from '../cli.mjs';

const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));

/** Create a standalone config fixture and remove only its test-owned directory. */
async function fixture(t,mutate=()=>{}) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'product-captures-test-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const config={version:1,project:{id:'sample',title:'Sample'},outputDir:'media',prepare:{command:'node -e "require(\'fs\').writeFileSync(\'side-effect\',\'bad\')"'},server:{url:'http://127.0.0.1:39999',command:'invalid-unreachable-server-command'},captures:[{id:'home',provider:'web',url:'/',fallback:'not-built.png'}],outputs:[{id:'hero',template:'editorial',captures:['home']},{id:'detail',template:'feature',captures:['home']}]};
  mutate(config);
  await fs.writeFile(path.join(root,'product-captures.json'),JSON.stringify(config));
  return root;
}

/** Supply explicit paired outputs and distinct saved inputs without needing built screenshot files. */
function themedScenes(config) {
  config.captures=[{id:'scene-light',provider:'web',url:'/',colorScheme:'light',fallback:'saved/light.png'},{id:'scene-dark',provider:'web',url:'/',colorScheme:'dark',fallback:'saved/dark.png'}];
  const mapping={light:['scene-light'],dark:['scene-dark']};
  config.outputs=[{id:'hero',template:'showcase',theme:'light',capturesByTheme:mapping},{id:'hero-dark',template:'showcase',theme:'dark',capturesByTheme:mapping}];
}

test('dry run validates and plans without prepare, server, browser or writes',async t=>{
  const root=await fixture(t);
  const before=await fs.readdir(root);
  const {stdout,stderr}=await exec(process.execPath,[cli,'--dry-run','--capture-mode','existing'],{cwd:root,timeout:5000});
  const plan=JSON.parse(stdout);
  assert.equal(plan.dryRun,true);
  assert.equal(plan.captureMode,'existing');
  assert.equal(plan.prepare,false);
  assert.equal(plan.server,false);
  assert.equal(plan.outputDirectory,path.join(root,'media'));
  assert.equal(stderr,'');
  assert.deepEqual(await fs.readdir(root),before);
});

test('list has no build/source requirements or writes',async t=>{
  const root=await fixture(t);
  const {stdout}=await exec(process.execPath,[cli,'--list'],{cwd:root,timeout:5000});
  assert.equal(stdout,'hero\ndetail\n');
  assert.deepEqual(await fs.readdir(root),['product-captures.json']);
});

test('identity-only outputs require no capture sources or app launch',async t=>{
  const root=await fixture(t,config=>{
    config.captures=[];
    config.outputs=[{id:'hero',template:'showcase',layout:'column',showProduct:false,captures:[]}];
    delete config.prepare;delete config.server;
  });
  const plan=await loadPlan({},root);
  assert.deepEqual(plan.captures,[]);
  const {stdout}=await exec(process.execPath,[cli,'--dry-run'],{cwd:root});
  const description=JSON.parse(stdout);
  assert.equal(description.prepare,false);
  assert.equal(description.server,false);
  assert.deepEqual(description.captures,[]);
  await fs.writeFile(path.join(root,'product-captures.json'),JSON.stringify({...plan.config,outputs:[{...plan.config.outputs[0],showProduct:true}]}));
  await assert.rejects(loadPlan({},root),/references missing captures/);
});

test('manual options select outputs and apply dimensions, theme and origin',async t=>{
  const root=await fixture(t,config=>{config.captures[0].url='https://example.com/notes?view=wide';});
  const options=parseOptions(['--only','detail','--template=showcase','--width','1200','--height','630','--scale','2','--theme','dark','--base-url','http://127.0.0.1:4567']);
  const plan=await loadPlan(options,root);
  assert.equal(plan.outputs.length,1);
  assert.equal(plan.outputs[0].id,'detail');
  assert.equal(plan.outputs[0].template,'showcase');
  assert.equal(plan.outputs[0].width,1200);
  assert.equal(plan.outputs[0].height,630);
  assert.equal(plan.theme,'dark');
  assert.equal(plan.scale,2);
  assert.equal(plan.skipServer,true);
  assert.equal(plan.captures[0].resolvedUrl,'http://127.0.0.1:4567/notes?view=wide');
});

test('explicit output themes resolve their mapped inputs without expanding output IDs',async t=>{
  const root=await fixture(t,themedScenes);
  const plan=await loadPlan({},root);
  assert.deepEqual(plan.outputs.map(({id,theme,captures})=>({id,theme,captures})),[{id:'hero',theme:'light',captures:['scene-light']},{id:'hero-dark',theme:'dark',captures:['scene-dark']}]);
  assert.deepEqual(plan.captures.map(capture=>capture.id),['scene-light','scene-dark']);
  assert.deepEqual(describePlan(plan).outputs.map(output=>output.theme),['light','dark']);
  const defaults=await fixture(t,c=>{c.project.artDirection='studio';c.outputs[1].artDirection='porcelain';});
  assert.deepEqual((await loadPlan({},defaults)).outputs.map(output=>output.theme),['dark','light']);
});

test('CLI theme override selects the matching saved source in existing mode',async t=>{
  const root=await fixture(t,themedScenes),before=await fs.readdir(root);
  const options=parseOptions(['--only','hero','--theme','dark','--capture-mode','existing','--dry-run']);
  const plan=await loadPlan(options,root);
  assert.equal(plan.captureMode,'existing');assert.equal(plan.outputs[0].theme,'dark');
  assert.deepEqual(plan.outputs[0].captures,['scene-dark']);
  assert.deepEqual(plan.captures.map(({id,fallback})=>({id,fallback})),[{id:'scene-dark',fallback:'saved/dark.png'}]);
  const {stdout}=await exec(process.execPath,[cli,'--only','hero','--theme','dark','--capture-mode','existing','--dry-run'],{cwd:root});
  const description=JSON.parse(stdout);
  assert.deepEqual(description.captures,[{id:'scene-dark',provider:'web'}]);assert.equal(description.outputs[0].theme,'dark');
  assert.equal(description.prepare,false);assert.equal(description.server,false);assert.deepEqual(await fs.readdir(root),before);
});

test('theme mappings reject invalid shapes, missing themes, unknown capture IDs and unsafe source paths',async t=>{
  for(const mutate of [
    c=>{c.outputs[0].theme='system';},
    c=>{c.outputs[0].theme=null;},
    c=>{c.outputs[0].capturesByTheme=null;},
    c=>{c.outputs[0].capturesByTheme=[];},
    c=>{c.outputs[0].capturesByTheme={light:['scene-light']};},
    c=>{c.outputs[0].capturesByTheme={light:['scene-light'],dark:['scene-dark'],extra:[]};},
    c=>{c.outputs[0].capturesByTheme={light:[],dark:['scene-dark']};},
    c=>{c.outputs[0].capturesByTheme={light:['scene-light'],dark:'scene-dark'};},
    c=>{c.outputs[0].capturesByTheme={light:['scene-light'],dark:['missing']};},
    c=>{c.outputs[0].capturesByTheme={light:['../secret.png'],dark:['scene-dark']};},
    c=>{c.outputs[0].captures=['unknown-even-when-mapped'];},
    c=>{c.captures[1].fallback='../secret.png';},
  ]){const root=await fixture(t,c=>{themedScenes(c);mutate(c);});await assert.rejects(loadPlan({},root));}
  const root=await fixture(t,c=>{c.captures=[];c.outputs=[{id:'hero',template:'showcase',showProduct:false,theme:'dark',capturesByTheme:{light:[],dark:[]}}];});
  const plan=await loadPlan({},root);assert.deepEqual(plan.captures,[]);assert.deepEqual(plan.outputs[0].captures,[]);assert.equal(plan.outputs[0].theme,'dark');
});

test('CLI dispatches each resolved theme to the renderer and records output provenance without an app',async t=>{
  const root=await fixture(t,c=>{c.captures=[];c.outputs=[{id:'hero',template:'showcase',showProduct:false,captures:[],theme:'light'},{id:'hero-dark',template:'showcase',showProduct:false,captures:[],theme:'dark'}];delete c.prepare;delete c.server;});
  const renderer=new URL('../lib/render.mjs',import.meta.url).href;
  const loader=path.join(root,'theme-renderer-loader.mjs');
  const browserSource='export const chromium={launch:async()=>({close:async()=>{}})};';
  const renderSource='import fs from "node:fs/promises";export async function renderOutput({theme,output,destination}){if(theme!==output.theme)throw new Error("Unresolved renderer theme");await fs.writeFile(destination,theme);}';
  await fs.writeFile(loader,`export async function resolve(specifier,context,next){if(specifier==='playwright')return{url:'mock:playwright',shortCircuit:true};return next(specifier,context);}export async function load(url,context,next){if(url==='mock:playwright')return{format:'module',source:${JSON.stringify(browserSource)},shortCircuit:true};if(url===${JSON.stringify(renderer)})return{format:'module',source:${JSON.stringify(renderSource)},shortCircuit:true};return next(url,context);}`);
  await exec(process.execPath,['--experimental-loader',loader,cli],{cwd:root,timeout:10000});
  const manifest=JSON.parse(await fs.readFile(path.join(root,'media/manifest.json'),'utf8'));
  assert.deepEqual(manifest.outputs.map(({id,theme})=>({id,theme})),[{id:'hero',theme:'light'},{id:'hero-dark',theme:'dark'}]);
  assert.equal(await fs.readFile(path.join(root,'media/hero.png'),'utf8'),'light');assert.equal(await fs.readFile(path.join(root,'media/hero-dark.png'),'utf8'),'dark');
  assert.deepEqual(manifest.captures,[]);
  const gallery=await fs.readFile(path.join(root,'media/gallery.html'),'utf8');assert.ok(gallery.includes('hero · showcase · light')&&gallery.includes('hero-dark · showcase · dark'));
  await exec(process.execPath,['--experimental-loader',loader,cli,'--theme','light','--capture-mode','existing','--output-dir','overridden'],{cwd:root,timeout:10000});
  const override=JSON.parse(await fs.readFile(path.join(root,'overridden/manifest.json'),'utf8'));
  assert.equal(override.captureMode,'existing');assert.ok(override.outputs.every(output=>output.theme==='light'));
  assert.equal(await fs.readFile(path.join(root,'overridden/hero-dark.png'),'utf8'),'light');
});

test('rejects typos, missing values, credentials, invalid bounds and repeated options',()=>{
  for(const args of [['--unknown'],['--width'],['--width','99'],['--height','10000'],['--scale','NaN'],['--scale','0'],['--theme','sepia'],['--capture-mode','fallback'],['--template','missing'],['--base-url','file:///tmp'],['--base-url','https://me:secret@example.com'],['--dry-run=false'],['--only','hero','--only','detail']])assert.throws(()=>parseOptions(args),undefined,JSON.stringify(args));
});

test('rejects traversal, unknown output dependencies and duplicate IDs',async t=>{
  for(const mutate of [
    c=>{c.outputDir='../escape';},
    c=>{c.outputDir='.';},
    c=>{c.captures[0].fallback='../secret.png';},
    c=>{c.prepare.cwd='../other';},
    c=>{c.outputs[0].id='../escape';},
    c=>{c.outputs[0].captures=['missing'];},
    c=>{c.captures.push({...c.captures[0]});},
    c=>{c.outputs.push({...c.outputs[0]});},
    c=>{c.server.url='https://example.com';},
    c=>{c.captures[0].localStorage={theme:22};},
    c=>{c.captures[0].styles={invalid:true};},
    c=>{c.captures[0]={id:'app',provider:'obsidian',obsidian:{vault:'demo',note:'Demo.md',appVersion:'latest',installerVersion:'1.12.7'}};c.outputs.forEach(output=>{output.captures=['app'];});},
  ]) {
    const root=await fixture(t,mutate);
    await assert.rejects(loadPlan({},root));
  }
  const root=await fixture(t);
  await assert.rejects(loadPlan({only:'absent'},root),/Unknown output/);
  assert.throws(()=>inside(root,'../elsewhere'),/inside/);
});

test('fresh web failure never loads configured fallback',async()=>{
  let closed=false;
  const browser={newContext:async()=>({close:async()=>{closed=true;},newPage:async()=>({setDefaultTimeout(){},goto:async()=>{throw new Error('fresh site failed');}})})};
  await assert.rejects(captureSource({capture:{id:'home',provider:'web',fallback:'would-be-stale.png',resolvedUrl:'http://127.0.0.1:1'},plan:{captureMode:'fresh',scale:1},browser,destination:'/unused'}),/fresh site failed/);
  assert.equal(closed,true);
});

test('existing capture without an explicit fallback fails before browser use',async()=>{
  await assert.rejects(captureSource({capture:{id:'home',provider:'web'},plan:{captureMode:'existing'},browser:{},destination:'/unused'}),/No explicit existing image/);
});

test('source image symlinks cannot read outside config root',async t=>{
  const root=await fixture(t);
  const outside=await fixture(t);
  await fs.writeFile(path.join(outside,'source.png'),'outside');
  await fs.symlink(outside,path.join(root,'escape'));
  await assert.rejects(captureSource({capture:{id:'file',provider:'image',path:'escape/source.png'},plan:{root,captureMode:'fresh'},browser:{},destination:'/unused'}),/symlink must stay inside/);
  await assert.rejects(assertInsideReal(root,'escape/new-output.png'),/symlink must stay inside/);
});

test('prepare commands complete promptly and bounded commands time out',async t=>{
  const root=await fixture(t);
  const start=Date.now();
  await runCommand({command:`"${process.execPath}" -e "process.exit(0)"`},root);
  assert.ok(Date.now()-start<4000);
  await assert.rejects(runCommand({command:`"${process.execPath}" -e "setInterval(()=>{},1000)"`,timeoutMs:100},root),/timed out/);
});

test('managed server refuses an occupied port without touching its listener',async t=>{
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  const root=await fixture(t);
  await assert.rejects(startServer({url:`http://127.0.0.1:${port}`,command:'invalid-unreachable-server-command'},root),/already in use/);
  assert.equal(server.listening,true);
});

test('source provenance tolerates an uncommitted repository and reads the product version',async t=>{
  const root=await fixture(t);
  await exec('git',['init','--quiet'],{cwd:root});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'2.3.4'}));
  assert.deepEqual(await sourceMetadata(root),{commit:null,version:'2.3.4'});
});

test('SIGTERM during preparation drains the owned child process before CLI exit', {timeout:10000},async t=>{
  const root=await fixture(t,config=>{config.prepare={command:`"${process.execPath}" prepare.mjs`};});
  await fs.writeFile(path.join(root,'prepare.mjs'),`import fs from 'node:fs';fs.writeFileSync('prepare-started',String(process.pid));process.on('SIGTERM',()=>{fs.writeFileSync('prepare-stopped','clean');process.exit(0);});setInterval(()=>{},1000);`);
  const child=spawn(process.execPath,[cli],{cwd:root,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
  const deadline=Date.now()+5000;
  for(;;){try{await fs.access(path.join(root,'prepare-started'));break;}catch{}if(Date.now()>deadline)throw new Error(`Preparation did not start: ${stderr}`);await pause(25);}
  const pid=Number(await fs.readFile(path.join(root,'prepare-started'),'utf8'));
  child.kill('SIGTERM');
  assert.deepEqual(await result,{code:130,signal:null});
  assert.equal(await fs.readFile(path.join(root,'prepare-stopped'),'utf8'),'clean');
  assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
  await assert.rejects(fs.stat(path.join(root,'media')),error=>error.code==='ENOENT');
});

test('background configuration rejects unknown styles and nonliteral palettes during planning',async t=>{
  for(const mutate of [
    c=>{c.project.backgroundStyle='unknown';},
    c=>{c.outputs[0].backgroundStyle='unknown';},
    c=>{c.project.palette=['red','#ddd','#fff'];},
    c=>{c.project.palette=['#12345','#ddd','#fff'];},
    c=>{c.project.palette=['#aaa','#bbb'];},
    c=>{c.project.subtitle={text:'invalid'};},
  ]) {
    const root=await fixture(t,mutate);
    await assert.rejects(loadPlan({},root));
  }
  const root=await fixture(t,c=>{c.project.backgroundStyle='ribbons';c.project.palette=['#abc','#123456','#aabbccdd'];c.outputs[0].backgroundStyle='solid';});
  const plan=await loadPlan({},root);
  assert.equal(plan.config.project.backgroundStyle,'ribbons');
  assert.equal(plan.outputs[0].backgroundStyle,'solid');
});

test('art direction, crop layout, zoom, image offset and photographic position validate before any work',async t=>{
  for(const mutate of [
    c=>{c.project.artDirection='confetti';},
    c=>{c.outputs[0].artDirection='landscape';},
    c=>{c.project.layout='tilted';},
    c=>{c.outputs[0].layout='perspective';},
    c=>{c.project.imageZoom=.59;},
    c=>{c.outputs[0].imageZoom=2.01;},
    c=>{c.project.imageZoom='1.2';},
    c=>{c.outputs[0].imageZoom=null;},
    c=>{c.project.imageOffsetX=-601;},
    c=>{c.outputs[0].imageOffsetX=601;},
    c=>{c.project.imageOffsetX='-180';},
    c=>{c.outputs[0].imageOffsetX=null;},
    c=>{c.outputs[0].frameHeight=.099;},
    c=>{c.outputs[0].frameHeight=.701;},
    c=>{c.outputs[0].frameHeight='0.6';},
    c=>{c.outputs[0].frameHeight=null;},
    c=>{c.project.backdropPosition='center; color:red';},
    c=>{c.project.studioTint='purple';},
    c=>{c.project.studioTint='#12345';},
    c=>{c.project.studioTint={color:'#684487'};},
  ]) {
    const root=await fixture(t,mutate);
    await assert.rejects(loadPlan({},root));
  }
  const root=await fixture(t,c=>{
    c.project.artDirection='porcelain';c.project.layout='side';c.project.imageZoom=.6;c.project.backdropPosition='right';c.project.imageOffsetX=-600;
    Object.assign(c.outputs[0],{artDirection:'studio',layout:'reverse',imageZoom:2,imageOffsetX:600,frameHeight:.7});
  });
  const plan=await loadPlan({},root);
  assert.equal(plan.config.project.artDirection,'porcelain');
  assert.equal(plan.config.project.layout,'side');
  assert.equal(plan.config.project.imageZoom,.6);
  assert.equal(plan.outputs[0].artDirection,'studio');
  assert.equal(plan.outputs[0].layout,'reverse');
  assert.equal(plan.outputs[0].imageZoom,2);
  assert.equal(plan.config.project.imageOffsetX,-600);
  assert.equal(plan.outputs[0].imageOffsetX,600);
  assert.equal(plan.outputs[0].frameHeight,.7);
});

test('explicit plugin and full-viewport desktop layouts validate in no-write plans',async t=>{
  for(const layout of ['column','horizontal','desktop-side','desktop-centered','site-top']){
    const root=await fixture(t,c=>{c.project.layout=layout;c.project.studioTint='#684487';c.outputs[0].layout=layout;});
    const before=await fs.readdir(root);
    const plan=await loadPlan({'dry-run':true},root);
    assert.equal(plan.dryRun,true);assert.equal(plan.config.project.layout,layout);assert.equal(plan.outputs[0].layout,layout);
    assert.deepEqual(await fs.readdir(root),before);
  }
});

test('site photography, coherent studio colors and edge bleed are validated during planning',async t=>{
  for(const mutate of [
    c=>{c.project.studioShade='blue';},
    c=>{c.project.studioGlow='#12345';},
    c=>{c.project.siteBackdrop='true';},
    c=>{c.project.siteBackdrop=null;},
    c=>{c.project.siteTint='url(image.png)';},
    c=>{c.project.edgeBleed=-.001;},
    c=>{c.outputs[0].edgeBleed=.151;},
    c=>{c.outputs[0].edgeBleed='0.06';},
    c=>{c.project.edgeBleed=null;},
  ]){const root=await fixture(t,mutate);await assert.rejects(loadPlan({},root));}
  const root=await fixture(t,c=>{Object.assign(c.project,{layout:'site-top',siteBackdrop:true,siteTint:'#e3edf4',studioShade:'#243d66',studioGlow:'#abc9ec',edgeBleed:0});c.outputs[0].edgeBleed=.15;});
  const plan=await loadPlan({'dry-run':true},root);
  assert.equal(plan.config.project.edgeBleed,0);assert.equal(plan.outputs[0].edgeBleed,.15);assert.equal(plan.config.project.siteBackdrop,true);
});

test('fade and blur fractions validate types, bounds and effective project/output ordering',async t=>{
  for(const mutate of [
    c=>{c.project.fadeStart=-.01;},
    c=>{c.outputs[0].fadeEnd=1.01;},
    c=>{c.project.blurStart='0.38';},
    c=>{c.outputs[0].fadeStart=null;},
    c=>{c.project.blurStart=1.01;},
    c=>{c.project.fadeStart=.8;c.project.fadeEnd=.7;},
    c=>{c.outputs[0].fadeStart=.5;c.outputs[0].fadeEnd=.5;},
    c=>{c.project.fadeStart=.8;c.outputs[0].fadeEnd=.7;},
  ]){const root=await fixture(t,mutate);await assert.rejects(loadPlan({},root));}
  const root=await fixture(t,c=>{Object.assign(c.project,{fadeStart:.4,fadeEnd:.9,blurStart:.38});Object.assign(c.outputs[0],{fadeStart:0,fadeEnd:1,blurStart:1});});
  const plan=await loadPlan({},root);assert.equal(plan.config.project.fadeStart,.4);assert.equal(plan.outputs[0].fadeStart,0);assert.equal(plan.outputs[0].blurStart,1);
  const merged=await fixture(t,c=>{c.project.fadeEnd=.4;c.outputs.forEach(output=>{output.fadeStart=.1;});});
  await loadPlan({},merged);
});
