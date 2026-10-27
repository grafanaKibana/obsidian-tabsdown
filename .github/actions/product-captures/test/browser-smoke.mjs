import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
const serverScript=fileURLToPath(new URL('./fixture-server.mjs',import.meta.url));

/** Claim a free loopback port for a test-owned server invocation. */
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

/** Hash a generated artifact to prove failed refreshes preserve the previous complete output. */
async function hash(filename){return createHash('sha256').update(await fs.readFile(filename)).digest('hex');}

test('viewport capture ignores undecodable offscreen lazy images, exports all templates and cleans up after failure',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'product-capture-browser-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const port=await freePort();
  const config={version:1,project:{id:'fixture',title:'Fixture',subtitle:'A real browser scene'},outputDir:'media',server:{url:`http://127.0.0.1:${port}`,command:`"${process.execPath}" "${serverScript}" ${port}`,timeoutMs:10000},captures:[{id:'scene',provider:'web',url:'/',viewport:{width:640,height:480},localStorage:{theme:'$theme'},styles:'button { outline: 2px solid green; }',actions:[{type:'fill',selector:'input',value:'reproducible'},{type:'click',selector:'button'}],ready:{selector:'#ready',expression:'document.querySelector("h1").textContent === "Updated scene" && localStorage.getItem("theme") === "light" && [...document.images].every(image => !image.complete)'}}],outputs:['editorial','feature','showcase'].map(template=>({id:template,template,captures:['scene'],width:800,height:500}))};
  const filename=path.join(root,'product-captures.json');
  await fs.writeFile(filename,JSON.stringify(config));
  await exec(process.execPath,[cli],{cwd:root,timeout:40000});
  const manifest=JSON.parse(await fs.readFile(path.join(root,'media/manifest.json'),'utf8'));
  assert.equal(manifest.captures[0].mode,'fresh');
  assert.equal(manifest.captures[0].width,640);
  assert.equal(manifest.outputs.length,3);
  for(const output of manifest.outputs){const bytes=await fs.readFile(path.join(root,'media',output.file));assert.equal(bytes.readUInt32BE(16),800);assert.equal(bytes.readUInt32BE(20),500);}
  const prior=await hash(path.join(root,'media/manifest.json'));
  const priorImage=await hash(path.join(root,'media/editorial.png'));
  config.captures[0].fallback='media/captures/scene.png';
  config.prepare={command:'must-not-run-in-existing-mode'};
  await fs.writeFile(filename,JSON.stringify(config));
  await exec(process.execPath,[cli,'--capture-mode','existing','--only','editorial','--output-dir','existing','--theme','dark'],{cwd:root,timeout:40000});
  const existing=JSON.parse(await fs.readFile(path.join(root,'existing/manifest.json'),'utf8'));
  assert.equal(existing.captureMode,'existing');
  assert.equal(existing.captures[0].mode,'existing');
  assert.equal(existing.outputs.length,1);
  assert.equal(existing.theme,'dark');
  delete config.prepare;
  config.outputs[0].title='A changed request';
  config.captures.push({id:'missing',provider:'image',path:'missing.png'});
  config.outputs.push({id:'bad',template:'editorial',captures:['missing']});
  await fs.writeFile(filename,JSON.stringify(config));
  await assert.rejects(exec(process.execPath,[cli],{cwd:root,timeout:40000}),/missing\.png/);
  assert.equal(await hash(path.join(root,'media/manifest.json')),prior);
  assert.equal(await hash(path.join(root,'media/editorial.png')),priorImage);
  assert.equal((await fs.readdir(path.join(root,'media'))).some(name=>name.startsWith('.run-')),false);
  // The second run reuses the same port; success reaching the missing-image error proves the first server was stopped.
  const listener=net.createServer();await new Promise((resolve,reject)=>listener.once('error',reject).listen(port,'127.0.0.1',resolve));await new Promise(resolve=>listener.close(resolve));
});

