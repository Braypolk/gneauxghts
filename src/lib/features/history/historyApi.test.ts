import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNoteHistory,
  finalizeNoteEditingWindow,
  getHistoryModeDiff,
  getHistoryModeDiagnostics,
  getHistoryModePage,
  getHistoryModeContext,
  getHistoryModeRevision,
  nameHistoryRevision,
  previewHistoryRevisionRestore,
  removeHistoryRevisionName,
  restoreHistoryRevision
} from './historyApi';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('historyApi', () => {
  beforeEach(() => invoke.mockReset());

  it('requests a bounded page through the History Mode command seam', async () => {
    invoke.mockResolvedValue({ records: [], nextCursor: null });

    await getHistoryModePage('note-1', 'cursor-1');

    expect(invoke).toHaveBeenCalledWith('get_note_history_page', {
      noteId: 'note-1',
      cursor: 'cursor-1',
      limit: 30
    });
  });

  it('requests identity-bound context and opaque continuation through History Mode', async () => {
    invoke.mockResolvedValue({ records: [], nextCursor: null, previousCursor: 'newer' });
    await expect(getHistoryModeContext('note-1', 'old-revision', 'older')).resolves.toMatchObject({ previousCursor: 'newer' });
    expect(invoke).toHaveBeenCalledWith('get_note_history_context', { noteId: 'note-1', revisionId: 'old-revision', cursor: 'older' });
  });

  it('requests one selected revision scoped to its note', async () => {
    invoke.mockResolvedValue({
      revisionId: 'revision-1',
      unmanagedFrontmatter: null,
      body: 'body'
    });

    await getHistoryModeRevision('note-1', 'revision-1');

    expect(invoke).toHaveBeenCalledWith('get_note_history_revision', {
      noteId: 'note-1',
      revisionId: 'revision-1'
    });
  });

  it('requests a deterministic comparison for the selected revision', async () => {
    invoke.mockResolvedValue({
      revisionId: 'revision-1',
      comparison: 'current',
      fromRevisionId: 'revision-1',
      toRevisionId: 'revision-2',
      bodyLines: [],
      propertiesLines: [],
      missingAssets: []
    });

    await getHistoryModeDiff('note-1', 'revision-1', 'current');

    expect(invoke).toHaveBeenCalledWith('get_note_history_diff', {
      noteId: 'note-1',
      revisionId: 'revision-1',
      comparison: 'current'
    });
  });

  it('uses confirmed, note-scoped commands to manage retained history', async () => {
    invoke.mockResolvedValue(undefined);

    await nameHistoryRevision('note-1', 'revision-1', 'Milestone');
    await removeHistoryRevisionName('note-1', 'revision-1');
    await clearNoteHistory('note-1');

    expect(invoke).toHaveBeenNthCalledWith(1, 'name_note_revision', {
      noteId: 'note-1',
      revisionId: 'revision-1',
      label: 'Milestone'
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'remove_note_revision_name', {
      noteId: 'note-1',
      revisionId: 'revision-1'
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'clear_note_history', {
      noteId: 'note-1',
      confirmed: true
    });
  });

  it('binds confirmed Version Restore to the authored hash returned by its preview', async () => {
    invoke.mockResolvedValue(undefined);

    await previewHistoryRevisionRestore('note-1', 'revision-1');
    await restoreHistoryRevision('note-1', 'revision-1', 'current-hash');

    expect(invoke).toHaveBeenNthCalledWith(1, 'preview_note_revision_restore', {
      noteId: 'note-1',
      revisionId: 'revision-1'
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'restore_note_revision', {
      noteId: 'note-1',
      revisionId: 'revision-1',
      expectedCurrentAuthoredContentHash: 'current-hash',
      confirmed: true
    });
  });

  it('loads per-note usage with vault allocation and reclamation', async () => {
    invoke
      .mockResolvedValueOnce({
        noteId: 'note-1',
        state: 'healthy',
        revisionCount: 3,
        lifecycleEventCount: 1,
        revisionPayloadBytes: 512
      })
      .mockResolvedValueOnce({
        storage: { allocatedBytes: 4096, reclaimableBytes: 1024 }
      });

    await expect(getHistoryModeDiagnostics('note-1')).resolves.toEqual({
      note: {
        noteId: 'note-1',
        state: 'healthy',
        revisionCount: 3,
        lifecycleEventCount: 1,
        revisionPayloadBytes: 512
      },
      storage: { allocatedBytes: 4096, reclaimableBytes: 1024 }
    });
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_note_history_health', {
      noteId: 'note-1'
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_history_health');
  });
});

it('preserves window evidence and immutable selection through the target-only finalization API', async () => {
  const record = { kind: 'revision', revisionId: 'window-1', timeKind: 'editingWindow',
    timeEvidence: { kind: 'editingWindow', version: 1, firstWallMillis: 200, lastWallMillis: 100,
      minWallMillis: 100, maxWallMillis: 200, clockDiscontinuity: true } };
  invoke.mockReset().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ records: [record], nextCursor: 'older' });
  await finalizeNoteEditingWindow('note-1');
  expect(await getHistoryModePage('note-1')).toEqual({ records: [record], nextCursor: 'older' });
  expect(invoke).toHaveBeenNthCalledWith(1, 'finalize_note_editing_window', { noteId: 'note-1' });
});
