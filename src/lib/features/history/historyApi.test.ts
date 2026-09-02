import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getHistoryModePage, getHistoryModeRevision } from './historyApi';

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
});
