import { browser, $ } from '@wdio/globals';
import { mkdirSync } from 'node:fs';
import { resetBrowserWorkspace, openRecentNote } from '../../../e2e/support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../../e2e/support/workspaceAnimation';
describe('initial compact rail visual evidence', () => {
 it('captures the shared wipe for blank and chat splits', async () => {
  const output='.scratch/responsive-screens/evidence/initial-rail';mkdirSync(output,{recursive:true});
  for(const choice of ['blank','chat']) for(const phase of [0.5,0.95]) {
   await resetBrowserWorkspace();await openRecentNote('Beta note');
   await browser.sendCommand('Emulation.setDeviceMetricsOverride',{width:640,height:844,deviceScaleFactor:1,mobile:false});
   await browser.executeAsync((done:()=>void)=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())));
   await browser.waitUntil(async()=>browser.execute(()=>!document.querySelector('[data-window-resizing]')));
   await waitForWorkspaceAnimationSettled();
   await browser.executeAsync((choice:string,phase:number,done:()=>void)=>{
    const edge=document.querySelector('.notepad-pane')!.getBoundingClientRect().right;
    if(choice==='chat') {
     window.__GNEAUXGHTS_E2E__!.seedChatControls();
     document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter'));
     document.querySelector<HTMLButtonElement>('button[aria-label="Split with thought partner"]')!.click();
    } else document.querySelector<HTMLButtonElement>('button[aria-label="Open split pane options"]')!.click();
    const sample=()=>setTimeout(()=>{
     const rail=document.querySelector<HTMLElement>('.pane-rail');
     const row=rail?.closest('.notepad-pane')!.parentElement!;
     if(!rail||(edge-rail.getBoundingClientRect().left)/row.clientWidth<phase) requestAnimationFrame(sample);
     else {for(const a of document.getAnimations())if(a.effect?.getTiming().iterations!==Infinity)a.pause();done();}
    },0);requestAnimationFrame(sample);
   },choice,phase);
   await browser.saveScreenshot(`${output}/${choice}-${phase}.png`);
   await browser.execute(()=>{for(const a of document.getAnimations())if(a.playState==='paused')a.play();});
   await waitForWorkspaceAnimationSettled();
  }
  await browser.sendCommand('Emulation.clearDeviceMetricsOverride',{});
 });
});
