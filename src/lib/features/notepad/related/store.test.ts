import { DocumentBody } from '../document/documentBody';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRelatedNotesStore, type RelatedContext } from './store.svelte';
import type { RelatedNotesResponse } from '#lib/types/semantic.js';
const { retrieve, backlinks } = vi.hoisted(() => ({ retrieve: vi.fn(), backlinks: vi.fn() }));
vi.mock('../search/search', () => ({ getRelatedNotes: retrieve, getNoteBacklinks: backlinks }));
const context: RelatedContext = { documentHandle: 'draft-a', currentPath: null, currentTitle: 'Draft', body: DocumentBody.fromMarkdown('A note about connected ideas.') };
function response(title: string): RelatedNotesResponse {
  return { status: 'ready', reason: null, scope: 'note', items: [{ noteId: title, notePath: `/vault/${title}.md`, noteTitle: title, sectionLabel: 'Context', excerpt: 'A useful passage', matchText: 'A useful passage', score: 1, startLine: 2, endLine: 2 }] };
}
function deferred() {
  let resolve!: (value: RelatedNotesResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RelatedNotesResponse>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => { retrieve.mockReset().mockResolvedValue(response('Match')); backlinks.mockReset().mockResolvedValue(response('Incoming').items); });
describe('related retrieval lifetime', () => {
  it('does no work while hidden and coalesces two views of one draft', async () => {
    const store = createRelatedNotesStore();
    store.update(context); store.scheduleRelated();
    expect(retrieve).not.toHaveBeenCalled();
    const firstView = store.acquire(context), popup = store.acquire(context);
    expect(popup.result).toBe(firstView.result);
    await store.refresh(popup.result);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(popup.result.items).toEqual(response('Match').items);
    firstView.release(); popup.release(); popup.release();
    expect(store.acquire(context).result).not.toBe(popup.result);
  });
  it('isolates unsaved drafts by handle', async () => {
    const store = createRelatedNotesStore();
    retrieve.mockResolvedValueOnce(response('First')).mockResolvedValueOnce(response('Second'));
    const a = store.acquire(context), b = store.acquire({ ...context, documentHandle: 'draft-b' });
    await Promise.all([store.refresh(a.result), store.refresh(b.result)]);
    expect(a.result.items[0].noteTitle).toBe('First'); expect(b.result.items[0].noteTitle).toBe('Second');
  });
  it.each(['success', 'failure'] as const)('rejects an old %s after a draft edit; refresh uses current text', async outcome => {
    const store = createRelatedNotesStore(), old = deferred();
    retrieve.mockReturnValueOnce(old.promise);
    const sub = store.acquire(context), pending = store.refresh(sub.result);
    store.update({ ...context, body: DocumentBody.fromMarkdown('Replacement draft') });
    if (outcome === 'success') old.resolve(response('Obsolete')); else old.reject(new Error('Obsolete'));
    await pending;
    expect(sub.result.items).toEqual([]); expect(sub.result.isStale).toBe(true);
    await store.refresh(sub.result);
    expect(retrieve).toHaveBeenLastCalledWith(expect.objectContaining({ currentMarkdown: 'Replacement draft' }), null, 4);
    expect(sub.result.items[0].noteTitle).toBe('Match');
  });
  it.each(['release', 'dispose'] as const)('rejects in-flight work after %s', async action => {
    const store = createRelatedNotesStore(), old = deferred(); retrieve.mockReturnValueOnce(old.promise);
    const sub = store.acquire(context), pending = store.refresh(sub.result);
    if (action === 'release') sub.release(); else store.dispose();
    old.resolve(response('Obsolete')); await pending;
    expect(sub.result.items).toEqual([]); expect(sub.result.isLoading).toBe(false);
  });
  it.each(['rejection', 'unavailable'] as const)('retains the visible order on edits and %s, then permits retry', async failure => {
    const store = createRelatedNotesStore(), sub = store.acquire(context); await store.refresh(sub.result);
    store.update({ ...context, currentTitle: 'Renamed' }); store.scheduleRelated();
    expect(retrieve).toHaveBeenCalledTimes(1); expect(sub.result.items[0].noteTitle).toBe('Match');
    if (failure === 'rejection') retrieve.mockRejectedValueOnce(new Error('Offline'));
    else retrieve.mockResolvedValueOnce({ status: 'unavailable', reason: 'Offline', scope: 'note', items: [] });
    await store.refresh(sub.result);
    expect(sub.result.status).toBe('unavailable'); expect(sub.result.items[0].noteTitle).toBe('Match');
    retrieve.mockResolvedValueOnce(response('New')); await store.refresh(sub.result);
    expect(sub.result.items[0].noteTitle).toBe('New'); expect(sub.result.isStale).toBe(false);
  });
  it('immediately removes invalid targets without background retrieval', async () => {
    const store = createRelatedNotesStore(), sub = store.acquire(context); await store.refresh(sub.result);
    store.invalidateTarget('/vault/Match.md');
    expect(sub.result.items).toEqual([]); expect(sub.result.isStale).toBe(true); expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it('invalidates by immutable body and metadata without requesting a string until refresh', async () => {
    const store = createRelatedNotesStore(), sub = store.acquire(context);
    await store.refresh(sub.result);
    const body = DocumentBody.fromText(context.body.text.replace(0, 1, DocumentBody.fromMarkdown('B').text));
    const snapshot = vi.spyOn(body, 'toMarkdown');
    const next = { ...context, body };
    store.update(next);
    const epoch = sub.result.epoch;
    store.update({ ...next }); // Another pane of the same document.
    expect(sub.result.epoch).toBe(epoch);
    expect(sub.result.isStale).toBe(true);
    expect(snapshot).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledTimes(1);
    store.update({ ...next, currentTitle: 'Renamed', currentPath: '/vault/new.md' });
    expect(sub.result.epoch).toBeGreaterThan(epoch);
    expect(snapshot).not.toHaveBeenCalled();
    await store.refresh(sub.result);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenLastCalledWith(expect.objectContaining({
      currentTitle: 'Renamed', currentPath: '/vault/new.md', currentMarkdown: 'B note about connected ideas.'
    }), null, 4);
    sub.release();
  });
});


describe('backlinks retrieval', () => {
  const saved = { ...context, currentPath: '/vault/current.md' };
  it('loads incoming links only for the visible view and never serializes the body', async () => {
    const store = createRelatedNotesStore();
    const snapshot = vi.spyOn(saved.body, 'toMarkdown');
    const sub = store.acquire(saved, 'backlinks');
    await store.refresh(sub.result);
    expect(backlinks).toHaveBeenCalledWith('/vault/current.md');
    expect(retrieve).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(sub.result.items[0].noteTitle).toBe('Incoming');
    sub.release(); snapshot.mockRestore();
  });
  it('explains unsaved and empty saved notes without falling back to related matches', async () => {
    const store = createRelatedNotesStore();
    const unsaved = store.acquire(context, 'backlinks');
    await store.refresh(unsaved.result);
    expect(backlinks).not.toHaveBeenCalled();
    expect(unsaved.result.reason).toBe('Save this note to see backlinks.');
    store.update(saved);
    backlinks.mockResolvedValueOnce([]);
    await store.refresh(unsaved.result);
    expect(unsaved.result.items).toEqual([]);
    expect(unsaved.result.reason).toBe('No notes link to this note yet.');
    unsaved.release();
  });
  it('rejects a pending Related response after switching views and a pending backlink after closing', async () => {
    const store = createRelatedNotesStore(), old = deferred();
    retrieve.mockReturnValueOnce(old.promise);
    const related = store.acquire(saved), pending = store.refresh(related.result);
    related.release();
    const incoming = store.acquire(saved, 'backlinks');
    await store.refresh(incoming.result);
    old.resolve(response('Obsolete')); await pending;
    expect(related.result.items).toEqual([]);
    expect(incoming.result.items[0].noteTitle).toBe('Incoming');
    let resolve!: (items: RelatedNotesResponse['items']) => void;
    backlinks.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const refresh = store.refresh(incoming.result);
    incoming.release(); resolve(response('Late').items); await refresh;
    expect(incoming.result.items[0].noteTitle).toBe('Incoming');
  });
  it('retains previous backlinks on failure and retries against the latest path', async () => {
    const store = createRelatedNotesStore(), sub = store.acquire(saved, 'backlinks');
    await store.refresh(sub.result);
    store.update({ ...saved, currentPath: '/vault/renamed.md' });
    backlinks.mockRejectedValueOnce(new Error('Unavailable'));
    await store.refresh(sub.result);
    expect(sub.result.status).toBe('unavailable');
    expect(sub.result.items[0].noteTitle).toBe('Incoming');
    await store.refresh(sub.result);
    expect(backlinks).toHaveBeenLastCalledWith('/vault/renamed.md');
    expect(sub.result.isStale).toBe(false);
    sub.release();
  });
});
