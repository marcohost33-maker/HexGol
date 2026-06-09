import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
const URL="http://127.0.0.1:4173/", wait=ms=>new Promise(r=>setTimeout(r,ms));
const SIZE=process.env.SIZE||"M", THROTTLE=Number(process.env.CPU||6), LABEL=process.env.LABEL||"run";
const server=spawn("npm",["run","preview","--","--host","127.0.0.1","--port","4173"],{shell:true,stdio:"ignore"});
await wait(2500);
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true});
const page=await ctx.newPage();
const cdp=await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate",{rate:THROTTLE});
await page.addInitScript(()=>{window.__lt=[];window.__g=[];
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(e.duration);}).observe({entryTypes:["longtask"]});}catch{}
  let last=performance.now();function t(n){window.__g.push(n-last);last=n;requestAnimationFrame(t);}requestAnimationFrame(t);});
await page.goto(URL,{waitUntil:"load"});
await page.waitForSelector("canvas");
if(SIZE!=="M"){const tab=page.locator('button[aria-label="Tab 3 Hex-Regeln"]').first();await tab.click().catch(()=>{});await wait(250);
  const selects=page.locator("select");const n=await selects.count();for(let i=0;i<n;i++){const s=selects.nth(i);const opts=await s.locator("option").allTextContents();const idx=opts.findIndex(t=>t.startsWith(SIZE+" ("));if(idx>=0){await s.selectOption({index:idx});break;}}
  await tab.click().catch(()=>{});await wait(400);}
await page.locator('button[aria-label="Random"]').first().click().catch(()=>{});
await page.locator('button[aria-label="Start"]').first().click().catch(()=>{});
await wait(600);
await page.evaluate(()=>{window.__lt=[];window.__g=[];});
await wait(3000);
const r=await page.evaluate(()=>{const g=window.__g.slice().sort((a,b)=>a-b),lt=window.__lt.slice();
  return {frames:g.length,gp50:g[(g.length*0.5)|0]||0,gp95:g[(g.length*0.95)|0]||0,gmax:g[g.length-1]||0,
    ltCount:lt.filter(d=>d>=50).length,ltMax:lt.length?Math.max(...lt):0,ltSum:lt.reduce((a,b)=>a+b,0)};});
console.log(`${LABEL.padEnd(16)} ${SIZE} @${THROTTLE}x  fps~${(r.frames/3).toFixed(1).padStart(5)}  gapP50=${r.gp50.toFixed(1).padStart(6)}ms gapMax=${r.gmax.toFixed(0).padStart(4)}ms  longTasks=${String(r.ltCount).padStart(2)} maxLT=${r.ltMax.toFixed(0)}ms sumLT=${r.ltSum.toFixed(0)}ms`);
await browser.close();server.kill();