test('art-directed crops preserve authentic pixels, minimal copy, and upright geometry across layouts',async()=>{
  const {chromium}=await import('playwright');
  const {renderTemplate}=await import('../lib/templates.mjs');
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    const source='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#fff"/><rect x="40" y="80" width="700" height="240" fill="#7359c4"/></svg>').toString('base64');
    const capture={id:'sample',src:source,width:1440,height:1000};
    for(const artDirection of ['porcelain','studio'])for(const layout of ['side','wide','reverse'])for(const template of ['editorial','feature','showcase'])for(const [width,height] of [[1600,800],[1600,1000],[1200,630]]) {
      const subtitle=artDirection==='porcelain'&&layout==='wide'&&template==='showcase'?'':'for Obsidian';
      const project={title:'Quartz Tabsdown',subtitle,artDirection,layout,backgroundStyle:'ribbons'};
      const output={template,width,height,title:'Obsolete marketing pitch',subtitle:'Do not print this',caption:'Unwanted footer',captureLabels:['Unwanted label'],backgroundStyle:'blocks'};
      await page.setViewportSize({width,height});
      await page.setContent(await renderTemplate({project,output,captures:[capture,capture]}));
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
      assert.equal((await page.locator('body').innerText()).replace(/\s+/g,' ').trim(),`Quartz Tabsdown${subtitle?' FOR':''}`);
      assert.equal(await page.locator('.obsidian-brand[alt="Obsidian"]').count(),subtitle?1:0);
      assert.equal(await page.locator('.atmosphere').count(),artDirection==='studio'?1:0);
      assert.equal(await page.locator('.backdrop, svg').count(),0);
      assert.equal(await page.locator('.canvas').getAttribute('data-theme'),artDirection==='studio'?'dark':'light');
      assert.equal(await page.locator('.window').count(),template==='feature'?2:1);
      const results=await page.locator('.window').evaluateAll(elements=>elements.map(element=>{
        const rect=element.getBoundingClientRect(),image=element.querySelector('img'),imageRect=image.getBoundingClientRect();
        const geometry=[];for(let node=image;node&&node!==document.body;node=node.parentElement)geometry.push({transform:getComputedStyle(node).transform,perspective:getComputedStyle(node).perspective});
        return {geometry,ratio:imageRect.width/imageRect.height,naturalRatio:image.naturalWidth/image.naturalHeight,cropped:imageRect.height>rect.height+1||imageRect.width>rect.width+1||rect.left<0||rect.right>innerWidth};
      }));
      for(const result of results){
        assert.ok(result.geometry.every(style=>style.transform==='none'&&style.perspective==='none'));
        assert.ok(Math.abs(result.ratio-result.naturalRatio)<.001);
        assert.ok(result.cropped,`${artDirection}/${layout}/${template} should choose a crop, not contain the full screenshot`);
      }
      const bounds=await page.locator('h1').boundingBox();
      assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
      if(subtitle){const platform=await page.locator('.platform').boundingBox();assert.ok(platform.y>=bounds.y+bounds.height||platform.x>=bounds.x+bounds.width,`${artDirection}/${layout}/${template} copy overlaps`);}
    }
    for(const [artDirection,theme] of [['porcelain','dark'],['studio','light']]){
      await page.setContent(await renderTemplate({project:{title:'Tabsdown',artDirection},output:{template:'showcase',width:1200,height:630},captures:[capture],theme}));
      assert.equal(await page.locator('.canvas').getAttribute('data-theme'),theme);
    }
    await page.setContent(await renderTemplate({project:{title:'Tabsdown',artDirection:'porcelain',layout:'side'},output:{template:'showcase',artDirection:'studio',layout:'wide',imageZoom:1.2,width:1200,height:630},captures:[capture]}));
    assert.equal(await page.locator('.canvas').getAttribute('data-art-direction'),'studio');
    assert.ok((await page.locator('.canvas').getAttribute('class')).includes('wide'));
    assert.equal(await page.locator('.canvas').evaluate(element=>getComputedStyle(element).getPropertyValue('--zoom').trim()),'1.2');
  } finally {await browser.close();}
});

