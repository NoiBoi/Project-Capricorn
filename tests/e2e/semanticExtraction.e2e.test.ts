import fs from 'node:fs';
import path from 'node:path';
import {chromium,type Browser} from 'playwright-core';
import {afterAll,beforeAll,expect,it} from 'vitest';
let browser:Browser;
const capture=fs.readFileSync(path.resolve(__dirname,'../../extensions/chrome/capture.js'),'utf8').replace('export function capture','function capture');
const read=(page:any,mode:string)=>page.evaluate(`(${capture})(${JSON.stringify(mode)})`);
beforeAll(async()=>{browser=await chromium.launch({executablePath:process.env.CAPRI_CHROME_EXE??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});});
afterAll(async()=>{await browser?.close();});
it('extracts rendered hierarchy, lists, tables and code while excluding hidden text and private forms',async()=>{
 const p=await browser.newPage();try{await p.setContent(`<main><h1>Statics</h1><h2>Reaction forces</h2><p>A pin supports the beam.<span hidden>HIDDEN_SECRET</span><span style="display:none">CSS_SECRET</span><span style="visibility:hidden">INVISIBLE_SECRET</span></p><form><label>PRIVATE_FORM<input value="PRIVATE_INPUT"></label></form><ul><li>Balance force</li><li>Balance moment</li></ul><table><tr><th>Force</th><th>N</th></tr><tr><td>Reaction</td><td>12</td></tr></table><pre>sum_F = 0\nprint(sum_F)</pre><p>api_key=credential</p></main>`);
 const result=await read(p,'deep');expect(result.sections.map((s:any)=>s.kind)).toEqual(['heading','heading','paragraph','list','table','code','paragraph']);const text=JSON.stringify(result);for(const secret of ['HIDDEN_SECRET','CSS_SECRET','INVISIBLE_SECRET','PRIVATE_FORM','PRIVATE_INPUT','credential'])expect(text).not.toContain(secret);expect(text).toContain('Reaction | 12');expect(result.sections.find((s:any)=>s.kind==='code').text).toContain('\n');expect(result.sections[2].path).toBe('Statics > Reaction forces');expect((await read(p,'metadata')).sections).toEqual([]);
 }finally{await p.close();}
});
it('refuses password pages, unsafe selections and nonsemantic application surfaces',async()=>{
 const p=await browser.newPage();try{await p.setContent('<main><p>Public article</p><input type=password value=private></main>');expect(await read(p,'deep')).toBeNull();await p.setContent('<div>A web app without a semantic main region</div>');expect((await read(p,'deep')).sections).toEqual([]);
 await p.setContent('<main><p>Allowed text</p><form><label>Private form content<input></label></form><p>More public text</p></main>');await p.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('main')!);const s=getSelection()!;s.removeAllRanges();s.addRange(r);});expect((await read(p,'selection')).selection).toBe('');
 }finally{await p.close();}
});
it('observes authorized YouTube media state without accumulating time from an open tab',async()=>{
 const p=await browser.newPage();try{await p.route('https://www.youtube.com/**',r=>r.fulfill({contentType:'text/html',body:'<main><h1>Mechanics lecture</h1><video style="width:300px;height:180px"></video></main>'}));await p.goto('https://www.youtube.com/watch');
 const first=await read(p,'semantic');expect(first.playback.state).toBe('paused');expect(first.playback.position).toBe(0);expect((await read(p,'metadata')).playback).toBeUndefined();
 await p.evaluate(()=>{Object.defineProperty(document.querySelector('video'),'paused',{value:false,configurable:true});});expect((await read(p,'semantic')).playback.state).toBe('playing');await p.evaluate(()=>{Object.defineProperty(document.querySelector('video'),'paused',{value:true});});expect((await read(p,'semantic')).playback.state).toBe('paused');
 }finally{await p.close();}
});
