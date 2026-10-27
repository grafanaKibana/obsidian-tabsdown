import { readFile } from 'node:fs/promises';

/** Escape authored text before placing it in the composition document. */
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

/** Keep configurable colors literal rather than treating them as CSS source. */
function color(value, fallback) {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ? value : fallback;
}

/** Apply a photographic overlay opacity without changing its configured hue. */
function translucent(value, opacity) {
  const raw = value.slice(1);
  const expanded = raw.length <= 4 ? [...raw].map(channel => channel + channel).join('') : raw;
  const alpha = expanded.length === 8 ? parseInt(expanded.slice(6),16) / 255 : 1;
  return `#${expanded.slice(0,6)}${Math.round(alpha * opacity * 255).toString(16).padStart(2,'0')}`;
}

/** Use source geometry to size a frontal window without stretching the captured viewport. */
function sourceRatio(capture) {
  const ratio = capture?.width / capture?.height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1.44;
}

/** Write numeric layout coordinates directly, avoiding competing inherited positioning rules. */
function rectangleStyle({left,top,width,height}) {
  return `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
}

/** Fit an entire source rectangle into its available artboard area. */
function contain(capture, area) {
  const ratio = sourceRatio(capture);
  const width = Math.min(area.width, area.height * ratio);
  const height = width / ratio;
  return {left:area.left + (area.width - width) / 2,top:area.top + (area.height - height) / 2,width,height};
}

/** Resolve the four explicit column/desktop arrangements from source and artboard dimensions. */
function managedGeometry({layout,width,height,capture,imageZoom,imageOffsetX,frameHeight,edgeBleed,unit,hasPlatform,imageFit,identityOnly}) {
  const font = size => `${size * unit}px`;
  const heading = (left,top,headingWidth,size,align='left') => `position:absolute;left:${left}px;top:${top}px;width:${headingWidth}px;font-size:${font(size)};text-align:${align};`;
  if (layout === 'column' || layout === 'desktop-side') {
    const area = {left:width * .35,top:height * .11,width:width * .61,height:height * .78};
    const desktop = layout === 'desktop-side' || imageFit === 'contain';
    const imageWidth = area.width * imageZoom;
    const frame = desktop ? contain(capture, area) : {left:area.left,top:0,width:area.width,height:Math.min(area.height,imageWidth / sourceRatio(capture))};
    if (!desktop) frame.top = (height - frame.height) / 2;
    const centered = identityOnly && layout === 'column';
    const identity = {left:centered?0:width * .035,top:frame.top,width:centered?width:width * .27,height:frame.height};
    return {frame,identityStyle:`${rectangleStyle(identity)}display:block;`,headingStyle:heading(0,0,identity.width,88,layout==='desktop-side'?'left':'center'),platformStyle:'position:absolute;left:0;right:auto;top:auto;bottom:0;width:100%;max-width:none;margin:0;justify-content:center;',imageWidth:desktop?frame.width:imageWidth,offset:desktop?0:imageOffsetX*unit,fit:desktop?'contain':'crop'};
  }
  if (layout === 'desktop-centered') {
    const top = height * (hasPlatform ? .29 : .20);
    const frame = contain(capture,{left:width * .055,top,width:width * .89,height:height * .92 - top});
    return {frame,identityStyle:'display:contents;',headingStyle:heading(width*.055,height*.055,width*.89,72,'center'),platformStyle:`position:absolute;left:${width*.055}px;right:auto;top:${height*.16}px;bottom:auto;width:${width*.89}px;max-width:none;margin:0;justify-content:center;`,imageWidth:frame.width,offset:0,fit:'contain'};
  }
  if (layout === 'horizontal') {
    const imageWidth = width * .89 * imageZoom;
    const area = {left:width * .055,top:height * .24,width:width * .89,height:height * frameHeight};
    const frame = imageFit === 'contain' ? contain(capture,area) : {...area,height:Math.min(area.height,imageWidth / sourceRatio(capture))};
    return {frame,identityStyle:'display:contents;',headingStyle:heading(width*.055,height*.065,width*(identityOnly ? .89 : .55),62,identityOnly?'center':'left'),platformStyle:`position:absolute;left:${width*(identityOnly ? .055 : .625)}px;right:auto;top:${height*(identityOnly ? .16 : .09)}px;bottom:auto;width:${width*(identityOnly ? .89 : .32)}px;max-width:none;margin:0;justify-content:${identityOnly?'center':'flex-end'};`,imageWidth:imageFit==='contain'?frame.width:imageWidth,offset:imageFit==='contain'?0:imageOffsetX*unit,fit:imageFit==='contain'?'contain':'crop'};
  }
  if (layout === 'site-top') {
    const top = height * .18;
    const imageWidth = Math.min(width * .97, ((1 + edgeBleed) * height - top) * sourceRatio(capture));
    const frame = {left:width * .055,top,width:imageWidth,height:imageWidth / sourceRatio(capture)};
    return {frame,identityStyle:'display:contents;',headingStyle:heading(width*.055,height*(hasPlatform ? .035 : .05),width*.89,72,'center'),platformStyle:`position:absolute;left:${width*.055}px;right:auto;top:${height*.125}px;bottom:auto;width:${width*.89}px;max-width:none;margin:0;justify-content:center;`,imageWidth,offset:0,fit:'bleed'};
  }
  return undefined;
}

/** Give comparison panes explicit source-sized boxes, containing desktop viewports in full. */
function comparisonGeometry({layout,width,height,captures,imageZoom,imageOffsetX,unit}) {
  const desktop = layout.startsWith('desktop-') || layout === 'site-top';
  const gap = width * .03;
  const paneWidth = (width * .89 - gap * (captures.length - 1)) / captures.length;
  const frames = captures.map((capture,index) => {
    const area = {left:width*.055 + index*(paneWidth+gap),top:height*.25,width:paneWidth,height:height*.66};
    const imageWidth = paneWidth * imageZoom;
    const frame = desktop ? contain(capture,area) : {left:area.left,top:0,width:paneWidth,height:Math.min(area.height,imageWidth/sourceRatio(capture))};
    if (!desktop) frame.top = area.top + (area.height-frame.height)/2;
    return {frame,imageWidth:desktop?frame.width:imageWidth,offset:desktop?0:imageOffsetX*unit,fit:desktop?'contain':'crop'};
  });
  return {identityStyle:'display:contents;',headingStyle:`position:absolute;left:${width*.055}px;top:${height*.07}px;width:${width*.58}px;font-size:${62*unit}px;text-align:left;`,platformStyle:`position:absolute;left:${width*.665}px;right:auto;top:${height*.09}px;bottom:auto;width:${width*.28}px;max-width:none;margin:0;justify-content:flex-end;`,frames};
}

/** Compose authentic, deliberately cropped UI with the selected photographic or porcelain setting. */
export async function renderTemplate({ project, output, captures, theme }) {
  theme = theme ?? output.theme;
  const width = output.width ?? 1600;
  const height = output.height ?? 1000;
  const unit = Math.min(width / 1600, height / 800);
  const px = value => `${Math.round(value * unit * 100) / 100}px`;
  const artDirection = output.artDirection ?? project.artDirection ?? 'porcelain';
  const layout = output.layout ?? project.layout ?? 'side';
  const imageZoom = output.imageZoom ?? project.imageZoom ?? 1;
  const imageOffsetX = output.imageOffsetX ?? project.imageOffsetX ?? 0;
  const frameHeight = output.frameHeight === undefined ? .65 : output.frameHeight;
  const edgeBleed = output.edgeBleed !== undefined ? output.edgeBleed : project.edgeBleed !== undefined ? project.edgeBleed : .06;
  const template = output.template ?? 'editorial';
  if (!['porcelain','studio'].includes(artDirection)) throw new Error(`Unknown art direction: ${artDirection}`);
  if (!['side','wide','reverse','column','horizontal','desktop-side','desktop-centered','site-top'].includes(layout)) throw new Error(`Unknown composition layout: ${layout}`);
  if (!['editorial','feature','showcase'].includes(template)) throw new Error(`Unknown composition template: ${template}`);
  if (typeof imageZoom !== 'number' || !Number.isFinite(imageZoom) || imageZoom < .6 || imageZoom > 2) throw new Error('imageZoom must be a finite number between 0.6 and 2');
  if (typeof imageOffsetX !== 'number' || !Number.isFinite(imageOffsetX) || imageOffsetX < -600 || imageOffsetX > 600) throw new Error('imageOffsetX must be a finite number between -600 and 600');
  if (typeof frameHeight !== 'number' || !Number.isFinite(frameHeight) || frameHeight < .1 || frameHeight > .7) throw new Error('frameHeight must be a finite number between 0.1 and 0.7');
  if (typeof edgeBleed !== 'number' || !Number.isFinite(edgeBleed) || edgeBleed < 0 || edgeBleed > .15) throw new Error('edgeBleed must be a finite number between 0 and 0.15');
  const dark = theme ? theme === 'dark' : artDirection === 'studio';
  // Studio tint belongs to the product identity, independently of the captured UI theme.
  const darkBackdrop = artDirection === 'studio' || dark;
  const paper = darkBackdrop ? color(project.darkBackground, artDirection === 'studio' ? '#251a35' : '#10141a') : color(project.background, '#fcfcfb');
  const ink = darkBackdrop ? '#f2f4f6' : color(project.ink, '#252527');
  const studioTint = color(project.studioTint, '#684487');
  const studioShade = color(project.studioShade, '#442b62');
  const studioGlow = color(project.studioGlow, '#c5a3f1');
  const studioShadow = color(project.darkBackground, '#251a35');
  const siteTint = color(project.siteTint, '#dfe8e4');
  const fadeStart = output.fadeStart ?? project.fadeStart ?? .67;
  const fadeEnd = output.fadeEnd ?? project.fadeEnd ?? 1;
  const blurStart = output.blurStart ?? project.blurStart ?? .62;
  if (![fadeStart,fadeEnd,blurStart].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) || fadeStart >= fadeEnd) throw new Error('Invalid fade fractions');
  if (project.siteBackdrop !== undefined && typeof project.siteBackdrop !== 'boolean') throw new Error('siteBackdrop must be a boolean');
  const font = await readFile(new URL('../assets/Geist.ttf', import.meta.url));
  const name = escapeHtml(project.title);
  const platform = (project.subtitle ?? '').trim().replace(/^for\s+/i, '');
  const selected = captures.slice(0, template === 'feature' ? 2 : 1);
  const managed = ['column','horizontal','desktop-side','desktop-centered','site-top'].includes(layout);
  const geometry = template === 'feature' ? (managed && output.showProduct !== false ? comparisonGeometry({layout,width,height,captures:selected,imageZoom,imageOffsetX,unit}) : undefined) : managedGeometry({layout,width,height,capture:selected[0],imageZoom,imageOffsetX,frameHeight,edgeBleed,unit,hasPlatform:Boolean(platform),imageFit:output.imageFit,identityOnly:output.showProduct===false});
  let platformContent = `<strong>${escapeHtml(platform)}</strong>`;
  const obsidian = /^Obsidian(?:\s*&\s*Quartz)?$/i.test(platform);
  const quartz = /^Quartz$/i.test(platform);
  if (obsidian) {
    const brand = await readFile(new URL(`../assets/obsidian-lockup-${darkBackdrop ? 'dark' : 'light'}.svg`, import.meta.url));
    platformContent = `<img class="obsidian-brand" src="data:image/svg+xml;base64,${brand.toString('base64')}" width="143" height="25" alt="Obsidian" />${/Quartz/i.test(platform) ? '<strong class="companion">&amp; Quartz</strong>' : ''}`;
  }
  const lockup = platform ? `<div class="platform" aria-label="for ${escapeHtml(platform)}"${obsidian ? ' data-obsidian="true"' : ''}${quartz ? ' data-quartz="true"' : ''}${geometry ? ` style="${geometry.platformStyle}"` : ''}><span class="for-label">FOR</span>${platformContent}</div>` : '';
  const frames = (output.showProduct === false ? [] : selected).map((capture, index) => {
    const scene = geometry?.frames?.[index] ?? geometry;
    return `<div class="window shot-${index}"${scene ? ` data-fit="${scene.fit}" style="${rectangleStyle(scene.frame)}"` : ''}><img class="product-capture" src="${escapeHtml(capture.src)}" alt="${name}"${scene ? ` style="width:${scene.imageWidth}px;height:auto;margin-left:${scene.offset}px;"` : ''} />${artDirection === 'porcelain' ? '<div class="softness" aria-hidden="true"></div>' : ''}</div>`;
  }).join('');
  let atmosphere = '';
  if (artDirection === 'studio') {
    const plate = await readFile(new URL('../assets/alpine-plate.png', import.meta.url));
    atmosphere = `<div class="atmosphere" aria-hidden="true" style="background-image:linear-gradient(100deg,color-mix(in srgb,${studioTint} 63%,transparent),color-mix(in srgb,${studioShade} 67%,transparent)),url(data:image/png;base64,${plate.toString('base64')})"></div><div class="light" aria-hidden="true"></div>`;
  } else if (project.siteBackdrop) {
    atmosphere = `<div class="site-surface" aria-hidden="true" data-material="optical-folds" style="--site-tint:${siteTint};--site-paper:${paper};--site-light:${dark ? '#aab8cc' : '#ffffff'};--site-shadow:${dark ? '#050810' : '#60758b'}"></div>`;
  }
  const backgroundPosition = ['left','center','right'].includes(project.backdropPosition) ? project.backdropPosition : 'center';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${width},initial-scale=1"><title>${name}</title><style>
  @font-face{font-family:CaptureGeist;src:url(data:font/ttf;base64,${font.toString('base64')}) format('truetype');font-display:block}
  *{box-sizing:border-box}html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden}body{font-family:CaptureGeist,sans-serif;background:${paper};color:${ink};-webkit-font-smoothing:antialiased}
  .canvas{position:relative;width:100%;height:100%;overflow:hidden;isolation:isolate;background:${paper};--zoom:${imageZoom}}
  .identity{display:contents}
  .atmosphere{position:absolute;inset:0;background-size:cover;background-position:${backgroundPosition} 70%;filter:saturate(.95) brightness(.95)}
  .light{position:absolute;inset:0;background:linear-gradient(145deg,${dark ? translucent(studioGlow,38/255) : '#ffffff38'} 0%,transparent 47%,${dark ? translucent(studioShadow,.2) : '#f7f8f32b'} 94%)}
  .site-surface{position:absolute;inset:0;background:conic-gradient(from 0deg at -18% 110%,transparent 0deg 28deg,color-mix(in srgb,var(--site-tint) ${dark ? '18' : '38'}%,transparent) 42deg,color-mix(in srgb,var(--site-light) ${dark ? '12' : '90'}%,transparent) 47deg,transparent 63deg 360deg),conic-gradient(from 180deg at 118% -12%,transparent 0deg 30deg,color-mix(in srgb,var(--site-shadow) ${dark ? '30' : '16'}%,transparent) 46deg,color-mix(in srgb,var(--site-light) ${dark ? '8' : '65'}%,transparent) 51deg,transparent 69deg 360deg),linear-gradient(135deg,var(--site-paper) 12%,color-mix(in srgb,var(--site-paper) ${dark ? '92' : '70'}%,var(--site-tint)) 100%)}
  h1{position:absolute;left:6.5%;top:42%;width:28%;margin:0;z-index:3;font-size:${px(88)};line-height:1.03;font-weight:600;letter-spacing:-.035em;overflow-wrap:anywhere;text-wrap:balance}
  .platform{position:absolute;left:6.8%;bottom:11%;max-width:28%;display:flex;align-items:baseline;gap:${px(16)};z-index:3;color:${ink}}
  .platform span{font-size:${px(17)};font-weight:450;letter-spacing:.04em;opacity:.65}.platform strong{font-size:${px(29)};line-height:1.2;font-weight:600;letter-spacing:-.025em;overflow-wrap:anywhere}
  .platform .obsidian-brand{display:block;width:${px(200.2)};height:${px(35)};aspect-ratio:143/25;max-width:none;filter:none;transform:none;perspective:none;flex-shrink:0}
  .window{position:absolute;left:35%;top:11%;width:94%;height:100%;overflow:hidden;border-radius:${px(17)};background:${dark ? '#1e2023' : '#fff'};box-shadow:0 ${px(14)} ${px(46)} ${px(-16)} #1419233d;transform:none;perspective:none}
  .window img{display:block;width:calc(100% * var(--zoom));height:auto;max-width:none;margin-left:${px(imageOffsetX)};transform:none;perspective:none}
  .porcelain .window{mask-image:linear-gradient(#000 0%,#000 52%,transparent 91%)}
  .softness{position:absolute;inset:49% 0 0;backdrop-filter:blur(${px(5)});mask-image:linear-gradient(transparent,#000 90%);pointer-events:none}
  .reverse h1{left:70%;width:25%}.reverse .platform{left:70%;max-width:25%}.reverse .window{left:-2%;width:67%}.reverse .window img{width:calc(141% * var(--zoom))}
  .studio h1{left:68.5%;top:40%;width:28%;font-size:${px(82)};font-weight:450}.studio .platform{left:68.5%;top:57%;bottom:auto;max-width:28%;color:${dark ? '#c7d3d9' : ink}}
  .studio:not(.feature):not(.wide):not(.managed) .identity{display:block;position:absolute;left:68.5%;top:40%;width:28%;z-index:3}.studio:not(.feature):not(.wide):not(.managed) h1{position:static;width:100%}.studio:not(.feature):not(.wide):not(.managed) .platform{position:static;width:100%;max-width:100%;margin-top:${px(40)}}
  .studio .window{left:-2%;top:19%;width:67%;height:70.5%;border-radius:${px(13)};box-shadow:0 ${px(36)} ${px(100)} ${px(-20)} #000b;outline:1px solid ${dark ? '#c5d9df38' : '#ffffff70'}}
  .studio .window img{width:calc(141% * var(--zoom))}
  .studio.reverse h1,.studio.reverse .platform{left:6.5%;width:28%}.studio.reverse .window{left:35%}
  .studio.reverse:not(.feature) .identity{left:6.5%}
  .wide h1{left:5.5%;top:6.5%;width:62%;font-size:${px(62)}}.wide .platform{left:auto;right:5.5%;top:9%;bottom:auto;max-width:27%}
  .wide .window{left:5.5%;top:24%;width:89%;height:auto;max-height:${frameHeight * 100}%;mask-image:none}.wide .window img{width:calc(100% * var(--zoom))}.wide .softness{display:none}
  .canvas.feature h1{left:5.5%;top:7%;width:58%;font-size:${px(62)}}.canvas.feature .platform{left:auto;right:5.5%;top:9%;bottom:auto;max-width:28%}
  .feature .scenes{position:absolute;left:5.5%;right:5.5%;top:25%;height:66%;display:grid;grid-template-columns:repeat(${selected.length},minmax(0,1fr));gap:3%}
  .canvas.feature .window{position:relative;left:auto;top:auto;width:100%;height:auto;max-height:100%;align-self:center;mask-image:none}.feature .window img{width:calc(${selected.length > 1 ? '150%' : '100%'} * var(--zoom))}.feature .softness{display:none}
  .managed .identity{z-index:3}.managed .platform{align-items:center}.managed.porcelain .window{mask-image:linear-gradient(#000 0%,#000 ${fadeStart*100}%,transparent ${fadeEnd*100}%)}.managed.porcelain .softness{inset:${blurStart*100}% 0 0;display:block}
  .managed .platform[data-obsidian] .for-label{position:relative;top:${px(1.25)}}
  .managed .platform[data-quartz] .for-label{position:relative;top:${px(.55)}}
  .managed.feature .scenes{position:static;display:block;height:auto}
  </style></head><body><main class="canvas ${artDirection} ${layout} ${template}${geometry ? ' managed' : ''}${height / width < .55 ? ' social' : ''}" data-art-direction="${artDirection}" data-theme="${dark ? 'dark' : 'light'}">${atmosphere}<div class="identity"${geometry ? ` style="${geometry.identityStyle}"` : ''}><h1${geometry ? ` style="${geometry.headingStyle}"` : ''}>${name}</h1>${lockup}</div><section class="scenes" aria-label="Product screenshots">${frames}</section></main></body></html>`;
}