test('wide and comparison frames follow short source images without empty bands, and offsets remain upright',async()=>{
  const {chromium}=await import('playwright');
  const {renderTemplate}=await import('../lib/templates.mjs');
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    const source='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="500"><rect width="1440" height="500" fill="#48654c"/></svg>').toString('base64');
    const capture={id:'short',src:source,width:1440,height:500};
    for(const artDirection of ['porcelain','studio'])for(const template of ['showcase','feature'])for(const [width,height] of [[1600,800],[1600,1000],[1200,630]]){
      await page.setViewportSize({width,height});
      const project={title:'Portfolio',artDirection,layout:'wide'};
      const output={template,width,height,imageZoom:template==='feature'?2/3:1};
      await page.setContent(await renderTemplate({project,output,captures:[capture,capture]}));
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
      const frames=await page.locator('.window').evaluateAll(elements=>elements.map(element=>{
        const frame=element.getBoundingClientRect(),image=element.querySelector('img').getBoundingClientRect();
        return {frameTop:frame.top,frameBottom:frame.bottom,imageTop:image.top,imageBottom:image.bottom,ratio:image.width/image.height};
      }));
      for(const frame of frames){
        assert.ok(Math.abs(frame.frameTop-frame.imageTop)<1);
        assert.ok(Math.abs(frame.frameBottom-frame.imageBottom)<1,`${artDirection}/${template}/${width} leaves empty space under short image`);
        assert.ok(Math.abs(frame.ratio-1440/500)<.001);
      }
    }
    await page.setViewportSize({width:1600,height:800});
    await page.setContent(await renderTemplate({project:{title:'Quartz Tabsdown',artDirection:'studio',layout:'reverse',imageOffsetX:120},output:{template:'showcase',width:1600,height:800,imageOffsetX:-180},captures:[capture]}));
    const offset=await page.locator('.window img').evaluate(image=>({left:image.getBoundingClientRect().left,frameLeft:image.parentElement.getBoundingClientRect().left,transform:getComputedStyle(image).transform,perspective:getComputedStyle(image).perspective}));
    assert.equal(offset.left-offset.frameLeft,-180);
    assert.equal(offset.transform,'none');assert.equal(offset.perspective,'none');
    const tallSource='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#48654c"/></svg>').toString('base64');
    const frameHeight=388/630;
    await page.setViewportSize({width:1200,height:630});
    await page.setContent(await renderTemplate({project:{title:'Colsdown',layout:'wide'},output:{template:'showcase',width:1200,height:630,frameHeight},captures:[{id:'tall',src:tallSource,width:1440,height:1000}]}));
    await page.locator('.window img').evaluate(image=>image.decode());
    const crop=await page.locator('.window').evaluate(frame=>({height:frame.getBoundingClientRect().height,bottom:frame.getBoundingClientRect().bottom,imageHeight:frame.querySelector('img').getBoundingClientRect().height}));
    assert.ok(crop.height<=630*frameHeight+.1);
    assert.ok(Math.abs(crop.height-388)<.1);
    assert.ok(Math.abs(crop.bottom-539.2)<.1);
    assert.ok(crop.imageHeight>crop.height);
    for(const invalid of [.099,.701,Infinity,'0.6',null])await assert.rejects(renderTemplate({project:{title:'Colsdown'},output:{template:'showcase',frameHeight:invalid},captures:[capture]}),/frameHeight/);
  }finally{await browser.close();}
});

