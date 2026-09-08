import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentEditingService } from './documentEditingService';
import {
  createNoteDraftState,
  createNotepadState,
  bindNotepadStateToVault,
  findOpenDocument
} from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import {
  dispatchDocumentOperation,
  updateDocumentMarkdown,
  updateDocumentTitle
} from './documentState';
import { documentRegistry } from './documentRegistry';

function createHarness(
  options: { suppressAutosave?: boolean; external?: boolean } = {},
  snapshot = createEmptySessionSnapshot()
) {
  const note = createNoteDraftState(snapshot);
  const state = createNotepadState(note);
  bindNotepadStateToVault(state, '/vault');
  const scheduleAutosave = vi.fn();
  const scheduleSearch = vi.fn();
  const scheduleRelated = vi.fn();
  const replaceNoteAcrossPanes = vi.fn(async () => undefined);
  const service = createDocumentEditingService({
    state,
    isApplyingProgrammaticUpdate: () => options.external ?? false,
    shouldSuppressAutosave: () => options.suppressAutosave ?? false,
    isTitleEditing: () => false,
    resetPaneCommandAfterBodyInput: vi.fn(),
    clearRecentlyForgotten: vi.fn(),
    clearSelectedRelatedText: vi.fn(),
    scheduleAutosave,
    scheduleSearch,
    scheduleRelated
  });
  return {
    note,
    state,
    service,
    scheduleAutosave,
    scheduleSearch,
    scheduleRelated,
    replaceNoteAcrossPanes
  };
}

afterEach(() => {
  for (const runtime of [...documentRegistry.values()]) {
    documentRegistry.dispose(runtime.documentHandle);
  }
});

