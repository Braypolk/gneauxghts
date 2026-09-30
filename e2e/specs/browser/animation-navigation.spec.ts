import { browser, expect, $ } from '@wdio/globals';
import type { VaultAtlasResponse } from '../../../src/lib/types/atlas';

async function ready() {
  await browser.setWindowSize(1440, 1000);
  await browser.url('/');
  await $('[data-testid="note-editor"] .cm-content').waitForDisplayed({ timeout: 30_000 });
  await browser.pause(400);
}

describe('navigation motion ownership', () => {
  it('uses one scroll owner for editor targets and respects reduced motion', async () => {
    await ready();
    const result = await browser.executeAsync(async (done: (result: {
      selectionScrolls: boolean[]; targetBehaviors: string[]; lineBehaviors: string[]; error?: string
    }) => void) => {
      try {
        const navigationPath = '/src/lib/features/notepad/navigation/navigation.ts';
        const navigation = await import(navigationPath);
        const viewPath = performance.getEntriesByType('resource').find(entry => entry.name.includes('/@codemirror_view.js'))!.name;
        const { EditorView } = await import(viewPath);
        const root = document.querySelector<HTMLElement>('[data-testid="note-editor"]')!;
        const view = EditorView.findFromDOM(root.querySelector('.cm-content'));
        const target = root.querySelector<HTMLElement>('.cm-line')!;
        const selectionScrolls: boolean[] = [];
        const targetBehaviors: string[] = [];
        const lineBehaviors: string[] = [];
        const originalDispatch = view.dispatch;
        const originalTargetScroll = target.scrollIntoView;
        const originalLineScroll = view.scrollDOM.scrollTo;
        const originalMatchMedia = window.matchMedia;
        try {
          window.matchMedia = query => {
            const media = originalMatchMedia.call(window, query);
            if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(media, 'matches', { value: true });
            return media;
          };
          view.dispatch = (...args: any[]) => {
            selectionScrolls.push(args[0].scrollIntoView ?? false);
            originalDispatch(...args);
          };
          target.scrollIntoView = options => targetBehaviors.push((options as ScrollIntoViewOptions).behavior!);
          view.scrollDOM.scrollTo = (options: ScrollToOptions) => lineBehaviors.push(options.behavior!);
          navigation.focusEditorTarget(root, target);
          navigation.focusEditorAtDocumentLine(root, 1);
        } finally {
          view.dispatch = originalDispatch;
          target.scrollIntoView = originalTargetScroll;
          view.scrollDOM.scrollTo = originalLineScroll;
          window.matchMedia = originalMatchMedia;
        }
        done({ selectionScrolls, targetBehaviors, lineBehaviors });
      } catch (error) {
        done({ selectionScrolls: [], targetBehaviors: [], lineBehaviors: [], error: String(error) });
      }
    });
    expect(result.error).toBeUndefined();
    expect(result.selectionScrolls).toEqual([false, false]);
    expect(result.targetBehaviors).toEqual(['instant']);
    expect(result.lineBehaviors).toEqual(['instant']);
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
      performance.setResourceTimingBufferSize(3000);
      performance.clearResourceTimings();
      const native = window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const original = native.invoke;
      native.invoke = async (cmd, args) => {
        if (cmd === 'get_vault_atlas') return fixture;
        if (cmd === 'search_vault_atlas') return { status: 'ready', reason: null, query: '', generatedAtMillis: 1, matches: [] };
        return original(cmd, args);
      };
    }, fixture);
    await $('a[aria-label="Map"]').click();
    await $('.atlas-surface canvas').waitForDisplayed({ timeout: 30_000 });
    await browser.pause(400);
    const result = await browser.executeAsync(async (done: (result: {
      updates: number; layers: number; before: number; after: number; focusZoom: number; error?: string
    }) => void) => {
      try {
        const corePath = performance.getEntriesByType('resource').find(entry => /deck.*core.*\.js/.test(entry.name))!.name;
        const { Deck } = await import(corePath);
        const original = Deck.prototype.setProps;
        let instance: any;
        let updates = 0;
        Deck.prototype.setProps = function(props: any) {
          instance = this;
          if (props.layers) updates += 1;
          return original.call(this, props);
        };
        const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
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
  });
});
