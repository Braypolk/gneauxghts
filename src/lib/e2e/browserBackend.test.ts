import { describe, expect, it } from 'vitest';
import { createBrowserE2eBackend } from './browserBackend';

describe('browser fixture command ownership', () => {
  it('rejects unknown commands and identities instead of silently succeeding', async () => {
    const backend = createBrowserE2eBackend();
    await expect(backend.invoke('list_typo')).rejects.toThrow('does not implement');
    await expect(backend.invoke('read_note', { noteId: 'absent' })).rejects.toThrow('Unknown note');
    await expect(backend.invoke('save_note', { currentPath: '/absent.md' })).rejects.toThrow('Unknown note');
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

  it('provides the model capabilities needed to restore seeded revision chat', async () => {
    const backend = createBrowserE2eBackend();
    backend.bridge.seedRevisionChat();
    const settings = await backend.invoke('chat_get_settings') as { provider: string; model: string };
    expect(await backend.invoke('chat_get_model_capabilities', { provider: settings.provider, model: settings.model }))
      .toEqual({ images: false, audio: false, video: false, files: false, acceptedMimeTypes: [], tools: true });
    expect(await backend.invoke('chat_get_conversation', { conversationId: 'revision-chat' }))
      .toMatchObject({ id: 'revision-chat', messages: expect.arrayContaining([expect.objectContaining({ id: 'revision-answer' })]) });
  });
});