test('purple plugin columns align name and official platform lockup with the screenshot bounds',async()=>{
  const {chromium}=await import('playwright');
  const {renderTemplate}=await import('../lib/templates.mjs');
  const brand=await fs.readFile(new URL('../assets/obsidian-lockup-dark.svg',import.meta.url));
  const lightBrand=await fs.readFile(new URL('../assets/obsidian-lockup-light.svg',import.meta.url));
  const source='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><rect width="1440" height="1000" fill="#25212a"/><rect x="30" y="90" width="1380" height="350" fill="#705290"/></svg>').toString('base64');
  const capture={id:'plugin',src:source,width:1440,height:1000};
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    for(const layout of ['column','horizontal'])for(const [width,height] of [[1600,900],[1200,630]])for(const subtitle of ['for Obsidian','for Obsidian & Quartz']){
      await page.setViewportSize({width,height});
      const html=await renderTemplate({project:{title:'Quartz Tabsdown',subtitle,artDirection:'studio',layout,studioTint:'#684487'},output:{template:'showcase',width,height},captures:[capture]});
      await page.setContent(html);
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
      assert.ok(html.includes('color-mix(in srgb,#684487 63%,transparent)'));
      assert.equal(await page.locator('.canvas').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(37, 26, 53)');
      assert.equal(await page.locator('.obsidian-brand').getAttribute('src'),'data:image/svg+xml;base64,'+brand.toString('base64'));
      assert.equal(await page.locator('.window .obsidian-brand').count(),0);
      assert.equal(await page.locator('.window img').count(),1);
      assert.equal((await page.locator('body').innerText()).replace(/\s+/g,' ').trim(),`Quartz Tabsdown FOR${subtitle.includes('Quartz')?' & Quartz':''}`);
      const result=await page.evaluate(()=>{
        const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,center:r.left+r.width/2};};
        const image=document.querySelector('.window img'),logo=document.querySelector('.obsidian-brand');
        const geometry=[];for(let node=image;node&&node!==document.body;node=node.parentElement)geometry.push({transform:getComputedStyle(node).transform,perspective:getComputedStyle(node).perspective});
        const brandFilters=[];for(let node=logo;node&&node!==document.body;node=node.parentElement)brandFilters.push(getComputedStyle(node).filter);
        const label=document.querySelector('.for-label'),labelStyle=getComputedStyle(label),probe=document.createElement('i');probe.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';label.append(probe);
        const canvas=document.createElement('canvas');canvas.width=572;canvas.height=100;const context=canvas.getContext('2d');context.drawImage(logo,0,0,572,100);const pixels=context.getImageData(0,0,572,100).data;let minY=100,maxY=0;
        for(let y=0;y<100;y++)for(let x=0;x<572;x++){const at=(y*572+x)*4;if(pixels[at]>240&&pixels[at+1]>240&&pixels[at+2]>240&&pixels[at+3]>200){minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
        context.font=labelStyle.font;const metrics=context.measureText('FOR'),baseline=probe.getBoundingClientRect().top,brandRect=logo.getBoundingClientRect();probe.remove();
        const labelInkCenter=baseline-(metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2,wordmarkInkCenter=brandRect.top+(minY+maxY+1)/2/100*brandRect.height;
        return {name:box('h1'),platform:box('.platform'),identity:box('.identity'),frame:box('.window'),image:box('.window img'),brand:box('.obsidian-brand'),brandFilters,geometry,labelInkCenter,wordmarkInkCenter,photo:getComputedStyle(document.querySelector('.atmosphere')).backgroundImage.includes('data:image/png;base64,')};
      });
      assert.ok(result.photo);assert.ok(result.brandFilters.every(filter=>filter==='none'));
      assert.ok(Math.abs(result.brand.width/result.brand.height-143/25)<.001);
      assert.ok(Math.abs(result.labelInkCenter-result.wordmarkInkCenter)<.75,'FOR ink should align optically with the unchanged wordmark ink');
      assert.ok(result.geometry.every(style=>style.transform==='none'&&style.perspective==='none'));
      assert.ok(Math.abs(result.image.width/result.image.height-1.44)<.001);
      assert.ok(Math.abs(result.frame.left-result.image.left)<.05&&Math.abs(result.frame.right-result.image.right)<.05,'default plugin framing must preserve the source width');
      if(layout==='column'){
        assert.ok(Math.abs(result.name.top-result.frame.top)<.05);
        assert.ok(Math.abs(result.platform.bottom-result.frame.bottom)<.05);
        assert.ok(Math.abs(result.brand.bottom-result.frame.bottom)<.05);
        assert.ok(Math.abs(result.name.center-result.identity.center)<.05);
        assert.ok(Math.abs(result.platform.center-result.identity.center)<.05);
        assert.ok(result.name.bottom<result.platform.top);
      }else{
        assert.ok(Math.abs(result.frame.center-width/2)<.05);
        assert.ok(result.name.bottom<result.frame.top&&result.platform.bottom<result.frame.top);
      }
    }
    await page.setContent(await renderTemplate({project:{title:'Quartz Tabsdown',subtitle:'for Quartz',artDirection:'studio',layout:'column'},output:{template:'showcase',width:1600,height:900},captures:[capture]}));
    assert.equal(await page.locator('.obsidian-brand').count(),0);
    assert.equal((await page.locator('body').innerText()).replace(/\s+/g,' ').trim(),'Quartz Tabsdown FOR Quartz');
    await page.setContent(await renderTemplate({project:{title:'DevBook',subtitle:'Obsidian & Quartz',layout:'side'},output:{template:'showcase',width:1600,height:1000},captures:[capture]}));
    assert.equal(await page.locator('.obsidian-brand').getAttribute('src'),'data:image/svg+xml;base64,'+lightBrand.toString('base64'));
    assert.equal(await page.locator('.window').evaluate(element=>element.getBoundingClientRect().left),560);
    const blue=await renderTemplate({project:{title:'Quartz Tabsdown',subtitle:'for Quartz',artDirection:'studio',layout:'column',studioTint:'#466e9b',studioShade:'#243d66',studioGlow:'#abc9ec',darkBackground:'#18283e'},output:{template:'showcase',width:1600,height:900},captures:[capture]});
    assert.ok(blue.includes('color-mix(in srgb,#466e9b 63%,transparent),color-mix(in srgb,#243d66 67%,transparent)'));
    assert.ok(blue.includes('#abc9ec26')&&blue.includes('#18283e33'));
    for(const [width,height] of [[1600,900],[1200,630]]){
      await page.setViewportSize({width,height});
      await page.setContent(await renderTemplate({project:{title:'Quartz Tabsdown',subtitle:'for Quartz',artDirection:'studio',layout:'column'},output:{template:'showcase',width,height},captures:[capture]}));
      await page.evaluate(()=>document.fonts.ready);
      const alignment=await page.evaluate(()=>{
        const context=document.createElement('canvas').getContext('2d');
        const inkCenter=selector=>{const element=document.querySelector(selector),style=getComputedStyle(element),probe=document.createElement('i');probe.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';element.append(probe);context.font=style.font;const metrics=context.measureText(element.textContent),baseline=probe.getBoundingClientRect().top;probe.remove();return baseline-(metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2;};
        return {label:inkCenter('.for-label'),wordmark:inkCenter('.platform strong')};
      });
      assert.ok(Math.abs(alignment.label-alignment.wordmark)<.75,`plain FOR Quartz ink alignment: ${JSON.stringify({width,...alignment})}`);
    }
  }finally{await browser.close();}
});

test('site artwork uses optical material without a photographic asset and preserves natural-aspect edge bleed',async()=>{
  const {chromium}=await import('playwright');
  const {renderTemplate}=await import('../lib/templates.mjs');
  const plate=await fs.readFile(new URL('../assets/alpine-plate.png',import.meta.url));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    for(const sourceHeight of [900,1000])for(const [width,height] of [[1600,1100],[1200,900],[1200,630]])for(const theme of ['light','dark']){
      const src='data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${sourceHeight}"><rect width="1440" height="${sourceHeight}" fill="#829d88"/></svg>`).toString('base64');
      const capture={id:'site',src,width:1440,height:sourceHeight};
      const project={title:'Portfolio',artDirection:'porcelain',layout:'site-top',siteBackdrop:true,siteTint:'#e3edf4',edgeBleed:.1};
      const output={template:'showcase',width,height,edgeBleed:.06};
      const html=await renderTemplate({project,output,captures:[capture],theme});
      assert.equal(html.includes(plate.toString('base64')),false,'website artwork must not embed the studio photographic plate');
      await page.setViewportSize({width,height});await page.setContent(html);
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
      assert.equal((await page.locator('body').innerText()).trim(),'Portfolio');
      const result=await page.evaluate(()=>{
        const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const frame=document.querySelector('.window'),image=frame.querySelector('img'),softness=frame.querySelector('.softness'),surface=document.querySelector('.site-surface');
        const geometry=[];for(let node=image;node&&node!==document.body;node=node.parentElement)geometry.push({transform:getComputedStyle(node).transform,perspective:getComputedStyle(node).perspective,filter:getComputedStyle(node).filter});
        return {name:rect(document.querySelector('h1')),frame:rect(frame),image:rect(image),geometry,mask:getComputedStyle(frame).maskImage,blur:getComputedStyle(softness).backdropFilter,fit:frame.dataset.fit,surface:getComputedStyle(surface).backgroundImage,surfaceStyle:surface.getAttribute('style'),surfaceFilter:getComputedStyle(surface).filter};
      });
      assert.equal(result.fit,'bleed');assert.ok(result.name.bottom<result.frame.top);
      assert.ok(Math.abs(result.frame.top-height*.18)<.05&&Math.abs(result.frame.left-width*.055)<.05);
      const expectedWidth=Math.min(width*.97,((1+.06)*height-height*.18)*(1440/sourceHeight));
      assert.ok(Math.abs(result.image.width-expectedWidth)<.05);
      assert.ok(Math.abs(result.image.width/result.image.height-1440/sourceHeight)<.001);
      assert.ok(result.frame.right<=width*1.03+.05&&result.frame.bottom<=height*1.06+.05);
      assert.notEqual(result.mask,'none');assert.ok(result.blur.includes('blur('));
      assert.ok(!result.surface.includes('url(')&&result.surface.includes('conic-gradient(')&&result.surface.includes('linear-gradient('));
      assert.ok(result.surfaceStyle.includes('#e3edf4'));assert.equal(result.surfaceFilter,'none');
      assert.ok(result.geometry.every(style=>style.transform==='none'&&style.perspective==='none'&&style.filter==='none'));
      for(const invalid of [-.001,.151,Infinity,'0.06',null])await assert.rejects(renderTemplate({project:{title:'Site'},output:{template:'showcase',edgeBleed:invalid},captures:[capture]}),/edgeBleed/);
      if(width===1600&&sourceHeight===900)assert.ok(Math.abs(result.frame.bottom-height*1.06)<.05,'the site layout should use its approved bottom bleed when aspect permits');
    }
    const source='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"/>').toString('base64');
    const studio=await renderTemplate({project:{title:'Tabsdown',artDirection:'studio',layout:'column',siteBackdrop:true},output:{template:'showcase',width:1600,height:900},captures:[{src:source,width:1440,height:1000}]});
    await page.setContent(studio);
    assert.equal(await page.locator('.site-surface').count(),0);
    assert.ok((await page.locator('.atmosphere').getAttribute('style')).includes(`url(data:image/png;base64,${plate.toString('base64')})`),'plugin artwork must retain the exact fixed studio plate');
  }finally{await browser.close();}
});

