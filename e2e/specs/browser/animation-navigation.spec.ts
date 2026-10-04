import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace, openRecentNote, waitForNote } from '../../support/browserWorkspace';
import type { VaultAtlasResponse } from '../../../src/lib/types/atlas';

async function ready() {
  await resetBrowserWorkspace();
}

describe('navigation motion ownership', () => {
  afterEach(async () => {
    await browser.execute(() => (window as any).__restoreAtlasInvoke?.());
  });


  it('reveals a task destination outside the mounted editor viewport after route navigation', async () => {
    await ready();
    const target = 'Offscreen task destination canary';
    const markdown = Array.from({ length: 350 }, (_, i) => `Paragraph ${i} fills the long note.`).join('\n\n') + `\n\n- [ ] ${target}`;
    await browser.executeAsync(async (body: string, done: (error: string | null) => void) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('save_note', { currentPath: '/e2e/alpha.md', title: 'Alpha note', markdown: body });
        done(null);
      } catch (error) { done(String(error)); }
    }, markdown).then(error => expect(error).toBeNull());
    await openRecentNote('Beta note');
    await openRecentNote('Alpha note');
    expect(await browser.execute((text: string) => document.querySelector('[data-testid="note-editor"] .cm-content')!.textContent!.includes(text), target)).toBe(false);
    await $('a[href="/list"]').click();
    const task = await $(`button[aria-label="Open task: ${target}"]`);
    await task.waitForClickable();
    await task.click();
    await waitForNote('Alpha note');
    await browser.waitUntil(async () => browser.execute((text: string) => {
      const root = document.querySelector<HTMLElement>('[data-testid="note-editor"]')!;
      const scroller = root.querySelector<HTMLElement>('.cm-scroller')!;
      const line = [...root.querySelectorAll<HTMLElement>('.cm-line')].find(line => line.textContent?.includes(text));
      if (!line) return false;
      const viewport = scroller.getBoundingClientRect();
      const destination = line.getBoundingClientRect();
      return scroller.scrollTop > 0 && destination.top >= viewport.top && destination.bottom <= viewport.bottom;
    }, target), { timeoutMsg: 'Expected the unmounted task destination to become visible in the editor viewport' });
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes.find(note => note.noteId === 'note-alpha')!.markdown)).toBe(markdown);
  });

  it('updates map layers once per hover while keeping camera controls working', async () => {
    await ready();
    const fixture: VaultAtlasResponse = {
      status: 'ready', reason: null, revision: 1, generatedAtMillis: 1,
      structuralGeneration: 'animation-fixture', labelGeneration: 'animation-labels',
      publishedAtMillis: 1, stale: false, publishInProgress: false,
      links: [],
      nodes: [0, 1].map(index => ({
        id: `node-${index}`, noteId: `note-${index}`, notePath: `/e2e/node-${index}.md`,
        title: `Map note ${index}`, fileName: `node-${index}.md`, documentKind: 'note',
        x: index * 200 - 100, y: 0, radius: 8, cloudId: 'cloud', parentCloudId: null,
        childCloudId: null, clusterId: null, subclusterId: null, centrality: 0,
        importance: 0.5, lastViewedAtMillis: null, createdAtMillis: 1, updatedAtMillis: 1,
        preview: 'Map animation fixture', tags: [], isolated: false
      })),
      clouds: [{
        id: 'cloud', parentId: null, level: 0, label: 'Animation cloud', labelSource: 'keybert',
        noteCount: 2, density: 1, color: [100, 120, 160, 255], centroid: [0, 0], radius: 100,
        hull: [[-150, -100], [150, -100], [150, 100], [-150, 100]],
        memberNodeIds: ['node-0', 'node-1'], coreNodeIds: ['node-0', 'node-1'],
        outlierNodeIds: [], childCloudIds: [], representativeNodeIds: ['node-0']
      }]
    };
    await browser.execute(fixture => {
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const original = native.invoke;
      (window as any).__restoreAtlasInvoke = () => { native.invoke = original; delete (window as any).__restoreAtlasInvoke; };
      native.invoke = async (cmd, args) => {
        if (cmd === 'get_vault_atlas') return fixture;
        if (cmd === 'search_vault_atlas') return { status: 'ready', reason: null, query: '', generatedAtMillis: 1, matches: [] };
        return original(cmd, args);
      };
    }, fixture);
    try {
      await $('a[aria-label="Map"]').click();
      await $('.atlas-surface canvas').waitForDisplayed({ timeout: 30_000 });
      await browser.pause(400);
      const result = await browser.executeAsync(async (done: (result: {
        updates: number; layers: number; before: number; after: number; focusZoom: number; error?: string
      }) => void) => {
        try {
          const modulePath = '/src/lib/e2e/browserModules.ts';
          const { Deck } = await import(modulePath);
          const original = Deck.prototype.setProps;
          let instance: any;
          let updates = 0;
          Deck.prototype.setProps = function(props: any) {
            instance = this;
            if (props.layers) updates += 1;
            return original.call(this, props);
          };
          const settle = () => new Promise<void>((resolve, reject) => {
            let frame = 0;
            const timer = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error('Map animation frames stalled')); }, 2000);
            frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); }); });
          });
          try {
            document.querySelector<HTMLElement>('button[aria-label="Fit map to view"]')!.click();
            await settle();
            const before = instance.props.viewState.zoom;
            updates = 0;
            const cloudLayer = instance.props.layers.find((layer: any) => layer.id === 'atlas-cloud-fills');
            const cloud = cloudLayer.props.data[0];
            cloudLayer.props.onHover({ object: cloud });
            await settle();
            const hoverUpdates = updates;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
            await settle();
            const after = instance.props.viewState.zoom;
            instance.props.layers.find((layer: any) => layer.id === 'atlas-cloud-fills').props.onClick({ object: cloud });
            await settle();
            [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Focus cloud'))!.click();
            await settle();
            done({ updates: hoverUpdates, layers: instance.props.layers.length, before, after, focusZoom: instance.props.viewState.zoom });
          } finally {
            Deck.prototype.setProps = original;
          }
        } catch (error) {
          done({ updates: 0, layers: 0, before: 0, after: 0, focusZoom: 0, error: String(error) });
        }
      });
      expect(result.error).toBeUndefined();
      expect(result.updates).toBe(1);
      expect(result.layers).toBeGreaterThan(0);
      expect(result.after).toBeGreaterThan(result.before);
      expect(result.focusZoom).toBeGreaterThanOrEqual(1.2);
    } finally {
      await browser.execute(() => (window as any).__restoreAtlasInvoke?.());
    }
  });
});
