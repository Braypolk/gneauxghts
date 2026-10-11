import { browser, $, expect } from '@wdio/globals';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resetBrowserWorkspace, openHistoryShortcut } from '../../../e2e/support/browserWorkspace';

mkdirSync('.scratch/responsive-screens/evidence/after', { recursive: true });
const sizes = [[390,844],[640,560],[768,700],[1024,768],[844,390]];
const evidence: unknown[] = [];
async function snapshot(name: string) {
  await browser.pause(350);
  const metrics = await browser.execute(() => {
    const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height }; };
    const visible = (el: HTMLElement) => el.checkVisibility() && el.getBoundingClientRect().width > 0;
    const controls = [...document.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,a')].filter(visible);
    return {
      viewport: [innerWidth,innerHeight],
      offscreen: controls.filter(el => { const r=el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth+1 || r.top< -1 || r.bottom>innerHeight+1; }).map(el=>({label:el.getAttribute('aria-label')||el.textContent?.trim().slice(0,75),...rect(el)})),
      surfaces:[...document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"],.cm-scroller,.settings-content,[aria-label="Historical revision"],[data-notepad-command-bar],.shared-search-bar')].map(el=>({selector:el.className,...rect(el),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth})),
      text:document.body.innerText.slice(-1400)
    };
  });
  evidence.push({name,...metrics});
  await browser.saveScreenshot(`.scratch/responsive-screens/evidence/after/${name}.png`);
  writeFileSync('.scratch/responsive-screens/evidence/after/measurements.json',JSON.stringify(evidence,null,2));
}
async function viewport(width:number,height:number){
 await browser.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
}
describe('responsive audit',()=>{
 after(async()=>{await browser.sendCommand('Emulation.clearDeviceMetricsOverride',{});});
 it('inspects all main tabs and editor modes',async function(){
  this.timeout(240000);
  for(const [w,h] of sizes){
   await resetBrowserWorkspace(); await viewport(w,h);
   await snapshot(`editor-${w}-${h}`);
   await $('button[aria-label="Expand related notes"]').click();
   await snapshot(`related-${w}-${h}`);
   await $('button[aria-label="Collapse related notes"]').click();
   await $('[data-testid="note-search-input"]').click();
   await snapshot(`search-${w}-${h}`); await browser.keys('Escape');
   await openHistoryShortcut(); await $('[data-testid="history-mode"]').waitForDisplayed();
   await $('[data-revision-id="note-alpha-revision-35"]').waitForExist();
   await snapshot(`history-${w}-${h}`); await $('button[aria-label="Back to workspace"]').click();
   await viewport(1024,768);
   await browser.execute(()=>window.__GNEAUXGHTS_E2E__!.seedChatControls());
   await browser.execute(()=>document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
   await $('button[aria-label="Split with thought partner"]').waitForDisplayed();
   await $('button[aria-label="Split with thought partner"]').click();
   await $('[data-notepad-command-bar] textarea').waitForEnabled();
   await viewport(w,h); await snapshot(`chat-${w}-${h}`);
   for(const [url,ready] of [['/list','select[aria-label="Due date filter"]'],['/map','button[aria-label="Fit map to view"]'],['/settings','input[aria-label="Search settings"]']]){
    await browser.url(url); await $(ready).waitForDisplayed({timeout:30000}); await snapshot(`${url.slice(1)}-${w}-${h}`);
    if(url==='/settings')for(const id of ['shortcuts','forgetting','ai','search','vault','history','forgotten']){
      const category=await $(`[data-settings-section="${id}"]`); await category.scrollIntoView(); await category.click(); await snapshot(`settings-${id}-${w}-${h}`);
    }
   }
  }
  expect(evidence.length).toBeGreaterThan(50);
 });
});
