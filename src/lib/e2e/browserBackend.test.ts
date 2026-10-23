import { describe, expect, it, vi } from 'vitest';
import { createBrowserE2eBackend } from './browserBackend';
import { listen } from '@tauri-apps/api/event';

describe('browser fixture command ownership', () => {
  it('retains private recovery copies across fixture reloads without overwriting canonical notes', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    try {
      const first = createBrowserE2eBackend();
      const before = first.bridge.snapshot().notes;
      const draft = { id: 'da046fa3-c09f-4c33-8a83-507be8053e52', version: 2, title: 'Unsaved', markdown: 'Keep this work',
        tags: ['idea'], tagsError: null, sourceNoteId: 'note-alpha', sourcePath: '/e2e/alpha.md', updatedAtMillis: 0 };
      await first.invoke('save_draft_backup', { draft });
      const reopened = createBrowserE2eBackend();
      expect(await reopened.invoke('list_draft_backups')).toEqual([expect.objectContaining({ ...draft, updatedAtMillis: expect.any(Number) })]);
      expect(reopened.bridge.snapshot().notes).toEqual(before);
      await reopened.invoke('remove_draft_backup', { id: draft.id, version: 3 });
      await reopened.invoke('save_draft_backup', { draft });
      expect(await reopened.invoke('list_draft_backups')).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('supports public Tauri listener cleanup without a WebDriver service', async () => {
    const backend = createBrowserE2eBackend();
    vi.stubGlobal('window', {});
    try {
      backend.bridge.restoreIpc();
      const first = vi.fn(), second = vi.fn();
      const unlisten = await listen('saved', first);
      await listen('saved', second);
      backend.bridge.emit('saved', 'before');
      await unlisten();
      await unlisten(); // Cleanup is idempotent across the JS and IPC registries.
      backend.bridge.emit('saved', 'after');
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
      expect(second.mock.calls[1][0]).toMatchObject({ payload: 'after' });
    } finally { vi.unstubAllGlobals(); }
  });

  it('reattaches its IPC after service injection without losing fixture state', async () => {
    const backend = createBrowserE2eBackend();
    await backend.invoke('save_note', { currentPath: '/e2e/alpha.md', title: 'Alpha', markdown: 'Retained fixture edit' });
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: () => { throw new Error('service interceptor'); } } });
    try {
      backend.bridge.restoreIpc();
      const ipc = window.__TAURI_INTERNALS__ as { invoke: typeof backend.invoke };
      expect(await ipc.invoke('read_note', { noteId: 'note-alpha' })).toMatchObject({ markdown: 'Retained fixture edit' });
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects unknown commands and identities instead of silently succeeding', async () => {
    const backend = createBrowserE2eBackend();
    await expect(backend.invoke('list_typo')).rejects.toThrow('does not implement');
    await expect(backend.invoke('read_note', { noteId: 'absent' })).rejects.toThrow('Unknown note');
    await expect(backend.invoke('save_note', { currentPath: '/absent.md' })).rejects.toThrow('Unknown note');
  });

  it('starts a blank capture session without deleting the previous note', async () => {
    const backend = createBrowserE2eBackend();
    const before = backend.bridge.snapshot().notes;
    await backend.invoke('clear_last_opened_note');
    expect(await backend.invoke('load_note_session')).toMatchObject({ noteId: null, path: null, title: '', markdown: '' });
    expect(backend.bridge.snapshot().notes).toEqual(before);

    const saved = await backend.invoke('save_note', { currentPath: null, title: '', markdown: 'A new idea' });
    expect(saved).toMatchObject({ noteId: 'note-created-1', markdown: 'A new idea' });
    expect(await backend.invoke('load_note_session')).toEqual(saved);
    expect(await backend.invoke('read_note', { noteId: 'note-alpha' })).toMatchObject({ title: 'Alpha note' });
  });

  it('admitted save of A survives a read and open of B without modifying B', async () => {
    const backend = createBrowserE2eBackend();
    backend.bridge.holdSave();
    const save = backend.invoke('save_note', { currentPath: '/e2e/alpha.md', title: 'Alpha', markdown: 'saved A' });
    await backend.invoke('read_note', { path: '/e2e/beta.md' });
    expect(backend.bridge.snapshot().activeNoteId).toBe('note-alpha');
    await backend.invoke('open_note', { path: '/e2e/beta.md' });
    backend.bridge.releaseSave();
    await save;
    const snapshot = backend.bridge.snapshot();
    expect(snapshot.activeNoteId).toBe('note-beta');
    expect(snapshot.notes.find(note => note.noteId === 'note-alpha')?.markdown).toBe('saved A');
    expect(snapshot.notes.find(note => note.noteId === 'note-beta')?.markdown).toContain('Beta body');
    expect(createBrowserE2eBackend().bridge.snapshot().notes[0].markdown).not.toBe('saved A');
  });

  it('delivers to each subscription and unlistens only its owned callback', async () => {
    const backend = createBrowserE2eBackend();
    const received: unknown[] = [];
    const first = backend.internals.transformCallback(payload => received.push(payload));
    const second = backend.internals.transformCallback(payload => received.push(payload));
    const a = await backend.invoke('plugin:event|listen', { event: 'saved', handler: first });
    await backend.invoke('plugin:event|listen', { event: 'saved', handler: second });
    backend.bridge.emit('other', 'ignored');
    backend.bridge.emit('saved', 'first');
    expect(received).toHaveLength(2);
    await backend.invoke('plugin:event|unlisten', { eventId: a });
    backend.bridge.emit('saved', 'second');
    expect(received).toHaveLength(3);
    expect(received[2]).toMatchObject({ event: 'saved', payload: 'second' });
  });

  it('rejects failed save admission with the production string contract and retains canonical text', async () => {
    const backend = createBrowserE2eBackend();
    const before = backend.bridge.snapshot().notes;
    backend.bridge.holdSave(true);
    const save = backend.invoke('save_note', { currentPath: '/e2e/alpha.md', title: 'Alpha', markdown: 'uncommitted edit' });
    const failure = expect(save).rejects.toBe('History is unavailable. Retry history from Settings.');
    backend.bridge.releaseSave();
    await failure;
    expect(backend.bridge.snapshot().notes).toEqual(before);
  });

  it.each(['save_note', 'save_task_note'])('rejects a %s path belonging to another captured identity', async command => {
    const backend = createBrowserE2eBackend();
    const before = backend.bridge.snapshot().notes;
    await expect(backend.invoke(command, { currentPath: '/e2e/beta.md', expectedNoteId: 'note-alpha',
      title: 'Alpha', markdown: 'stale save' })).rejects.toBe('This note moved. Reopen its saved location before saving.');
    expect(backend.bridge.snapshot().notes).toEqual(before);
  });

  it('retains settings and composer drafts while rejecting retired chat commands', async () => {
    const backend = createBrowserE2eBackend();
    expect(await backend.invoke('chat_get_settings')).toMatchObject({ provider: 'local', localModel: 'fixture-local' });
    await backend.invoke('chat_set_composer_draft', { slot: 'pane:a', body: 'Unsent' });
    expect(await backend.invoke('chat_get_composer_draft', { slot: 'pane:a' })).toBe('Unsent');
    for (const command of ['chat_create_conversation', 'chat_send_message', 'chat_get_conversation', 'chat_list_pending_proposals']) {
      await expect(backend.invoke(command)).rejects.toThrow('does not implement');
    }
  });
});
