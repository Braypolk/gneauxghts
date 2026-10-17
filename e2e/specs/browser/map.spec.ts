import { navigateAppTab, openAppNavigation } from '../../support/appNavigation';
import { browser, expect, $, $$ } from '@wdio/globals';
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
      documentKind: 'note', notePath: '/e2e/alpha.md', deleted: removed, source: 'external'
    });
  }, response, deleted);
  if (response.nodes.length) {
    await browser.waitUntil(async () => browser.execute(revision => {
      const map = document.querySelector<HTMLElement>('.atlas-map');
      return map?.dataset.mapRevision === String(revision) && map.dataset.mapMoving === 'false';
    }, response.revision), {timeout: 15_000, timeoutMsg: 'Atlas generation did not settle'});
  }
}

async function showAnimationCloud() {
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
}

describe('Atlas map', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await navigateAppTab('Map');
    await $(beta).waitForDisplayed({ timeout: 30_000 });
  });

  afterEach(async () => { await browser.releaseActions(); });

  it('zooms in and out over empty map space without selecting a note', async () => {
    const point = await browser.execute(() => {
      const rect = document.querySelector('.plot')!.getBoundingClientRect();
      const x = Math.round(rect.left + 8), y = Math.round(rect.top + rect.height / 2);
      if (!document.elementFromPoint(x, y)?.classList.contains('map-background')) {
        throw new Error('Expected the full-map hit surface between graph elements');
      }
      return { x, y };
    });
    const scale = async () => Number((await transform())!.match(/scale\(([^)]+)\)/)![1]);
    const before = await scale();
    await browser.action('wheel').scroll({ ...point, deltaY: 100, deltaX: 0 }).perform();
    await browser.waitUntil(async () => await scale() < before);
    const out = await scale();
    await browser.action('wheel').scroll({ ...point, deltaY: -100, deltaX: 0 }).perform();
    await browser.waitUntil(async () => await scale() > out);
    await expect($('.reader')).not.toExist();
  });

  it('opens the picked note in the editor with double-click', async () => {
    // Keep the clicked left-hand note outside the right-hand reader overlay.
    // Establish Beta through the real workspace so a missing handoff cannot pass
    // by reopening the default Alpha fixture.
    await navigateAppTab('Gneauxght');
    await waitForNote('Alpha note');
    await openRecentNote('Beta note');
    await navigateAppTab('Map');
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

  it('shows strength-filtered connections consistently in edges, labels and reader browsing', async () => {
    const atlas = await atlasSnapshot();
    const sample = atlas.nodes[1];
    atlas.nodes = [atlas.nodes[0], ...Array.from({ length: 20 }, (_, i) => ({
      ...sample, id: `neighbor-${i}`, noteId: `neighbor-${i}`, title: `Neighbor ${i}`,
      fileName: `Neighbor ${i}.md`, x: i % 4 * 100, y: Math.floor(i / 4) * 100
    }))];
    atlas.links = atlas.nodes.slice(1).map((node, i) => ({
      id: `edge-${i}`, sourceId: 'note-alpha', targetId: node.id,
      kind: i === 19 ? 'wikilink' as const : 'semantic' as const,
      score: 0.95 - i * 0.01, strength: i < 12 ? 0.95 - i * 0.01 : 0.2
    }));
    atlas.links.push({ ...atlas.links[19], id: 'duplicate', kind: 'semantic', strength: 0.99 });
    atlas.revision++;
    await publishAtlas(atlas);
    await $('[data-node-id="neighbor-19"]').waitForDisplayed();
    await $('[aria-label="Fit map to view"]').click();
    await $(alpha).click();
    const targets = async () => browser.execute(() => [...document.querySelectorAll('.tile-links path')]
      .map(path => path.getAttribute('data-link-target')));
    const shown = await targets();
    const paths = async () => browser.execute(() => [...document.querySelectorAll('.tile-links path')].map(path => path.getAttribute('d')));
    const routed = await paths();
    expect(routed.some(path => path!.includes('C'))).toBe(true);
    await expect($('input[type="checkbox"]')).toBeChecked();
    expect(shown).toHaveLength(11);
    expect(shown).toContain('neighbor-19');
    expect(shown.filter(id => id === 'neighbor-19')).toHaveLength(1);
    for (let i = 0; i < 10; i++) expect(shown).toContain(`neighbor-${i}`);
    expect(await browser.execute(() => [...document.querySelectorAll('[data-filename-id]')]
      .map(element => element.getAttribute('data-filename-id')).sort())).toEqual(['note-alpha', ...shown].sort());
    await expect($('.browse')).toHaveText(expect.stringContaining('1 / 12'));
    await expect($('.reader-footer')).toHaveText(expect.stringContaining('11 of 20 connections shown'));
    await browser.keys('+');
    expect(await targets()).toEqual(shown);
    expect(await paths()).toEqual(routed);
    // The synthetic unclustered fixture puts Alpha on the map's outer edge;
    // frame it again before the real pointer reselects the note.
    await $('[aria-label="Fit map to view"]').click();
    await $(alpha).click();
    expect(await targets()).toEqual(shown);
    expect(await paths()).toEqual(routed);
    await $('input[type="checkbox"]').click();
    expect((await paths()).every(path => !path!.includes('C'))).toBe(true);
    expect(await targets()).toEqual(shown);
    await $('input[type="checkbox"]').click();
    expect(await paths()).toEqual(routed);
    await $('button=Read full note').click();
    const beforeSlider = await transform();
    const slider = $('#atlas-connection-strength');
    await browser.execute(() => document.querySelector<HTMLInputElement>('#atlas-connection-strength')!.focus());
    await browser.keys('Home');
    expect(await targets()).toHaveLength(20);
    await expect($('.browse')).toHaveText(expect.stringContaining('1 / 21'));
    expect(await $$('[data-filename-id]').length).toBe(21);
    await browser.keys('End');
    expect(await targets()).toEqual(['neighbor-19']);
    await expect($('.browse')).toHaveText(expect.stringContaining('1 / 2'));
    expect(await $$('[data-filename-id]').length).toBe(2);
    await expect(slider).toHaveValue('1');
    await expect($('.reader h2')).toHaveText('alpha');
    await expect($('.full-source')).toHaveText(expect.stringContaining('Alpha line 80'));
    expect(await transform()).toEqual(beforeSlider);
    await $('[aria-label="Use automatic connection strength"]').click();
    expect(await targets()).toEqual(shown);
    expect(await paths()).toEqual(routed);
    await expect($('.browse')).toHaveText(expect.stringContaining('1 / 12'));
    await $('[aria-label="Next Atlas note"]').click();
    await expect($('.reader h2')).toHaveText('Neighbor 19');
    await expect($('.browse')).toHaveText(expect.stringContaining('2 / 12'));
  });

  it('routes a hard connection around an intervening cloud and emphasizes its full path on destination focus', async () => {
    const atlas = await atlasSnapshot();
    atlas.nodes = [
      { ...atlas.nodes[0], x: -220, y: 0, cloudId: 'source', parentCloudId: 'source' },
      { ...atlas.nodes[1], x: 220, y: 0, cloudId: 'target', parentCloudId: 'target' },
      { ...atlas.nodes[1], id: 'obstacle-note', noteId: 'obstacle-note', fileName: 'Obstacle.md', title: 'Obstacle', x: 0, y: 0, cloudId: 'obstacle', parentCloudId: 'obstacle' }
    ];
    atlas.clouds = atlas.nodes.map((node, i): AtlasCloud => {
      const halfWidth = i === 2 ? 70 : 50, halfHeight = i === 2 ? 90 : 60;
      return {
        id: node.cloudId!, parentId: null, level: 0, label: node.cloudId!, labelSource: 'keybert',
        noteCount: 1, density: 1, color: [100, 150, 180, 255], centroid: [node.x, node.y], radius: halfHeight,
        hull: [[node.x - halfWidth, -halfHeight], [node.x + halfWidth, -halfHeight], [node.x + halfWidth, halfHeight], [node.x - halfWidth, halfHeight]],
        memberNodeIds: [node.id], coreNodeIds: [node.id], outlierNodeIds: [], childCloudIds: [], representativeNodeIds: [node.id]
      };
    });
    atlas.links = [{ id: 'hard-route', sourceId: 'note-alpha', targetId: 'note-beta', kind: 'wikilink', strength: 0.01, score: 1 }];
    atlas.revision++;
    await publishAtlas(atlas);
    await $('[data-cloud-id="obstacle"]').waitForDisplayed();
    await $('[aria-label="Fit map to view"]').click();
    await $(alpha).click();
    const edge = $('.tile-links path');
    const routed = await edge.getAttribute('d');
    expect(routed).toContain('C');
    expect(await browser.execute(() => {
      const path = document.querySelector<SVGPathElement>('.tile-links path')!;
      const points = [...document.querySelector<SVGPolygonElement>('[data-cloud-id="obstacle"]')!.points];
      const inside = (p: DOMPoint) => {
        let value = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i], b = points[j];
          if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) value = !value;
        }
        return value;
      };
      return Array.from({ length: 501 }, (_, i) => path.getPointAtLength(path.getTotalLength() * i / 500)).some(inside);
    })).toBe(false);
    await browser.execute(() => document.querySelector<SVGGElement>('[data-filename-id="note-beta"]')!.focus());
    await expect(edge).toHaveAttribute('stroke-width', '2.4');
    expect(await edge.getAttribute('d')).toBe(routed);
    await expect($('.reader h2')).toHaveText('alpha');
  });

  it('draws a shared highway once, highlights its complete route, and preserves it through strength changes', async () => {
    const atlas = await atlasSnapshot();
    atlas.nodes = [
      { ...atlas.nodes[0], x: -240, y: 0, cloudId: 'source', parentCloudId: 'source' },
      { ...atlas.nodes[1], x: 240, y: -40, cloudId: 'target', parentCloudId: 'target' },
      { ...atlas.nodes[1], id: 'note-gamma', noteId: 'note-gamma', title: 'Gamma', fileName: 'Gamma.md', x: 240, y: 80, cloudId: 'target', parentCloudId: 'target' },
      { ...atlas.nodes[1], id: 'unrelated-dot', noteId: 'unrelated-dot', title: 'Unrelated', fileName: 'Unrelated.md', x: 200, y: -25, cloudId: 'target', parentCloudId: 'target' }
    ];
    atlas.clouds = [['source', -240, 0, ['note-alpha']], ['target', 240, 20, ['note-beta', 'note-gamma', 'unrelated-dot']]].map(([id, x, y, members]): AtlasCloud => ({
      id: id as string, parentId: null, level: 0, label: id as string, labelSource: 'keybert',
      noteCount: (members as string[]).length, density: 1, color: [100, 150, 180, 255], centroid: [x as number, y as number], radius: 110,
      hull: [[(x as number) - 90, (y as number) - 110], [(x as number) + 90, (y as number) - 110], [(x as number) + 90, (y as number) + 110], [(x as number) - 90, (y as number) + 110]],
      memberNodeIds: members as string[], coreNodeIds: members as string[], outlierNodeIds: [], childCloudIds: [], representativeNodeIds: members as string[]
    }));
    atlas.links = [
      { id: 'hard-highway', sourceId: 'note-beta', targetId: 'note-alpha', kind: 'wikilink', strength: 0.01, score: 1 },
      { id: 'similar-highway', sourceId: 'note-alpha', targetId: 'note-gamma', kind: 'semantic', strength: 0.95, score: 0.95 }
    ];
    atlas.revision++;
    await publishAtlas(atlas);
    await $('[data-node-id="note-gamma"]').waitForExist();
    await $('[aria-label="Fit map to view"]').click();
    await $(alpha).click();
    const trunk = $('.tile-highways path');
    await expect(trunk).toExist();
    const shared = await trunk.getAttribute('d');
    const hard = $('.tile-links [data-link-source="note-beta"]');
    const full = await hard.getAttribute('data-full-path');
    expect(full!.startsWith(shared!)).toBe(true);
    expect(await browser.execute(() => document.querySelectorAll('.tile-links path').length)).toBe(2);
    expect(await hard.getAttribute('d')).not.toBe(full);
    expect(await browser.execute(() => {
      const dots = [...document.querySelectorAll<SVGCircleElement>('.note-dot .dot-body')];
      let minimum = Infinity;
      for (const edge of document.querySelectorAll<SVGPathElement>('.tile-links path')) {
        const full = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        full.setAttribute('d', edge.getAttribute('data-full-path')!);
        const endpoints = [edge.getAttribute('data-link-source'), edge.getAttribute('data-link-target')];
        for (const dot of dots) {
          if (endpoints.includes(dot.parentElement!.getAttribute('data-node-id'))) continue;
          for (let i = 0; i <= 1000; i++) {
            const p = full.getPointAtLength(full.getTotalLength() * i / 1000);
            minimum = Math.min(minimum, Math.hypot(p.x - dot.cx.baseVal.value, p.y - dot.cy.baseVal.value) - dot.r.baseVal.value);
          }
        }
      }
      return minimum;
    })).toBeGreaterThanOrEqual(5.9);
    await browser.execute(() => document.querySelector<SVGGElement>('[data-filename-id="note-beta"]')!.focus());
    await expect(hard).toHaveAttribute('stroke-width', '2.4');
    expect(await hard.getAttribute('d')).toBe(full);
    await expect($('.reader h2')).toHaveText('alpha');
    await browser.keys('+');
    expect(await trunk.getAttribute('d')).toBe(shared);
    await browser.execute(() => document.querySelector<HTMLInputElement>('#atlas-connection-strength')!.focus());
    await browser.keys('End');
    await expect(trunk).not.toExist();
    expect(await hard.getAttribute('d')).toBe(full);
    expect(await browser.execute(() => document.querySelectorAll('.tile-links path').length)).toBe(1);
    await $('[aria-label="Use automatic connection strength"]').click();
    expect(await trunk.getAttribute('d')).toBe(shared);
    expect(await hard.getAttribute('data-full-path')).toBe(full);
  });

  it('draws nested shared approaches once and keeps the full highlighted route stable', async () => {
    const atlas = await atlasSnapshot();
    const positions: [string, number, number, string][] = [
      ['note-alpha', -400, 0, 'source'], ['note-beta', 400, -25, 'target'],
      ['note-gamma', 420, 25, 'target'], ['note-delta', 300, 190, 'target'], ['note-epsilon', 300, -190, 'target']
    ];
    atlas.nodes = positions.map(([id, x, y, root]) => ({ ...atlas.nodes[id === 'note-alpha' ? 0 : 1],
      id, noteId: id, title: id, fileName: `${id}.md`, x, y, centrality: 0, cloudId: root, parentCloudId: root }));
    atlas.clouds = [['source', -400, 0, 70, 70], ['target', 340, 0, 180, 240]].map(([id, cx, cy, hw, hh]): AtlasCloud => {
      const x = cx as number, y = cy as number, width = hw as number, height = hh as number;
      const members = positions.filter(position => position[3] === id).map(position => position[0]);
      return { id: id as string, parentId: null, level: 0, label: id as string, labelSource: 'keybert',
        noteCount: members.length, density: 1, color: [100, 150, 180, 255], centroid: [x, y], radius: height,
        hull: [[x - width, y - height], [x + width, y - height], [x + width, y + height], [x - width, y + height]],
        memberNodeIds: members, coreNodeIds: members, outlierNodeIds: [], childCloudIds: [], representativeNodeIds: members };
    });
    atlas.links = [
      { id: 'hard', sourceId: 'note-alpha', targetId: 'note-beta', kind: 'wikilink', strength: 0.01, score: 1 },
      ...['note-gamma', 'note-delta'].map(targetId => ({ id: targetId, sourceId: 'note-alpha', targetId, kind: 'semantic' as const, strength: 0.95, score: 0.95 }))
    ];
    atlas.revision++;
    await publishAtlas(atlas);
    await $('[data-node-id="note-gamma"]').waitForExist();
    await $('[aria-label="Fit map to view"]').click();
    await $(alpha).click();
    await browser.waitUntil(async () => await $$('.tile-highways path').length === 2);
    const shared = await browser.execute(() => [...document.querySelectorAll('.tile-highways path')].map(path => path.getAttribute('d')).sort());
    const edge = $('.tile-links [data-link-target="note-beta"]');
    const full = await edge.getAttribute('data-full-path');
    await browser.execute(() => document.querySelector<SVGGElement>('[data-filename-id="note-beta"]')!.focus());
    expect(await edge.getAttribute('d')).toBe(full);
    await browser.execute(() => document.querySelector<HTMLInputElement>('#atlas-connection-strength')!.focus());
    await browser.keys('End');
    await expect($('.tile-highways path')).not.toExist();
    expect(await edge.getAttribute('d')).toBe(full);
    await $('[aria-label="Use automatic connection strength"]').click();
    expect(await browser.execute(() => [...document.querySelectorAll('.tile-highways path')].map(path => path.getAttribute('d')).sort())).toEqual(shared);
    expect(await edge.getAttribute('data-full-path')).toBe(full);
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


  it('closes the reader with Escape while full note source has focus', async () => {
    await $(alpha).click();
    await $('button=Read full note').click();
    await expect($('.full-source')).toHaveText(expect.stringContaining('Alpha line 80'));
    const before = await transform();
    await browser.execute(() => document.querySelector<HTMLElement>('.full-source')!.focus());
    await browser.keys('Escape');
    await expect($('.reader')).not.toExist();
    await expect($('.regions-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect($(alpha)).toHaveAttribute('stroke', 'none');
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
    atlas.worldLayout = true;
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
        noteCount: members.length, density: 1, color: [100, 150, 180, 255], centroid: [x, y], radius: 175,
        hull: Array.from({ length: 384 }, (_, i) => {
          const angle = i / 384 * Math.PI * 2;
          return [x + 175 * Math.cos(angle), y + 175 * Math.sin(angle)];
        }),
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
    // A route remount creates a fresh layout instance; refresh-only tests miss
    // expensive caption searches over the production-sized smooth outlines.
    await navigateAppTab('Gneauxght');
    await expect($('.map-world')).not.toExist();
    await openAppNavigation();
    const reopeningMillis = await browser.execute(async () => {
      const started = performance.now();
      document.querySelector<HTMLAnchorElement>('a[aria-label="Map"]')!.click();
      while (document.querySelectorAll('[data-node-id]').length !== 2000) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return performance.now() - started;
    });
    console.info('Atlas 2,000-note smooth-cloud route re-entry: %s ms', reopeningMillis.toFixed(1));
    expect(reopeningMillis).toBeLessThan(1000);
  });

  it('keeps hover from moving the map while fit, zoom and region focus work', async () => {
    await showAnimationCloud();
    const before = await transform();
    await $(alpha).moveTo();
    await expect($(alpha)).toHaveAttribute('fill-opacity', '1');
    await expect($('.hover-preview')).not.toExist();
    await expect($('.plot svg title')).not.toExist();
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


  it('explores a cloud through its surface and passive caption, while cloud drags only pan', async () => {
    await showAnimationCloud();
    const point = await browser.execute(() => {
      const cloud = document.querySelector('[data-cloud-id="cloud"]')!;
      const box = cloud.getBoundingClientRect();
      for (const y of [0.8, 0.6, 0.4]) for (const x of [0.2, 0.4, 0.6]) {
        const point = { x: Math.round(box.left + box.width * x), y: Math.round(box.top + box.height * y) };
        if (document.elementFromPoint(point.x, point.y) === cloud) return point;
      }
      throw new Error('Expected an unobstructed cloud surface');
    });
    await $(alpha).click();
    const before = await transform();
    await browser.performActions([{type:'pointer',id:'cloud-pan',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',...point},{type:'pointerDown',button:0},
      {type:'pointerMove',duration:200,origin:'viewport',x:point.x+40,y:point.y+25},{type:'pointerUp',button:0}
    ]}]);
    await browser.releaseActions();
    await expect($('.reader h2')).toHaveText('alpha');
    expect(await transform()).not.toEqual(before);
    await $('[aria-label="Fit map to view"]').click();
    // The preceding drag suppresses clicks briefly; wait beyond that gesture.
    await browser.execute(() => new Promise(resolve => setTimeout(resolve, 260)));
    await browser.performActions([{type:'pointer',id:'cloud-click',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',...point},{type:'pointerDown',button:0},{type:'pointerUp',button:0}
    ]}]);
    await browser.releaseActions();
    await expect($('.region-name')).toHaveText('Animation cloud');
    await expect($('.reader')).not.toExist();
    await expect($('.regions-toggle')).toHaveAttribute('aria-expanded', 'true');
    await $('[aria-label="Fit map to view"]').click();
    await $('[aria-label="Collapse Atlas info"]').click();
    const captionPoint = await browser.execute(() => {
      const caption = document.querySelector('.region-caption text')!;
      const box = caption.getBoundingClientRect();
      const point = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
      if (caption.closest('[role="button"]') || document.elementFromPoint(point.x, point.y)?.getAttribute('data-cloud-id') !== 'cloud') {
        throw new Error('Caption must be passive and let the cloud receive the click');
      }
      return point;
    });
    await browser.performActions([{type:'pointer',id:'caption-click',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',...captionPoint},{type:'pointerDown',button:0},{type:'pointerUp',button:0}
    ]}]);
    await browser.releaseActions();
    await expect($('.region-name')).toHaveText('Animation cloud');
  });

  it('animates cloud focus through intermediate camera positions and lets Fit map interrupt it', async () => {
    await showAnimationCloud();
    const before = await transform();
    const frames = await browser.execute(async () => {
      const world = document.querySelector('.map-world')!;
      document.querySelector('[data-cloud-id="cloud"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const frames = [world.getAttribute('transform')];
      const start = performance.now();
      while (performance.now() - start < 420) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        frames.push(world.getAttribute('transform'));
      }
      return frames;
    });
    expect(frames[0]).toBe(before);
    expect(new Set(frames).size).toBeGreaterThan(4);
    expect(frames.at(-1)).not.toBe(before);
    expect(frames.at(-1)).toBe(frames.at(-2));
    await $('[aria-label="Fit map to view"]').click();
    const stopped = await browser.execute(async () => {
      const world = document.querySelector('.map-world')!;
      document.querySelector('[data-cloud-id="cloud"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 80));
      document.querySelector<HTMLButtonElement>('[aria-label="Fit map to view"]')!.click();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const fitted = world.getAttribute('transform');
      await new Promise(resolve => setTimeout(resolve, 350));
      return { fitted, later: world.getAttribute('transform') };
    });
    expect(stopped.fitted).toBe(before);
    expect(stopped.later).toBe(before);
  });

  it('fits a cloud immediately when reduced motion is requested', async () => {
    await showAnimationCloud();
    const before = await transform();
    const frames = await browser.execute(async () => {
      const matchMedia = window.matchMedia;
      window.matchMedia = (query) => query === '(prefers-reduced-motion: reduce)'
        ? { ...matchMedia.call(window, query), matches: true } as MediaQueryList : matchMedia.call(window, query);
      try {
        document.querySelector('[data-cloud-id="cloud"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const focused = document.querySelector('.map-world')!.getAttribute('transform');
        await new Promise(resolve => setTimeout(resolve, 350));
        return { focused, later: document.querySelector('.map-world')!.getAttribute('transform') };
      } finally { window.matchMedia = matchMedia; }
    });
    expect(frames.focused).not.toBe(before);
    expect(frames.later).toBe(frames.focused);
  });

  it('keeps note taps selectable and supports two-pointer pinch', async () => {
    await $('[aria-label="Fit map to view"]').click();
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

  it('deselects on an empty canvas click while retaining the panel and strength setting, but preserves selection when panning', async () => {
    await $(alpha).click();
    await $('button=Read full note').click();
    await expect($('.full-source')).toHaveText(expect.stringContaining('Alpha line 80'));
    await browser.execute(() => document.querySelector<HTMLInputElement>('#atlas-connection-strength')!.focus());
    await browser.keys('End');
    const before = await transform();
    const point = await browser.execute(() => {
      const rect = document.querySelector('.plot')!.getBoundingClientRect();
      const x = Math.round(rect.left + 8), y = Math.round(rect.top + rect.height / 2);
      if (!document.elementFromPoint(x, y)?.classList.contains('map-background')) throw new Error('Expected empty canvas');
      return { x, y };
    });
    await browser.performActions([{type:'pointer',id:'deselect',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',...point},{type:'pointerDown',button:0},{type:'pointerUp',button:0}
    ]}]);
    await browser.releaseActions();
    await expect($('.reader')).not.toExist();
    await expect($('.region-guide')).toExist();
    await expect($('.regions-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect($('#atlas-connection-strength')).toHaveValue('1');
    expect(await browser.execute(() => document.querySelectorAll('[data-filename-id]').length)).toBe((await atlasSnapshot()).nodes.length);
    expect(await browser.execute(() => document.querySelectorAll('.tile-links path').length)).toBe(0);
    expect(await transform()).toEqual(before);
    await $(alpha).click();
    await browser.performActions([{type:'pointer',id:'pan-selected',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',...point},{type:'pointerDown',button:0},
      {type:'pointerMove',duration:200,origin:'viewport',x:point.x+70,y:point.y+40},{type:'pointerUp',button:0}
    ]}]);
    await browser.releaseActions();
    await expect($('.reader h2')).toHaveText('alpha');
    expect(await transform()).not.toEqual(before);
  });

  it('deselects without opening a note when empty map space is double-clicked', async () => {
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
    await expect($('.reader')).not.toExist();
    expect(await browser.execute(() => window.getSelection()?.toString())).toBe('');
  });

  it('pans from a filename without selecting text or opening the reader', async () => {
    await $('button[aria-label="Fit map to view"]').click();
    await browser.waitUntil(async () => (await $('.atlas-map').getAttribute('data-map-moving')) !== 'true');
    const before = await transform();
    const label = await $('[data-filename-id="note-alpha"] text');
    const point = await browser.execute(() => {
      const rect = document.querySelector('[data-filename-id="note-alpha"] text')!.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    });
    await label.waitForDisplayed();
    await browser.performActions([{type:'pointer',id:'label-drag',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',...point},{type:'pointerDown',button:0},
      {type:'pointerMove',duration:200,origin:'viewport',x:point.x+70,y:point.y+40},{type:'pointerUp',button:0}
    ]}]);
    await browser.releaseActions();
    expect(await transform()).not.toEqual(before);
    expect(await browser.execute(() => window.getSelection()?.toString())).toBe('');
    await expect($('.reader')).not.toExist();
  });

  it('redirects prototype bookmarks to the main map', async () => {
    await browser.url('/map/prototype?variant=fusion');
    await expect(browser).toHaveUrl(expect.stringMatching(/\/map$/));
    await $(beta).waitForDisplayed();
  });

});

describe('Atlas continuity controls', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await navigateAppTab('Map');
    await $(beta).waitForDisplayed({timeout:30_000});
  });
  it('names a cloud durably through refresh and restores its automatic name', async () => {
    await showAnimationCloud();
    await $('[data-region-id="cloud"]').click();
    await $('button=Name cloud').click();
    await $('#atlas-region-name').setValue('Kitchen garden');
    await $('button=Save name').click();
    await expect($('.region-name')).toHaveText('Kitchen garden');
    const saved = await atlasSnapshot();
    expect(saved.clouds[0].userName).toBe('Kitchen garden');
    saved.revision++;
    await publishAtlas(saved);
    await expect($('.region-name')).toHaveText('Kitchen garden');
    await $('button=Use automatic name').click();
    await expect($('.region-name')).toHaveText('Animation cloud');
  });
  it('keeps accepted world coordinates when an unrelated distant note appears', async () => {
    const atlas = await atlasSnapshot();
    atlas.worldLayout=true;atlas.revision++;
    await publishAtlas(atlas);
    const x=await $(alpha).getAttribute('cx');
    const camera=await transform();
    atlas.nodes.push({...atlas.nodes[1],id:'distant',noteId:'distant',x:10000,y:10000});
    atlas.revision++;
    await publishAtlas(atlas);
    expect(await $(alpha).getAttribute('cx')).toBe(x);
    expect(await transform()).toBe(camera);
  });
  it('shows subthemes and lets a child retain its name and identity after promotion', async () => {
    await showAnimationCloud();
    const atlas = await atlasSnapshot();
    atlas.worldLayout=true;
    const child: AtlasCloud={...atlas.clouds[0],id:'subtheme',parentId:'cloud',level:1,label:'Vegetables',
      memberNodeIds:[atlas.nodes[0].id],coreNodeIds:[atlas.nodes[0].id],noteCount:1,childCloudIds:[],
      centroid:[-100,0],radius:80,hull:[[-180,-70],[-20,-70],[-20,70],[-180,70]]};
    atlas.clouds[0].childCloudIds=['subtheme'];atlas.clouds.push(child);
    atlas.nodes[0].childCloudId='subtheme';atlas.nodes[0].parentCloudId='cloud';atlas.revision++;
    await publishAtlas(atlas);
    await $('[data-region-id="cloud"]').click();
    await $('.region-children button').click();
    await expect($('.region-name')).toHaveText('Vegetables');
    child.parentId=null;child.level=0;child.familyId='cloud';atlas.clouds[0].childCloudIds=[];
    atlas.clouds[0].memberNodeIds=atlas.clouds[0].memberNodeIds.filter(id=>id!==atlas.nodes[0].id);
    atlas.nodes[0].cloudId='subtheme';atlas.nodes[0].parentCloudId=null;atlas.nodes[0].childCloudId=null;
    atlas.revision++;await publishAtlas(atlas);
    await expect($('.region-name')).toHaveText('Vegetables');
    await expect($('[data-cloud-id="subtheme"]')).toBeDisplayed();
  });
});
