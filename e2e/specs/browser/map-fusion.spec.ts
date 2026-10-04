import { browser, expect, $ } from '@wdio/globals';

const alpha = '[data-node-id="note-alpha"] .dot-body';
const beta = '[data-node-id="note-beta"] .dot-body';
async function transform() { return $('.map-world').getAttribute('transform'); }

describe('Fusion map production behaviors', () => {
  beforeEach(async () => {
    await browser.url('/map/prototype');
    await $(beta).waitForDisplayed({ timeout:30_000 });
  });

  it('opens the picked note in the editor with double-click', async () => {
    await $(beta).click();
    await $(alpha).doubleClick();
    await $('[data-testid="note-title"]').waitForDisplayed();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  it('opens the selected note with Enter and the reader button', async () => {
    await $(beta).click();
    await browser.keys('Enter');
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
    await browser.url('/map/prototype');
    await $(alpha).waitForDisplayed(); await $(alpha).click();
    await $('button=Open in editor').click();
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
  });

  it('uses indexed results for body text beyond the map excerpt without moving the camera', async () => {
    const before = await transform();
    await $('[aria-label="Search map notes"]').setValue('synchronized row');
    await expect($('.search-status')).toHaveText('1 matching notes');
    await expect($('.reader')).not.toExist();
    await expect($('.regions-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect($(beta)).toHaveAttribute('fill-opacity', '1');
    await expect($(alpha)).toHaveAttribute('fill-opacity', '0.18');
    expect(await transform()).toEqual(before);
  });

  it('keeps an explicitly selected note when search changes or has no matches', async () => {
    await $(alpha).click();
    await $('[aria-label="Search map notes"]').setValue('synchronized row');
    await expect($('.search-status')).toHaveText('1 matching notes');
    await expect($('.reader h2')).toHaveText('alpha');
    await $('[aria-label="Search map notes"]').setValue('no-such-note-match');
    await expect($('.search-status')).toHaveText('0 matching notes');
    await expect($('.reader h2')).toHaveText('alpha');
  });

  it('refreshes live data while preserving the camera and clears a deleted selection', async () => {
    await $(alpha).click();
    await browser.keys('+');
    const before = await transform();
    await browser.execute(async () => {
      const internal = window.__TAURI_INTERNALS__ as {invoke:(command:string,args:unknown)=>Promise<any>};
      const atlas = await internal.invoke('get_vault_atlas', {});
      atlas.nodes = atlas.nodes.filter((node:any) => node.id !== 'note-alpha'); atlas.revision++;
      window.__GNEAUXGHTS_E2E__!.setAtlas(atlas);
      window.__GNEAUXGHTS_E2E__!.emit('vault-note-changed', {documentKind:'note',path:'/e2e/alpha.md'});
    });
    await $(alpha).waitForExist({ reverse:true });
    await expect($('.reader')).not.toExist();
    await expect($('[data-filename-id="note-beta"]')).toExist();
    expect(await transform()).toEqual(before);
  });

  it('invalidates loaded source when a selected note changes', async () => {
    await $(alpha).click();
    await $('button=Read full note').click();
    await expect($('.full-source')).toHaveText(expect.stringContaining('Alpha line 80'));
    const before = await transform();
    await browser.execute(async () => {
      const internal = window.__TAURI_INTERNALS__ as {invoke:(command:string,args:unknown)=>Promise<any>};
      const atlas = await internal.invoke('get_vault_atlas', {});
      atlas.nodes[0].preview = 'Changed note excerpt'; atlas.nodes[0].updatedAtMillis++; atlas.revision++;
      window.__GNEAUXGHTS_E2E__!.setAtlas(atlas);
      window.__GNEAUXGHTS_E2E__!.emit('vault-note-changed', {documentKind:'note',path:'/e2e/alpha.md'});
    });
    await expect($('.reader-excerpt')).toHaveText('Changed note excerpt');
    await expect($('.full-source')).not.toExist();
    expect(await transform()).toEqual(before);
  });

  it('reports empty and unavailable responses without substituting demo notes', async () => {
    await browser.execute(async () => {
      const internal = window.__TAURI_INTERNALS__ as {invoke:(command:string,args:unknown)=>Promise<any>};
      const atlas = await internal.invoke('get_vault_atlas', {});
      window.__GNEAUXGHTS_E2E__!.setAtlas({...atlas, nodes:[], clouds:[], links:[], status:'empty'});
      window.__GNEAUXGHTS_E2E__!.emit('vault-note-changed', {documentKind:'note',path:'/e2e/alpha.md'});
    });
    await expect($('.loading strong')).toHaveText('No map yet');
    await browser.execute(async () => {
      const internal = window.__TAURI_INTERNALS__ as {invoke:(command:string,args:unknown)=>Promise<any>};
      const atlas = await internal.invoke('get_vault_atlas', {});
      window.__GNEAUXGHTS_E2E__!.setAtlas({...atlas, status:'unavailable', reason:'Indexing unavailable'});
      window.__GNEAUXGHTS_E2E__!.emit('vault-note-changed', {documentKind:'note',path:'/e2e/alpha.md'});
    });
    await expect($('.loading strong')).toHaveText('Semantic map unavailable');
    await expect($('.loading p')).toHaveText('Indexing unavailable');
    await expect($('.map-world')).not.toExist();
  });

  it('renders and navigates a larger vault without dropping notes', async () => {
    await browser.execute(async () => {
      const internal = window.__TAURI_INTERNALS__ as {invoke:(command:string,args:unknown)=>Promise<any>};
      const atlas = await internal.invoke('get_vault_atlas', {}), sample = atlas.nodes[0];
      atlas.nodes = Array.from({length:2000}, (_, i) => {
        const root = i % 18, offset = Math.floor(i / 18), angle = offset * 2.399963, radius = 15 * Math.sqrt(offset);
        return {...sample,id:`large-${i}`,fileName:`Note ${i}.md`,cloudId:`root-${root}`,parentCloudId:`root-${root}`,x:root % 6 * 300 + Math.cos(angle) * radius,y:Math.floor(root / 6) * 300 + Math.sin(angle) * radius};
      });
      atlas.clouds = Array.from({length:18}, (_, root) => {
        const x = root % 6 * 300, y = Math.floor(root / 6) * 300;
        const members = atlas.nodes.filter((node:any) => node.cloudId === `root-${root}`).map((node:any)=>node.id);
        return {id:`root-${root}`,parentId:null,level:0,label:`Region ${root}`,labelSource:'keybert',noteCount:members.length,density:1,color:[100,150,180,255],centroid:[x,y],radius:110,hull:[[-110,-100],[110,-100],[110,100],[-110,100]].map(([dx,dy])=>[x+dx,y+dy]),memberNodeIds:members,coreNodeIds:members,outlierNodeIds:[],childCloudIds:[],representativeNodeIds:members.slice(0,3)};
      });
      atlas.revision++; atlas.labelGeneration = 'large-labels';
      window.__GNEAUXGHTS_E2E__!.setAtlas(atlas);
      window.__GNEAUXGHTS_E2E__!.emit('vault-note-changed', {documentKind:'note',path:'/e2e/alpha.md'});
    });
    await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('[data-node-id]').length === 2000), {timeout:15_000});
    expect(await browser.execute(() => document.querySelectorAll('[data-filename-id]').length)).toBe(2000);
    const before = await transform();
    await browser.keys('+');
    expect(await transform()).not.toEqual(before);
    await $('[aria-label="Fit map to view"]').click();
    expect(await browser.execute(() => document.querySelectorAll('[data-node-id]').length)).toBe(2000);
  });

  it('keeps note taps selectable and supports two-pointer pinch', async () => {
    const rect = await $(beta).getLocation();
    await browser.performActions([{type:'pointer',id:'tap',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,origin:'viewport',x:Math.round(rect.x+2),y:Math.round(rect.y+2)},{type:'pointerDown',button:0},{type:'pause',duration:50},{type:'pointerUp',button:0}]}]);
    await browser.releaseActions();
    await expect($('.reader h2')).toHaveText('beta');
    const before = await transform();
    const box = await $('.plot').getLocation();
    const x = Math.round(box.x+150), y = Math.round(box.y+120);
    await browser.performActions([
      {type:'pointer',id:'pinch-a',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,origin:'viewport',x,y},{type:'pointerDown',button:0},{type:'pointerMove',duration:200,origin:'viewport',x:x-30,y},{type:'pointerUp',button:0}]},
      {type:'pointer',id:'pinch-b',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,origin:'viewport',x:x+80,y},{type:'pointerDown',button:0},{type:'pointerMove',duration:200,origin:'viewport',x:x+110,y},{type:'pointerUp',button:0}]}
    ]);
    await browser.releaseActions();
    expect(await transform()).not.toEqual(before);
    await expect($('.reader h2')).toHaveText('beta');
  });
});
