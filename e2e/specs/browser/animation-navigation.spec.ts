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

  it('keeps hover from moving the map while fit, zoom and region focus work', async () => {
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
    const node = $('[data-node-id="node-0"] .dot-body');
    await node.waitForDisplayed({ timeout: 30_000 });
    const before = await $('.map-world').getAttribute('transform');
    await node.moveTo();
    await expect($('.hover-preview strong')).toHaveText('Map note 0');
    expect(await $('.map-world').getAttribute('transform')).toEqual(before);
    await node.click();
    await browser.keys('+');
    expect(await $('.map-world').getAttribute('transform')).not.toEqual(before);
    await $('[aria-label="Fit map to view"]').click();
    expect(await $('.map-world').getAttribute('transform')).toEqual(before);
    await browser.execute(() => document.querySelector<SVGGElement>('[data-region-id="cloud"]')!.focus());
    await browser.keys('Enter');
    await expect(browser).toHaveUrl(expect.stringMatching(/\/map$/));
    await expect($('.region-name')).toHaveText('Animation cloud');
    await expect($('.reader')).not.toExist();
    expect(await $('.map-world').getAttribute('transform')).not.toEqual(before);
  });
});
