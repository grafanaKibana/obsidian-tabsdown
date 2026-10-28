const cliUrl=new URL('../../cli.mjs',import.meta.url).href;
const playwrightUrl=new URL('./mock-playwright.mjs',import.meta.url).href;
const rendererUrl=new URL('./mock-render.mjs',import.meta.url).href;

/** Resolve static test doubles without generating or evaluating module source. */
export async function resolve(specifier,context,nextResolve) {
  if(specifier==='playwright')return {url:playwrightUrl,shortCircuit:true};
  if(process.env.PRODUCT_CAPTURE_TEST_RENDERER==='1'&&specifier==='./lib/render.mjs'&&context.parentURL===cliUrl)return {url:rendererUrl,shortCircuit:true};
  return nextResolve(specifier,context);
}