describe('documentEditingService', () => {
  it('increments the operation revision once per actual markdown change', () => {
    const harness = createHarness();
    const revision = harness.note.operation.revision;

    expect(harness.service.recordUserEdit('left', harness.note, 'hello')).toBe(true);
    expect(harness.note.operation.revision).toBe(revision + 1);
    expect(harness.service.recordUserEdit('left', harness.note, 'hello')).toBe(false);
    expect(harness.note.operation.revision).toBe(revision + 1);
  });

  it('suppresses autosave during proposal review while retaining derived views', () => {
    const harness = createHarness({ suppressAutosave: true });
    harness.service.recordUserEdit('left', harness.note, 'proposal');

    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
    expect(harness.scheduleSearch).toHaveBeenCalledOnce();
    expect(harness.scheduleRelated).toHaveBeenCalledOnce();
  });

  it('does not treat a programmatic editor callback as another edit', () => {
    const harness = createHarness({ external: true });
    expect(
      harness.service.recordUserEdit('left', harness.note, 'replacement')
    ).toBe(false);

    expect(harness.note.working.markdown).toBe('');
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
    expect(harness.scheduleSearch).not.toHaveBeenCalled();
  });

  it('adopts saved identity, baseline, and warning while preserving later title and body edits', async () => {
    const harness = createHarness();
    updateDocumentTitle(harness.note, 'captured title');
    updateDocumentMarkdown(harness.note, 'captured body');
    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    const capture = harness.service.captureSave(harness.note);

    updateDocumentTitle(harness.note, 'later title');
    updateDocumentMarkdown(harness.note, 'later body');
    const warning = {
      message: 'History finalization pending',
      issues: [{ stage: 'historyFinalization' as const, message: 'retry' }]
    };
    const adopted = await harness.service.adoptSavedResult(capture, {
      noteId: 'note-id',
      title: 'captured title',
      markdown: 'captured body',
      path: '/vault/saved.md',
      commitWarning: warning
    });

    expect(adopted?.working).toEqual({
      title: 'later title',
      markdown: 'later body'
    });
    expect(adopted?.savedBaseline?.content).toEqual({
      title: 'captured title',
      markdown: 'captured body'
    });
    expect(adopted?.publication.warning).toEqual(warning);
    expect(adopted?.identity).toEqual({
      kind: 'persisted',
      noteId: 'note-id',
      path: '/vault/saved.md'
    });
  });

  it('keeps one document, handle, registry entry, and editor root through first save and title rename', async () => {
    const harness = createHarness();
    const originalHandle = harness.note.handle;
    const registryEntry = documentRegistry.ensure(originalHandle);
    const resources = registryEntry.ensureResources({
      assetRootPath: '/vault/assets',
      storePastedImage: vi.fn()
    });
    updateDocumentTitle(harness.note, 'First title');
    updateDocumentMarkdown(harness.note, 'shared body');
    resources.runtime.ensureMarkdown('shared body');

    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    await harness.service.adoptSavedResult(
      harness.service.captureSave(harness.note),
      {
        noteId: 'note-id',
        title: 'First title',
        markdown: 'shared body',
        path: '/vault/First title.md'
      }
    );
    updateDocumentTitle(harness.note, 'Renamed');
    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    await harness.service.adoptSavedResult(
      harness.service.captureSave(harness.note),
      {
        noteId: 'note-id',
        title: 'Renamed',
        markdown: 'shared body',
        path: '/vault/Renamed.md'
      }
    );

    expect(harness.note.handle).toBe(originalHandle);
    expect(documentRegistry.get(originalHandle)).toBe(registryEntry);
    expect(registryEntry.resources()).toBe(resources);
    expect(registryEntry.resources()?.runtime).toBe(resources.runtime);
    expect(resources.runtime.markdown).toBe('shared body');
    expect(findOpenDocument(harness.state, {
      noteId: 'note-id',
      path: '/vault/Renamed.md'
    })).toBe(harness.note);
    expect(findOpenDocument(harness.state, {
      noteId: null,
      path: '/vault/First title.md'
    })).toBeNull();
  });

  it('ignores a saved result whose operation token was invalidated', async () => {
    const harness = createHarness();
    updateDocumentMarkdown(harness.note, 'captured');
    dispatchDocumentOperation(harness.note, {
      type: 'start',
      operation: 'saving'
    });
    const capture = harness.service.captureSave(harness.note);
    dispatchDocumentOperation(harness.note, { type: 'invalidate' });

    await expect(harness.service.adoptSavedResult(capture, {
      noteId: 'note-id',
      title: 'saved',
      markdown: 'captured',
      path: '/vault/saved.md'
    })).resolves.toBeNull();
    expect(harness.note.savedBaseline).toBeNull();
  });

  it('treats Version Restore of an unopened citation target as successful without pane work', async () => {
    const harness = createHarness();

    await expect(harness.service.adoptVersionRestore({
      noteId: 'citation-note',
      title: 'Citation',
      markdown: 'restored',
      path: '/vault/citation.md'
    })).resolves.toEqual({ kind: 'notOpen' });
    expect(harness.replaceNoteAcrossPanes).not.toHaveBeenCalled();
  });

  it('updates a chat-only retained document and its existing shared runtime', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Note',
      bodyMarkdown: 'before',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Note',
      lastSavedMarkdown: 'before',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });
    const runtime = documentRegistry
      .ensure(harness.note.handle)
      .ensureResources({
        assetRootPath: null,
        storePastedImage: vi.fn()
      }).runtime;
    runtime.ensureMarkdown('before');

    const outcome = await harness.service.adoptVersionRestore({
      noteId: 'note-id',
      title: 'Restored',
      markdown: 'after',
      path: '/vault/note.md'
    });

    expect(outcome).toMatchObject({ kind: 'adopted' });
    expect(harness.note.savedBaseline?.content).toEqual({
      title: 'Restored',
      markdown: 'after'
    });
    expect(runtime.markdown).toBe('after');
    expect(runtime.attachedPaneCount).toBe(0);
    expect(runtime.undo(null)).toBe(false);
  });

  it('starts a fresh shared undo root for a properties-only Version Restore', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Before',
      bodyMarkdown: 'same body',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Before',
      lastSavedMarkdown: 'same body',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });
    const runtime = documentRegistry
      .ensure(harness.note.handle)
      .ensureResources({
        assetRootPath: null,
        storePastedImage: vi.fn()
      }).runtime;
    runtime.ensureMarkdown('same body');
    const revision = runtime.revision;

    await harness.service.adoptVersionRestore({
      noteId: 'note-id',
      title: 'After',
      markdown: 'same body',
      path: '/vault/note.md'
    });

    expect(harness.note.working.title).toBe('After');
    expect(runtime.markdown).toBe('same body');
    expect(runtime.revision).toBe(revision + 1);
    expect(runtime.undo(null)).toBe(false);
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
  });

  it('adopts proposal warnings without saving unless later edits remain', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Plan',
      bodyMarkdown: 'After',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Plan',
      lastSavedMarkdown: 'Before',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });
    const warning = {
      message: 'Projection pending',
      issues: [{ stage: 'semanticProjection' as const, message: 'retry' }]
    };

    await harness.service.adoptAcceptedProposal(
      harness.note,
      {
        noteId: 'note-id',
        title: 'Plan',
        markdown: 'After',
        path: '/vault/note.md'
      },
      'After',
      warning
    );

    expect(harness.note.publication.warning).toEqual(warning);
    expect(harness.note.savedBaseline?.content.markdown).toBe('After');
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
  });

  it('preserves a later proposal title edit and schedules only that dirty work', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Plan',
      bodyMarkdown: 'After',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Plan',
      lastSavedMarkdown: 'Before',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });
    updateDocumentTitle(harness.note, 'Later title');

    await harness.service.adoptAcceptedProposal(
      harness.note,
      {
        noteId: 'note-id',
        title: 'Plan',
        markdown: 'After',
        path: '/vault/note.md'
      },
      'After',
      null
    );

    expect(harness.note.working.title).toBe('Later title');
    expect(harness.note.savedBaseline?.content.title).toBe('Plan');
    expect(harness.scheduleAutosave).toHaveBeenCalledOnce();
  });

  it('applies clean external refresh and transient Forgotten-Note Recovery with fixed policies', async () => {
    const harness = createHarness({}, {
      ...createEmptySessionSnapshot(),
      title: 'Note',
      bodyMarkdown: 'before',
      currentNoteId: 'note-id',
      currentNotePath: '/vault/note.md',
      lastSavedTitle: 'Note',
      lastSavedMarkdown: 'before',
      lastSavedNoteId: 'note-id',
      lastSavedPath: '/vault/note.md'
    });

    await harness.service.adoptCleanExternalRefresh(harness.note, {
      noteId: 'note-id',
      title: 'External',
      markdown: 'external body',
      path: '/vault/note.md'
    });
    expect(harness.note.working.markdown).toBe('external body');
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();

    harness.service.restoreTransientForgotten(harness.note, {
      title: 'Recovered draft',
      bodyMarkdown: 'recovered body',
      currentNoteId: null,
      currentNotePath: null,
      forgottenPath: null
    });
    expect(harness.note.identity).toEqual({ kind: 'draft' });
    expect(harness.note.savedBaseline).toBeNull();
    expect(harness.note.working.markdown).toBe('recovered body');
    expect(harness.scheduleAutosave).toHaveBeenCalledOnce();
  });

  it('restores transient Forgotten content with its current identity but no saved baseline', () => {
    const harness = createHarness();

    harness.service.restoreTransientForgotten(harness.note, {
      title: 'Recovered note',
      bodyMarkdown: 'recovered body',
      currentNoteId: 'remembered-id',
      currentNotePath: '/vault/Remembered.md',
      forgottenPath: null
    });

    expect(harness.note.identity).toEqual({
      kind: 'persisted',
      noteId: 'remembered-id',
      path: '/vault/Remembered.md'
    });
    expect(harness.note.savedBaseline).toBeNull();
    expect(harness.note.working).toEqual({
      title: 'Recovered note',
      markdown: 'recovered body'
    });
    expect(harness.scheduleAutosave).toHaveBeenCalledOnce();
  });

  it('reconciles a queued runtime replacement to a newer user edit', async () => {
    const harness = createHarness();
    let releaseFirstApply!: () => void;
    const firstApply = new Promise<void>((resolve) => {
      releaseFirstApply = resolve;
    });
    const appliedMarkdown: string[] = [];
    const applyRuntime = vi.fn(async (markdown: string) => {
      appliedMarkdown.push(markdown);
      if (appliedMarkdown.length === 1) await firstApply;
    });

    const replacement = harness.service.replaceMarkdown(
      harness.note,
      'programmatic',
      applyRuntime
    );
    await vi.waitFor(() => {
      expect(applyRuntime).toHaveBeenCalledOnce();
    });
    harness.service.recordUserEdit('left', harness.note, 'newer user edit');
    releaseFirstApply();
    await replacement;

    expect(appliedMarkdown).toEqual(['programmatic', 'newer user edit']);
    expect(harness.note.working.markdown).toBe('newer user edit');
  });
});
