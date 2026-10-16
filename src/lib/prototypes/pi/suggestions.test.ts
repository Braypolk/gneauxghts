import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatApi } from '$lib/features/chat/api';
import { createPiChatApi } from './chatApi';
import { suggestPiContext } from './suggestions';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
beforeEach(() => invoke.mockReset());

describe('Pi canonical context suggestions', () => {
  it('uses canonical title discovery through the normal API without granting access or importing excerpts', async () => {
    const legacySuggest = vi.fn();
    const api = createPiChatApi({ suggestContext: legacySuggest } as unknown as ChatApi);
    invoke.mockResolvedValueOnce({ items: [{ noteId: 'n1', title: 'Canonical title', excerpt: 'not admitted', startLine: 4, evidenceId: 'unissued' }], coverage: { kind: 'canonical_title_discovery' } });
    const result = await api.suggestContext({ conversationId: 'pi-1', vaultAccess: 'none', query: 'Canonical' });
    expect(invoke.mock.calls).toEqual([['pi_discover_notes', { query: 'Canonical' }]]);
    expect(legacySuggest).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'ready', reason: expect.stringContaining('no excerpts or read evidence'), items: [{
      noteId: 'n1', title: 'Canonical title', sectionLabel: null, excerpt: '', startLine: null, endLine: null, blockAnchor: null, reason: 'related'
    }] });
  });
  it('filters the adjacent note before applying the requested limit and reports truncated coverage', async () => {
    invoke.mockResolvedValueOnce({ items: [{ noteId: 'active', title: 'Active' }, { noteId: 'n1', title: 'One' }, { noteId: 'n2', title: 'Two' }], hasMore: true });
    const result = await suggestPiContext({ vaultAccess: 'approved', query: 'o', excludeNoteId: 'active', limit: 1 });
    expect(result.items.map(item => item.noteId)).toEqual(['n1']);
    expect(result.reason).toContain('narrow the title query');
  });
  it('honors an empty requested limit without retrieving anything', async () => {
    expect(await suggestPiContext({ vaultAccess: 'full', query: 'title', limit: 0 })).toMatchObject({ status: 'ready', items: [] });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('bounds the requested limit to the native discovery page and preserves empty results', async () => {
    invoke.mockResolvedValueOnce({ items: Array.from({ length: 30 }, (_, index) => ({ noteId: `n${index}`, title: String(index) })) });
    expect((await suggestPiContext({ vaultAccess: 'none', query: '', limit: 100 })).items).toHaveLength(20);
    invoke.mockResolvedValueOnce({ items: [] });
    expect((await suggestPiContext({ vaultAccess: 'approved', query: 'absent' })).items).toEqual([]);
  });
});
