import fs from 'node:fs/promises';
import path from 'node:path';
import { inside } from './config.mjs';

/** Read a repository image without following a symlink outside the config root. */
async function readImage(root,relative) {
  const filename=inside(root,relative,'image source');
  const real=await fs.realpath(filename);
  inside(root,real,'image source symlink');
  const data=await fs.readFile(real);
  const extension=path.extname(filename).toLowerCase();
  const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml'}[extension];
  if(!mime)throw new Error(`Unsupported image format: ${extension}`);
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** Settle visible image and font dependencies before an authentic capture. */
export async function settle(page) {
  await page.evaluate(async()=>{
    await document.fonts.ready;
    await Promise.all([...document.images].filter(image=>{
      const rect=image.getBoundingClientRect();
      const style=getComputedStyle(image);
      return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth&&style.visibility!=='hidden'&&style.visibility!=='collapse';
    }).map(image=>image.decode()));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
}

/** Capture one configured source; fresh failures never fall back to old artwork. */
export async function captureSource({capture,plan,browser,chromium,destination,registerCleanup,signal}) {
  if(capture.provider==='image' || plan.captureMode==='existing') {
    const source=capture.provider==='image'?capture.path:capture.fallback;
    if(!source)throw new Error(`No explicit existing image configured for ${capture.id}`);
    const src=await readImage(plan.root,source);
    const context=await browser.newContext({deviceScaleFactor:1});
    try {
      const page=await context.newPage();
      await page.setContent(`<style>*{margin:0}img{display:block}</style><img src="${src}">`);
      const image=page.locator('img');
      await image.evaluate(async image=>{await image.decode();});
      const size=await image.evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight}));
      if(size.width*size.height>50000000)throw new Error(`Source image ${capture.id} exceeds 50 megapixels`);
      await page.setViewportSize({width:Math.min(size.width,6000),height:Math.min(size.height,6000)});
      await image.screenshot({path:destination,animations:'disabled'});
      return {provider:capture.provider,mode:'existing',source,width:size.width,height:size.height};
    } finally {await context.close();}
  }
  if(capture.provider==='obsidian') {
    const {captureObsidian}=await import('./obsidian.mjs');
    const result=await captureObsidian({capture:{...capture,colorScheme:plan.theme??capture.colorScheme??'light'},root:plan.root,path:destination,chromium,timeoutMs:120000,registerCleanup,signal});
    return {provider:'obsidian',mode:'fresh',...result};
  }
  const context=await browser.newContext({viewport:capture.viewport??{width:1440,height:900},deviceScaleFactor:plan.scale,colorScheme:plan.theme??capture.colorScheme??'light',reducedMotion:'reduce'});
  try {
    const page=await context.newPage();
    page.setDefaultTimeout(45000);
    const theme=plan.theme??capture.colorScheme??'light';
    if(capture.localStorage)await page.addInitScript(values=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);},Object.fromEntries(Object.entries(capture.localStorage).map(([key,value])=>[key,value==='$theme'?theme:value])));
    await page.goto(capture.resolvedUrl,{waitUntil:'load',timeout:60000});
    for(const action of capture.actions??[]) {
      if(action.type==='click')await page.locator(action.selector).click();
      if(action.type==='fill')await page.locator(action.selector).fill(action.value);
      if(action.type==='scroll')await page.evaluate(({x,y})=>scrollTo(x??0,y??0),action);
    }
    if(capture.ready?.selector)await page.locator(capture.ready.selector).first().waitFor({state:'visible'});
    if(capture.ready?.expression)await page.waitForFunction(capture.ready.expression);
    if(capture.styles)await page.addStyleTag({content:capture.styles});
    await settle(page);
    await page.screenshot({path:destination,animations:'disabled',caret:'hide'});
    const size=page.viewportSize();
    const url=new URL(capture.resolvedUrl);
    return {provider:'web',mode:'fresh',source:url.origin+url.pathname,width:size.width*plan.scale,height:size.height*plan.scale};
  } finally {await context.close();}
}
