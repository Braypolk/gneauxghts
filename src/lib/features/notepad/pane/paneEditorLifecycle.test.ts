import { describe, expect, it, vi } from 'vitest';

import { createPaneEditorLifecycle } from './paneEditorLifecycle';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

describe('paneEditorLifecycle', () => {
  for (const transition of ['mount', 'bind'] as const) {
    it(`cancels presentation when disposed during ${transition} measurement`, async () => {
      const document = createNoteDraftState(createEmptySessionSnapshot());
      const runtime = {
        controller: null as unknown | null,
        refs: { editorRoot: {} },
        setIsEditorReady: vi.fn()
      };
      let release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      let entered!: () => void;
      const measuring = new Promise<void>(resolve => { entered = resolve; });
      let ready = false;
      let presentations = 0;
      const onEditorMounted = vi.fn();
      const lifecycle = createPaneEditorLifecycle({
        getPaneIds: () => ['pane'],
        getPaneRuntime: () => runtime as never,
        getEditorLifecycleController: () => ({
          createEditor: async () => { runtime.controller = { view: {} }; },
          swapEditorBuffer: async () => { ready = false; return true; },
          destroyEditor: async () => { runtime.controller = null; },
          finishEditorPresentation: async (_document: unknown, { isCurrent }: { isCurrent: () => boolean }) => {
            if (++presentations === (transition === 'mount' ? 1 : 2)) {
              entered();
              await barrier;
            }
            if (!isCurrent()) return false;
            ready = true;
            return true;
          }
        }) as never,
        getPaneDocument: () => document,
        paneShouldMountEditor: () => true,
        onEditorMounted,
        closeWikilinkAutocomplete: vi.fn()
      });
      if (transition === 'bind') await lifecycle.mountPaneEditor('pane');
      const operation = transition === 'mount'
        ? lifecycle.mountPaneEditor('pane')
        : lifecycle.bindDocument('pane', document);
      await measuring;
      const disposal = lifecycle.disposePane('pane');
      release();
      await expect(operation).resolves.toBe('disposed');
      await disposal;
      expect(runtime.controller).toBeNull();
      expect(ready).toBe(false);
      expect(onEditorMounted).toHaveBeenCalledTimes(transition === 'mount' ? 0 : 1);
    });
  }

  it('restores an exact captured view state through the serialized pane owner', async () => {
    const document = createNoteDraftState(createEmptySessionSnapshot());
    const restoreEditorViewStateForDocument = vi.fn().mockResolvedValue(true);
    const runtime = {
      controller: null as unknown | null,
      refs: { editorRoot: {} }
    };
    const lifecycle = createPaneEditorLifecycle({
      getPaneIds: () => ['pane'],
      getPaneRuntime: () => runtime as never,
      getEditorLifecycleController: () =>
        ({
          createEditor: async () => {
            runtime.controller = { view: {} };
          },
          finishEditorPresentation: vi.fn(async () => true),
          restoreCursorPositionForDocument: vi.fn(),
          restoreEditorViewStateForDocument
        }) as never,
      getPaneDocument: () => document,
      paneShouldMountEditor: () => true,
      closeWikilinkAutocomplete: vi.fn()
    });
    const viewState = { anchor: 18, head: 7, scrollTop: 640 };
    await lifecycle.mountPaneEditor('pane');

    await expect(
      lifecycle.restoreViewState('pane', document, viewState)
    ).resolves.toBe('applied');

    expect(restoreEditorViewStateForDocument).toHaveBeenCalledWith(document, viewState);
  });

  it('discovers panes dynamically when ensuring editors', async () => {
    type PaneId = 'pane-1' | 'pane-2';
    const paneIds: PaneId[] = ['pane-1'];
    const documents = {
      'pane-1': createNoteDraftState({ ...createEmptySessionSnapshot(), bodyMarkdown: 'one' }),
      'pane-2': createNoteDraftState({ ...createEmptySessionSnapshot(), bodyMarkdown: 'two' })
    };
    const runtimes: Record<
      PaneId,
      { controller: unknown | null; refs: { editorRoot: object } }
    > = {
      'pane-1': { controller: null, refs: { editorRoot: {} } },
      'pane-2': { controller: null, refs: { editorRoot: {} } }
    };
    const createEditor = vi.fn(async (paneId: PaneId) => {
      runtimes[paneId].controller = { paneId };
    });

    const lifecycle = createPaneEditorLifecycle({
      getPaneIds: () => paneIds,
      getPaneRuntime: (paneId: PaneId) => runtimes[paneId] as never,
      getEditorLifecycleController: (paneId: PaneId) =>
        ({
          createEditor: () => createEditor(paneId),
          destroyEditor: vi.fn(),
          finishEditorPresentation: vi.fn(async () => true),
          restoreCursorPositionForDocument: vi.fn(),
          saveCursorPositionForDocument: vi.fn()
        }) as never,
      getPaneDocument: (paneId: PaneId) => documents[paneId],
      paneShouldMountEditor: () => true,
      closeWikilinkAutocomplete: vi.fn()
    });

    await lifecycle.ensurePaneEditors();
    paneIds.push('pane-2');
    await lifecycle.ensurePaneEditors();

    expect(createEditor).toHaveBeenCalledWith('pane-1');
    expect(createEditor).toHaveBeenCalledWith('pane-2');
  });

  it('serializes an immediate mount then dispose without leaving a controller', async () => {
    const document = createNoteDraftState(createEmptySessionSnapshot());
    const runtime = {
      controller: null as unknown | null,
      refs: { editorRoot: {} },
      setIsEditorReady: vi.fn()
    };
    const destroyEditor = vi.fn(async () => {
      runtime.controller = null;
    });
    const lifecycle = createPaneEditorLifecycle({
      getPaneIds: () => ['pane'],
      getPaneRuntime: () => runtime as never,
      getEditorLifecycleController: () =>
        ({
          createEditor: async () => {
            runtime.controller = { paneId: 'pane' };
          },
          destroyEditor,
          finishEditorPresentation: vi.fn(async () => true),
          restoreCursorPositionForDocument: vi.fn(),
          saveCursorPositionForDocument: vi.fn()
        }) as never,
      getPaneDocument: () => document,
      paneShouldMountEditor: () => true,
      closeWikilinkAutocomplete: vi.fn()
    });

    const mounting = lifecycle.mountPaneEditor('pane');
    const disposing = lifecycle.disposePane('pane');
    await Promise.all([mounting, disposing]);

    expect(runtime.controller).toBeNull();
    expect(destroyEditor).toHaveBeenCalledTimes(0);
  });

  it('invalidates an in-flight mount before disposal completes', async () => {
    const document = createNoteDraftState(
      createEmptySessionSnapshot()
    );
    const runtime = {
      controller: null as unknown | null,
      refs: { editorRoot: {} },
      setIsEditorReady: vi.fn()
    };
    let releaseMount!: () => void;
    const mountBarrier = new Promise<void>((resolve) => {
      releaseMount = resolve;
    });
    let markMountStarted!: () => void;
    const mountStarted = new Promise<void>((resolve) => {
      markMountStarted = resolve;
    });
    const destroyEditor = vi.fn(async () => {
      runtime.controller = null;
    });
    const lifecycle = createPaneEditorLifecycle({
      getPaneIds: () => ['pane'],
      getPaneRuntime: () => runtime as never,
      getEditorLifecycleController: () =>
        ({
          createEditor: async () => {
            markMountStarted();
            await mountBarrier;
            runtime.controller = { paneId: 'pane' };
          },
          destroyEditor,
          finishEditorPresentation: vi.fn(async () => true),
          restoreCursorPositionForDocument: vi.fn(),
          saveCursorPositionForDocument: vi.fn()
        }) as never,
      getPaneDocument: () => document,
      paneShouldMountEditor: () => true,
      closeWikilinkAutocomplete: vi.fn()
    });

    const mounting = lifecycle.mountPaneEditor('pane');
    await mountStarted;
    const disposing = lifecycle.disposePane('pane');
    releaseMount();

    await expect(mounting).resolves.toBe('disposed');
    await disposing;
    expect(runtime.controller).toBeNull();
    expect(destroyEditor).toHaveBeenCalledOnce();
  });

  it('reconciles an already-mounted pane idempotently', async () => {
    const document = createNoteDraftState(createEmptySessionSnapshot());
    const runtime = {
      controller: null as unknown | null,
      refs: { editorRoot: {} }
    };
    const createEditor = vi.fn(async () => {
      runtime.controller = { paneId: 'pane' };
    });
    const lifecycle = createPaneEditorLifecycle({
      getPaneIds: () => ['pane'],
      getPaneRuntime: () => runtime as never,
      getEditorLifecycleController: () =>
        ({
          createEditor,
          destroyEditor: vi.fn(),
          finishEditorPresentation: vi.fn(async () => true),
          restoreCursorPositionForDocument: vi.fn(),
          saveCursorPositionForDocument: vi.fn()
        }) as never,
      getPaneDocument: () => document,
      paneShouldMountEditor: () => true,
      closeWikilinkAutocomplete: vi.fn()
    });

    await lifecycle.ensurePaneEditors();
    await lifecycle.ensurePaneEditors();

    expect(createEditor).toHaveBeenCalledTimes(1);
  });

  it('serializes document binding before teardown and skips later replacements', async () => {
    const document = createNoteDraftState(
      createEmptySessionSnapshot()
    );
    const runtime = {
      controller: null as unknown | null,
      refs: { editorRoot: {} },
      setIsEditorReady: vi.fn()
    };
    let releaseSwap!: () => void;
    const swapStarted = new Promise<void>((resolve) => {
      releaseSwap = resolve;
    });
    let markSwapStarted!: () => void;
    const didStartSwap = new Promise<void>((resolve) => {
      markSwapStarted = resolve;
    });
    const swapEditorBuffer = vi.fn(async () => {
      markSwapStarted();
      await swapStarted;
      return true;
    });
    const replaceInPlace = vi.fn();
    const destroyEditor = vi.fn(async () => {
      runtime.controller = null;
    });
    const lifecycle = createPaneEditorLifecycle({
      getPaneIds: () => ['pane'],
      getPaneRuntime: () => runtime as never,
      getEditorLifecycleController: () =>
        ({
          createEditor: async () => {
            runtime.controller = { paneId: 'pane' };
          },
          swapEditorBuffer,
          replaceEditorContentInPlace: replaceInPlace,
          destroyEditor,
          saveCursorPositionForDocument: vi.fn(),
          finishEditorPresentation: vi.fn(async () => true),
          restoreCursorPositionForDocument: vi.fn()
        }) as never,
      getPaneDocument: () => document,
      paneShouldMountEditor: () => true,
      closeWikilinkAutocomplete: vi.fn()
    });

    await lifecycle.mountPaneEditor('pane');
    const binding = lifecycle.bindDocument('pane', document);
    await didStartSwap;
    const replacement = lifecycle.replaceContentInPlace(
      'pane',
      'late replacement'
    );
    const disposing = lifecycle.disposePane('pane');
    releaseSwap();
    await Promise.all([binding, replacement, disposing]);

    expect(swapEditorBuffer).toHaveBeenCalledOnce();
    expect(replaceInPlace).not.toHaveBeenCalled();
    expect(destroyEditor).toHaveBeenCalledOnce();
    expect(runtime.controller).toBeNull();
  });
});