test('desktop portfolio layouts contain the full viewport and retain the bottom fade and blur',async()=>{
  const {chromium}=await import('playwright');
  const {renderTemplate}=await import('../lib/templates.mjs');
  const source='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#eef4eb"/><rect x="20" y="20" width="1400" height="860" fill="#829d88"/></svg>').toString('base64');
  const capture={id:'desktop',src:source,width:1440,height:900};
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    for(const layout of ['desktop-side','desktop-centered'])for(const [width,height] of [[1600,1000],[1600,1200],[1200,900],[1200,630]])for(const template of ['showcase','feature']){
      await page.setViewportSize({width,height});
      await page.setContent(await renderTemplate({project:{title:'Portfolio v1',artDirection:'porcelain',layout,imageZoom:1.8,imageOffsetX:-180},output:{template,width,height},captures:[capture,capture]}));
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
      assert.equal((await page.locator('body').innerText()).replace(/\s+/g,' ').trim(),'Portfolio v1');
      const frames=await page.locator('.window').evaluateAll(elements=>elements.map(frame=>{
        const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,center:r.left+r.width/2};};
        const image=frame.querySelector('img'),softness=frame.querySelector('.softness');
        const geometry=[];for(let node=image;node&&node!==document.body;node=node.parentElement)geometry.push({transform:getComputedStyle(node).transform,perspective:getComputedStyle(node).perspective});
        return {frame:rect(frame),image:rect(image),fit:frame.dataset.fit,mask:getComputedStyle(frame).maskImage,blur:getComputedStyle(softness).backdropFilter,blurDisplay:getComputedStyle(softness).display,geometry};
      }));
      for(const result of frames){
        assert.equal(result.fit,'contain');
        assert.ok(result.geometry.every(style=>style.transform==='none'&&style.perspective==='none'));
        for(const edge of ['left','top','right','bottom'])assert.ok(Math.abs(result.frame[edge]-result.image[edge])<.05,`${layout}/${template}: full source ${edge} must coincide with frame`);
        assert.ok(Math.abs(result.image.width/result.image.height-1.6)<.001);
        assert.ok(result.frame.left>=0&&result.frame.top>=0&&result.frame.right<=width+.05&&result.frame.bottom<=height+.05);
        assert.notEqual(result.mask,'none');assert.ok(result.blur.includes('blur('));assert.notEqual(result.blurDisplay,'none');
      }
      if(template!=='feature'){
        const name=await page.locator('h1').boundingBox();
        if(layout==='desktop-side')assert.ok(Math.abs(name.y-frames[0].frame.top)<.05);
        else{assert.ok(name.y+name.height<frames[0].frame.top);assert.ok(Math.abs(frames[0].frame.center-width/2)<.05);assert.ok(Math.abs(name.x+name.width/2-width/2)<.05);}
      }
    }
  }finally{await browser.close();}
});

