import fs from 'node:fs/promises';
import { settle } from './capture.mjs';

/** Export one template with embedded images, preventing external asset dependencies. */
export async function renderOutput({browser,project,output,captures,theme,scale,destination}) {
  const {renderTemplate}=await import('./templates.mjs');
  const sources=await Promise.all(captures.map(async capture=>({...capture,src:`data:image/png;base64,${(await fs.readFile(capture.path)).toString('base64')}`})));
  const html=await renderTemplate({project,output,captures:sources,theme,scale});
  const context=await browser.newContext({viewport:{width:output.width,height:output.height},deviceScaleFactor:scale,colorScheme:theme??'light',reducedMotion:'reduce'});
  try {
    const page=await context.newPage();
    await page.route('**/*',route=>{
      const protocol=new URL(route.request().url()).protocol;
      return ['data:','about:'].includes(protocol)?route.continue():route.abort();
    });
    await page.setContent(html,{waitUntil:'load'});
    await settle(page);
    await page.screenshot({path:destination,animations:'disabled',caret:'hide'});
  } finally {await context.close();}
}
