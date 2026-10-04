import { browser, expect, $ } from '@wdio/globals';
import { openRecentNote, resetBrowserWorkspace, waitForNote } from '../../support/browserWorkspace';
import type { AtlasCloud, VaultAtlasResponse } from '../../../src/lib/types/atlas';

const alpha = '[data-node-id="note-alpha"] .dot-body';
const beta = '[data-node-id="note-beta"] .dot-body';
async function transform() { return $('.map-world').getAttribute('transform'); }

async function atlasSnapshot() {
  return browser.execute(async () => {
    const native = window.__TAURI_INTERNALS__ as {
      invoke(command: 'get_vault_atlas', args: Record<string, never>): Promise<VaultAtlasResponse>;
    };
    return native.invoke('get_vault_atlas', {});
  });
}

async function publishAtlas(response: VaultAtlasResponse, deleted = false) {
  await browser.execute((atlas, removed) => {
    window.__GNEAUXGHTS_E2E__!.setAtlas(atlas);
    window.__GNEAUXGHTS_E2E__!.emit('vault-note-changed', {
      documentKind: 'note', notePath: '/e2e/alpha.md', deleted: removed, source: 'external', chatId: null
    });
  }, response, deleted);
}

describe('Atlas map', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await $('a[aria-label="Map"]').click();
    await $(beta).waitForDisplayed({ timeout: 30_000 });
  });

  afterEach(async () => { await browser.releaseActions(); });

  it('opens the picked note in the editor with double-click', async () => {
    // Keep the clicked left-hand note outside the right-hand reader overlay.
    // Establish Beta through the real workspace so a missing handoff cannot pass
    // by reopening the default Alpha fixture.
    await $('a[href="/"]').click();
    await waitForNote('Alpha note');
    await openRecentNote('Beta note');
    await $('a[aria-label="Map"]').click();
    await $(beta).waitForDisplayed();
    await $(beta).click();
    await expect($('.reader h2')).toHaveText('beta');
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().activeNoteId)).toBe('note-beta');
    await $(alpha).doubleClick();
    await waitForNote('Alpha note');
  });

  it('opens the selected note with Enter and the reader button', async () => {
    await $(beta).click();
    await browser.keys('Enter');
    await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
    await browser.url('/map');
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
    const atlas = await atlasSnapshot();
    atlas.nodes = atlas.nodes.filter(node => node.id !== 'note-alpha');
    atlas.revision++;
    await publishAtlas(atlas, true);
    await $(alpha).waitForExist({ reverse: true });
    await expect($('.reader')).not.toExist();
    await expect($('[data-filename-id="note-beta"]')).toExist();
    expect(await transform()).toEqual(before);
  });


  it('invalidates loaded source when a selected note changes', async () => {
    await $(alpha).click();
    await $('button=Read full note').click();
    await expect($('.full-source')).toHaveText(expect.stringContaining('Alpha line 80'));
    const before = await transform();
    const atlas = await atlasSnapshot();
    const selected = atlas.nodes.find(node => node.id === 'note-alpha')!;
    selected.preview = 'Changed note excerpt';
    selected.updatedAtMillis++;
    atlas.revision++;
    await publishAtlas(atlas);
    await expect($('.reader-excerpt')).toHaveText('Changed note excerpt');
    await expect($('.full-source')).not.toExist();
    expect(await transform()).toEqual(before);
  });


  it('reports empty and unavailable responses without substituting demo notes', async () => {
    const atlas = await atlasSnapshot();
    const empty = { ...atlas, nodes: [], clouds: [], links: [], status: 'empty' as const };
    await publishAtlas(empty);
    await expect($('.loading strong')).toHaveText('No map yet');
    await publishAtlas({ ...empty, status: 'unavailable', reason: 'Indexing unavailable' });
    await expect($('.loading strong')).toHaveText('Semantic map unavailable');
    await expect($('.loading p')).toHaveText('Indexing unavailable');
    await expect($('.map-world')).not.toExist();
  });


  it('renders and navigates a larger vault without dropping notes', async () => {
    const atlas = await atlasSnapshot();
    const sample = atlas.nodes[0];
    atlas.nodes = Array.from({ length: 2000 }, (_, i) => {
      const root = i % 18;
      const offset = Math.floor(i / 18);
      const angle = offset * 2.399963;
      const radius = 15 * Math.sqrt(offset);
      return {
        ...sample, id: `large-${i}`, noteId: `large-${i}`, notePath: `/e2e/large-${i}.md`,
        fileName: `Note ${i}.md`, cloudId: `root-${root}`, parentCloudId: `root-${root}`,
        x: root % 6 * 300 + Math.cos(angle) * radius,
        y: Math.floor(root / 6) * 300 + Math.sin(angle) * radius
      };
    });
    atlas.clouds = Array.from({ length: 18 }, (_, root): AtlasCloud => {
      const x = root % 6 * 300;
      const y = Math.floor(root / 6) * 300;
      const members = atlas.nodes.filter(node => node.cloudId === `root-${root}`).map(node => node.id);
      return {
        id: `root-${root}`, parentId: null, level: 0, label: `Region ${root}`, labelSource: 'keybert',
        noteCount: members.length, density: 1, color: [100, 150, 180, 255], centroid: [x, y], radius: 110,
        hull: [[x - 110, y - 100], [x + 110, y - 100], [x + 110, y + 100], [x - 110, y + 100]],
        memberNodeIds: members, coreNodeIds: members, outlierNodeIds: [], childCloudIds: [], representativeNodeIds: members.slice(0, 3)
      };
    });
    atlas.revision++;
    atlas.labelGeneration = 'large-labels';
    await publishAtlas(atlas);
    await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('[data-node-id]').length === 2000), { timeout: 15_000 });
    expect(await browser.execute(() => document.querySelectorAll('[data-filename-id]').length)).toBe(2000);
    const before = await transform();
    await browser.keys('+');
    expect(await transform()).not.toEqual(before);
    await $('[aria-label="Fit map to view"]').click();
    expect(await browser.execute(() => document.querySelectorAll('[data-node-id]').length)).toBe(2000);
  });

  it('keeps hover from moving the map while fit, zoom and region focus work', async () => {
    const atlas = await atlasSnapshot();
    const members = atlas.nodes.map(node => node.id);
    atlas.nodes = atlas.nodes.map(node => ({ ...node, cloudId: 'cloud', parentCloudId: 'cloud' }));
    atlas.clouds = [{
      id: 'cloud', parentId: null, level: 0, label: 'Animation cloud', labelSource: 'keybert',
      noteCount: members.length, density: 1, color: [100, 120, 160, 255], centroid: [0, 0], radius: 250,
      hull: [[-250, -100], [250, -100], [250, 100], [-250, 100]],
      memberNodeIds: members, coreNodeIds: members, outlierNodeIds: [], childCloudIds: [], representativeNodeIds: [members[0]]
    }];
    atlas.revision++;
    atlas.labelGeneration = 'animation-labels';
    await publishAtlas(atlas);
    await $('[data-region-id="cloud"]').waitForDisplayed();
    await $('[aria-label="Fit map to view"]').click();
    const before = await transform();
    await $(alpha).moveTo();
    await expect($('.hover-preview strong')).toHaveText('Alpha note');
    expect(await transform()).toEqual(before);
    await $(alpha).click();
    await browser.keys('+');
    expect(await transform()).not.toEqual(before);
    await $('[aria-label="Fit map to view"]').click();
    expect(await transform()).toEqual(before);
    await browser.execute(() => document.querySelector<SVGGElement>('[data-region-id="cloud"]')!.focus());
    await browser.keys('Enter');
    await expect(browser).toHaveUrl(expect.stringMatching(/\/map$/));
    await expect($('.region-name')).toHaveText('Animation cloud');
    await expect($('.reader')).not.toExist();
    expect(await transform()).not.toEqual(before);
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

  it('does not open a selected note when empty map space is double-clicked', async () => {
    await $(alpha).click();
    await expect($('.reader h2')).toHaveText('alpha');
    const location = await $('.plot svg').getLocation();
    await browser.performActions([{type:'pointer',id:'empty-double-click',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',x:Math.round(location.x+20),y:Math.round(location.y+20)},
      {type:'pointerDown',button:0},{type:'pointerUp',button:0},{type:'pause',duration:50},
      {type:'pointerDown',button:0},{type:'pointerUp',button:0}
    ]}]);
    await browser.releaseActions();
    await expect(browser).toHaveUrl(expect.stringMatching(/\/map$/));
    await expect($('.reader h2')).toHaveText('alpha');
  });

  it('redirects prototype bookmarks to the main map', async () => {
    await browser.url('/map/prototype?variant=fusion');
    await expect(browser).toHaveUrl(expect.stringMatching(/\/map$/));
    await $(beta).waitForDisplayed();
  });

});
