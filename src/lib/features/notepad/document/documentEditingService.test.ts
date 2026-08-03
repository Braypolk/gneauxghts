import { describe, expect, it, vi } from 'vitest';
import { createDocumentEditingService } from './documentEditingService';
import {
  createNoteDraftState
} from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

function createHarness(options: { suppressAutosave?: boolean; external?: boolean } = {}) {
  const note = createNoteDraftState(createEmptySessionSnapshot());
  const scheduleAutosave = vi.fn();
  const scheduleSearch = vi.fn();
  const scheduleRelated = vi.fn();
  const service = createDocumentEditingService({
    isApplyingProgrammaticUpdate: () => options.external ?? false,
    shouldSuppressAutosave: () => options.suppressAutosave ?? false,
    resetPaneCommandAfterBodyInput: vi.fn(),
    clearRecentlyForgotten: vi.fn(),
    scheduleAutosave,
    scheduleSearch,
    scheduleRelated
  });
  return { note, service, scheduleAutosave, scheduleSearch, scheduleRelated };
}

describe('documentEditingService', () => {
  it('increments the operation revision once per actual markdown change', () => {
    const harness = createHarness();
    const revision = harness.note.operation.revision;

    expect(harness.service.recordUserEdit('primary', harness.note, 'hello')).toBe(true);
    expect(harness.note.operation.revision).toBe(revision + 1);
    expect(harness.service.recordUserEdit('primary', harness.note, 'hello')).toBe(false);
    expect(harness.note.operation.revision).toBe(revision + 1);
  });

  it('suppresses autosave during proposal review while retaining derived views', () => {
    const harness = createHarness({ suppressAutosave: true });
    harness.service.recordUserEdit('primary', harness.note, 'proposal');

    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
    expect(harness.scheduleSearch).toHaveBeenCalledOnce();
    expect(harness.scheduleRelated).toHaveBeenCalledOnce();
  });

  it('does not duplicate policies for an externally-applied runtime callback', () => {
    const harness = createHarness({ external: true });
    expect(
      harness.service.recordUserEdit(
        'primary',
        harness.note,
        'replacement'
      )
    ).toBe(false);

    expect(harness.note.working.markdown).toBe('');
    expect(harness.scheduleAutosave).not.toHaveBeenCalled();
    expect(harness.scheduleSearch).not.toHaveBeenCalled();
    expect(harness.scheduleRelated).not.toHaveBeenCalled();
  });

  it('applies a changed snapshot atomically with one revision and one runtime update', async () => {
    const harness = createHarness();
    const revision = harness.note.operation.revision;
    const applyRuntime = vi.fn(async () => {
      expect(harness.note.working.markdown).toBe('from disk');
    });

    const result = await harness.service.applySnapshot(
      harness.note,
      {
        ...createEmptySessionSnapshot(),
        title: 'Disk title',
        bodyMarkdown: 'from disk'
      },
      applyRuntime
    );

    expect(result).toEqual({
      titleChanged: true,
      markdownChanged: true
    });
    expect(harness.note.operation.revision).toBe(revision + 1);
    expect(applyRuntime).toHaveBeenCalledOnce();
    expect(harness.scheduleSearch).toHaveBeenCalledOnce();
    expect(harness.scheduleRelated).toHaveBeenCalledWith({
      immediate: true
    });
  });

  it('preserves a newer draft while accepting saved metadata', async () => {
    const harness = createHarness();
    harness.note.working.title = 'newer title';
    harness.note.working.markdown = 'newer body';
    const revision = harness.note.operation.revision;
    const applyRuntime = vi.fn();

    await harness.service.applySnapshot(
      harness.note,
      {
        ...createEmptySessionSnapshot(),
        title: 'saved title',
        bodyMarkdown: 'saved body',
        currentNoteId: 'note-id',
        currentNotePath: '/vault/note.md',
        lastSavedTitle: 'saved title',
        lastSavedMarkdown: 'saved body',
        lastSavedNoteId: 'note-id',
        lastSavedPath: '/vault/note.md'
      },
      applyRuntime,
      { preserveDraft: true, scheduleDerived: false }
    );

    expect(harness.note.working.title).toBe('newer title');
    expect(harness.note.working.markdown).toBe('newer body');
    expect(harness.note.identity).toEqual({
      kind: 'persisted',
      noteId: 'note-id',
      path: '/vault/note.md'
    });
    expect(harness.note.operation.revision).toBe(revision);
    expect(applyRuntime).not.toHaveBeenCalled();
    expect(harness.scheduleSearch).not.toHaveBeenCalled();
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
    harness.service.recordUserEdit(
      'primary',
      harness.note,
      'newer user edit'
    );
    releaseFirstApply();
    await replacement;

    expect(appliedMarkdown).toEqual([
      'programmatic',
      'newer user edit'
    ]);
    expect(harness.note.working.markdown).toBe(
      'newer user edit'
    );
  });
});
