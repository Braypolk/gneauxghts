import { describe, expect, it, vi } from 'vitest';

import { createPaneEditorLifecycle } from './paneEditorLifecycle';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

describe('paneEditorLifecycle', () => {
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