test('release posters stay complete and identity-only artwork exports without captures',async t=>{
  const {chromium}=await import('playwright');
  const {renderTemplate}=await import('../lib/templates.mjs');
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const src='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1448" height="1086"><rect width="1448" height="1086" fill="#f4f0e6"/></svg>').toString('base64');
    for(const layout of ['column','horizontal']){
      await page.setViewportSize({width:1600,height:900});
      await page.setContent(await renderTemplate({project:{title:'Tabsdown',subtitle:'for Obsidian',layout,artDirection:'studio'},output:{template:'showcase',width:1600,height:900,imageFit:'contain'},captures:[{src,width:1448,height:1086}]}));
      const result=await page.locator('.window').evaluate(frame=>{const image=frame.querySelector('.product-capture');const a=frame.getBoundingClientRect(),b=image.getBoundingClientRect();return{a:{x:a.x,y:a.y,width:a.width,height:a.height},b:{x:b.x,y:b.y,width:b.width,height:b.height},fit:frame.dataset.fit};});
      assert.equal(result.fit,'contain');
      for(const key of ['x','y','width','height'])assert.ok(Math.abs(result.a[key]-result.b[key])<.05);
    }
    await page.setContent(await renderTemplate({project:{title:'Flowmaid',subtitle:'for Obsidian',layout:'column',artDirection:'studio'},output:{template:'showcase',width:1600,height:900,showProduct:false},captures:[]}));
    assert.equal(await page.locator('.window,.product-capture').count(),0);
    assert.equal(await page.locator('.obsidian-brand').count(),1);
    for(const selector of ['h1','.platform']){const bounds=await page.locator(selector).boundingBox();assert.ok(Math.abs(bounds.x+bounds.width/2-800)<.05,'identity-only column text and platform must share the canvas horizontal center');}
    await page.setContent(await renderTemplate({project:{title:'Flowmaid',subtitle:'for Obsidian',layout:'horizontal',artDirection:'studio'},output:{template:'showcase',width:1600,height:900,showProduct:false},captures:[]}));
    const name=await page.locator('h1').boundingBox(),platform=await page.locator('.platform').boundingBox();
    assert.ok(Math.abs(name.x+name.width/2-800)<.05&&Math.abs(platform.x+platform.width/2-800)<.05);
    assert.ok(platform.y>=name.y+name.height,'centered horizontal identity needs separate vertical rows');
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'product-identity-browser-')));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    await fs.writeFile(path.join(root,'product-captures.json'),JSON.stringify({version:1,project:{id:'identity',title:'Flowmaid',layout:'column',artDirection:'studio'},captures:[],outputs:[{id:'hero',template:'showcase',width:1600,height:900,showProduct:false,captures:[]}]}));
    await exec(process.execPath,[cli],{cwd:root,timeout:15000});
    const manifest=JSON.parse(await fs.readFile(path.join(root,'docs/assets/product-captures/manifest.json'),'utf8'));
    assert.deepEqual(manifest.captures,[]);assert.equal(manifest.outputs.length,1);
  }finally{await browser.close();}
});

