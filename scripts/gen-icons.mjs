// PNG icons for the home screen from public/icon.svg: node scripts/gen-icons.mjs
// Rendering uses Playwright's Chromium. This repo does NOT depend on Playwright: it borrows the one installed in the
// sibling WWYD checkout (../WWYD/node_modules/@playwright/test). Override with PLAYWRIGHT_MODULE=<path to @playwright/test/index.mjs>.
import{readFileSync}from'node:fs';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';

const PUBLIC=resolve(import.meta.dirname,'../public');
const mod=process.env.PLAYWRIGHT_MODULE??resolve(import.meta.dirname,'../../WWYD/node_modules/@playwright/test/index.mjs');
const{chromium}=await import(pathToFileURL(mod).href);
const svg=readFileSync(resolve(PUBLIC,'icon.svg'),'utf8');
// maskable (Android cuts it to a circle or squircle): the burst stays full-bleed, only the <g id="mark"> (the x) is shrunk (.8: the diamond tips reach r~44.5) to sit inside the 80% safe zone
const maskable=svg.replace('<g id="mark">','<g id="mark" transform="translate(50 50) scale(.8) translate(-50 -50)">');
if(maskable===svg)throw new Error('maskable: <g id="mark"> not found in icon.svg');
const browser=await chromium.launch();
try{
  for(const[file,size,src]of[['apple-touch-icon.png',180,svg],['icon-192.png',192,svg],['icon-512.png',512,svg],['icon-maskable-512.png',512,maskable]]){
    const page=await browser.newPage({viewport:{width:size,height:size}});
    await page.setContent(`<html><body style="margin:0">${src.replace('<svg ',`<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({path:resolve(PUBLIC,file)}); // opaque: the SVG paints a full-bleed background
    await page.close();console.log(`${file} (${size})`);
  }
}finally{await browser.close()}