test('configured themes select official lockups and longer fades finish before the frame edge',async()=>{
  const {chromium}=await import('playwright');
  const {renderTemplate}=await import('../lib/templates.mjs');
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const src='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#2255dd"/></svg>').toString('base64');
    const capture={src,width:1440,height:900};
    const expected=await fs.readFile(new URL('../assets/obsidian-lockup-dark.svg',import.meta.url));
    for(const studio of [{studioTint:'#6c4b91'},{studioTint:'#76558d'},{studioTint:'#634782'},{studioTint:'#466e9b',studioShade:'#243d66',darkBackground:'#18283e'}]){
      const grounds=[];
      for(const theme of ['light','dark']){
        const html=await renderTemplate({project:{title:'Tabsdown',subtitle:'for Obsidian',artDirection:'studio',layout:'column',...studio},output:{template:'showcase',width:1600,height:900,theme},captures:[capture]});
        assert.ok(html.includes(expected.toString('base64')),'the fixed dark studio ground requires the unchanged white wordmark');
        await page.setContent(html);assert.equal(await page.locator('main').getAttribute('data-theme'),theme);
        grounds.push(await page.evaluate(()=>{
          const canvas=getComputedStyle(document.querySelector('.canvas')),photo=getComputedStyle(document.querySelector('.atmosphere'));
          return {paper:canvas.backgroundColor,tint:photo.backgroundImage,filter:photo.filter,ink:getComputedStyle(document.querySelector('h1')).color};
        }));
      }
      assert.deepEqual(grounds[0],grounds[1],'product tint, base exposure, and readable lettering must survive a UI-theme switch');
      assert.equal(grounds[0].paper,studio.darkBackground?'rgb(24, 40, 62)':'rgb(37, 26, 53)');
      assert.equal(grounds[0].filter,'saturate(0.95) brightness(0.95)');
    }
    await page.setContent(await renderTemplate({project:{title:'Portfolio v1',artDirection:'porcelain',layout:'desktop-centered',fadeStart:.4,fadeEnd:.9,blurStart:.38},output:{template:'showcase',width:1600,height:1200},captures:[capture]}));
    const styles=await page.locator('.window').evaluate(frame=>({mask:getComputedStyle(frame).maskImage,blur:getComputedStyle(frame.querySelector('.softness')).top,height:frame.getBoundingClientRect().height}));
    assert.ok(styles.mask.includes('40%')&&styles.mask.includes('90%'));
    assert.ok(Math.abs(parseFloat(styles.blur)/styles.height-.38)<.001);
    for(const invalid of [{fadeStart:.9,fadeEnd:.4},{blurStart:1.1},{fadeStart:'0.4'}])await assert.rejects(renderTemplate({project:{title:'Site',...invalid},output:{template:'showcase'},captures:[capture]}),/fade/);
  }finally{await browser.close();}
});
