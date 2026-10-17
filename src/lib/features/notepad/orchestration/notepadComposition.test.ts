import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotepadComposition, deferred, persistedSession } from './notepadCompositionTestSupport';
import { createEmptySessionSnapshot, createSessionSnapshot, openNoteSession, readNoteSession, forgetNoteSession, restoreForgottenNotes } from '../session/session';
import { finalizeNoteEditingWindow } from '$lib/features/history/historyApi';
import { notepadLocationMru } from '../navigation/locationMru';
import { documentRegistry } from '../document/documentRegistry';
import { updateDocumentMarkdown, updateDocumentTitle } from '../document/documentState';
import { createNoteDraftState } from '../state/noteStore';
import type { NoteSession } from '../model/types';
vi.mock('../session/session', async importOriginal => ({
  ...await importOriginal<typeof import('../session/session')>(),
  openNoteSession: vi.fn(), readNoteSession: vi.fn(), forgetNoteSession: vi.fn(), restoreForgottenNotes: vi.fn(), clearLastOpenedNote: vi.fn(async () => {})
}));
vi.mock('$lib/features/history/historyApi', () => ({ finalizeNoteEditingWindow: vi.fn(async () => {}) }));
const fixtures: ReturnType<typeof createNotepadComposition>[] = [];
function setup(initial?: Parameters<typeof createNotepadComposition>[0]) { const f = createNotepadComposition(initial); fixtures.push(f); return f; }
beforeEach(() => {
  vi.clearAllMocks(); notepadLocationMru.clearAll();
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.mocked(openNoteSession).mockImplementation(async (id, path) => createSessionSnapshot({ ...persistedSession(id ?? path?.split('/').pop()?.replace('.md', '') ?? 'opened'), path }));
  vi.mocked(readNoteSession).mockImplementation(async (id) => persistedSession(id ?? 'a'));
  vi.mocked(finalizeNoteEditingWindow).mockResolvedValue(undefined);
});
afterEach(async () => { for (const f of fixtures.splice(0)) await f.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('composed notepad commands', () => {
  it('retains one shared document while closing a sibling and finalizes only the last editor departure', async () => {
    const f = setup();
    await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId;
    await f.commands.resolvePaneCommandChoice(second, 'current');
    expect(f.getPaneDocument(second)).toBe(f.initialDocument);
    expect(f.workspace.paneOrder).toHaveLength(2);
    await f.commands.closePane(f.first);
    expect(f.workspace.paneOrder).toEqual([second]);
    expect(f.getPaneDocument(second)).toBe(f.initialDocument);
    expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
    await f.commands.setPaneKind(second, 'chat');
    expect(finalizeNoteEditingWindow).toHaveBeenCalledExactlyOnceWith('a');
    expect(f.getPaneDocument(second)).toBe(f.initialDocument);
  });

  it('binds the newly opened document even while rendered presentation is unavailable', async () => {
    const f = setup(); vi.mocked(f.paneLifecycle.bindDocument).mockResolvedValue('unavailable');
    await f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    expect(f.getNavigationDocument().identity).toMatchObject({ noteId: 'b' });
    expect(f.paneLifecycle.bindDocument).toHaveBeenCalledWith(f.first, f.getNavigationDocument(), { restoreCursor: true });
    f.workspace.assertInvariants();
  });

  it('forgets a transient draft and recovers it through the real adoption boundary', async () => {
    const f = setup({ ...createEmptySessionSnapshot(), title: 'Draft', bodyMarkdown: 'unsaved text' });
    await f.commands.clearNotepad();
    const fresh = f.getNavigationDocument();
    expect(fresh.handle).not.toBe(f.initialDocument.handle);
    expect(fresh.working.markdown).toBe('');
    expect(forgetNoteSession).not.toHaveBeenCalled();
    await f.commands.unforgetNotepad();
    expect(f.getNavigationDocument()).toBe(fresh);
    expect(fresh.working).toMatchObject({ title: 'Draft', markdown: 'unsaved text' });
    expect(f.state.recentlyForgotten).toBeNull();
  });

  it('forgets and durably recovers a note without retaining its disposed runtime', async () => {
    const f = setup(); documentRegistry.ensure(f.initialDocument.handle);
    vi.mocked(forgetNoteSession).mockResolvedValue({ forgottenPath: '/forgotten/a.md', originalPath: '/vault/a.md', title: 'a', fileName: 'a.md', forgottenAtMillis: 1, purgeAfterDays: 7, purgeAtMillis: 2, kind: 'note' });
    vi.mocked(restoreForgottenNotes).mockResolvedValue([{ forgottenPath: '/forgotten/a.md', restoredPath: '/vault/a.md', title: 'a', kind: 'note' }]);
    await f.commands.clearNotepad();
    expect(documentRegistry.get(f.initialDocument.handle)).toBeNull();
    expect(forgetNoteSession).toHaveBeenCalledWith('/vault/a.md', 7);
    await f.commands.unforgetNotepad();
    expect(restoreForgottenNotes).toHaveBeenCalledWith(['/forgotten/a.md']);
    expect(f.getNavigationDocument().identity).toMatchObject({ noteId: 'a', path: '/vault/a.md' });
  });

  it('releases nested history restoration after failure so retry can complete', async () => {
    const f = setup(); const location = { kind: 'editor' as const, noteId: 'b', notePath: '/vault/b.md' };
    vi.mocked(openNoteSession).mockRejectedValueOnce(new Error('read failed'));
    await expect(f.commands.openLocationFromHistory(location)).rejects.toThrow('read failed');
    expect(f.getNavigationDocument()).toBe(f.initialDocument);
    await f.commands.openLocationFromHistory(location);
    expect(f.getNavigationDocument().identity).toMatchObject({ noteId: 'b' });
  });

  it('captures the committed renamed path in MRU before opening another note', async () => {
    const f = setup(); updateDocumentTitle(f.initialDocument, 'renamed');
    f.save.mockResolvedValue({ ...persistedSession('a'), title: 'renamed', path: '/vault/renamed.md' });
    await f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    expect(notepadLocationMru.list(f.first)).toContainEqual({ kind: 'editor', noteId: 'a', notePath: '/vault/renamed.md' });
    expect(f.save).toHaveBeenCalledOnce();
  });


  it('ignores an older external read after a newer canonical adoption at the same path', async () => {
    const f = setup(); const oldRead = deferred<NoteSession>();
    vi.mocked(readNoteSession).mockReturnValue(oldRead.promise);
    const refreshing = f.commands.refreshDocumentFromDisk(f.initialDocument);
    updateDocumentMarkdown(f.initialDocument, 'newer committed body');
    f.save.mockResolvedValue(persistedSession('a', 'newer committed body'));
    await f.persistence.enqueueSave(f.initialDocument);
    oldRead.resolve(persistedSession('a', 'obsolete disk body'));
    expect(await refreshing).toBe('stale');
    expect(f.initialDocument.working.markdown).toBe('newer committed body');
    expect(f.initialDocument.savedBaseline?.content.markdown).toBe('newer committed body');
    expect(f.initialDocument.externalSync.kind).toBe('noConflict');
  });
  it('retains local edits made during an external read and offers the changed disk snapshot as a conflict', async () => {
    const f = setup(); const read = deferred<NoteSession>();
    vi.mocked(readNoteSession).mockReturnValue(read.promise);
    const refreshing = f.commands.refreshDocumentFromDisk(f.initialDocument);
    updateDocumentMarkdown(f.initialDocument, 'local edit during read');
    read.resolve(persistedSession('a', 'changed disk body'));
    expect(await refreshing).toBe('conflict');
    expect(f.initialDocument.working.markdown).toBe('local edit during read');
    expect(f.initialDocument.savedBaseline?.content.markdown).toBe('a');
    expect(f.initialDocument.externalSync).toMatchObject({ kind: 'conflict', phase: 'awaitingChoice' });
  });

  it('refreshes distinct shared documents independently', async () => {
    const f = setup();
    const other = createNoteDraftState(createSessionSnapshot(persistedSession('b')));
    f.state.documentsByHandle[other.handle] = other;
    const left = deferred<NoteSession>(); const right = deferred<NoteSession>();
    vi.mocked(readNoteSession).mockImplementation(id => id === 'a' ? left.promise : right.promise);
    const a = f.commands.refreshDocumentFromDisk(f.initialDocument);
    const b = f.commands.refreshDocumentFromDisk(other);
    expect(readNoteSession).toHaveBeenCalledTimes(2);
    right.resolve(persistedSession('b', 'right changed'));
    expect(await b).toBe('refreshed');
    expect(f.initialDocument.working.markdown).toBe('a');
    left.resolve(persistedSession('a', 'left changed'));
    expect(await a).toBe('refreshed');
    expect(other.working.markdown).toBe('right changed');
  });

  it('coalesces duplicate refreshes into exactly one trailing reread', async () => {
    const f = setup(); const first = deferred<NoteSession>(); const trailing = deferred<NoteSession>(); const trailingEntered = deferred<void>();
    vi.mocked(readNoteSession).mockReturnValueOnce(first.promise).mockImplementationOnce(() => { trailingEntered.resolve(); return trailing.promise; });
    const refreshing = f.commands.refreshDocumentFromDisk(f.initialDocument);
    const duplicate = f.commands.refreshDocumentFromDisk(f.initialDocument, { source: 'watcher' });
    expect(duplicate).toBe(refreshing); expect(readNoteSession).toHaveBeenCalledOnce();
    first.resolve(persistedSession()); await trailingEntered.promise;
    trailing.resolve(persistedSession('a', 'trailing content'));
    expect(await refreshing).toBe('refreshed'); expect(await duplicate).toBe('refreshed');
    expect(readNoteSession).toHaveBeenCalledTimes(2);
    expect(f.initialDocument.savedBaseline?.content.markdown).toBe('trailing content');
  });

  it('does not load or mutate a target when the preceding real save fails', async () => {
    const f = setup(); updateDocumentMarkdown(f.initialDocument, 'dirty');
    f.save.mockRejectedValue(new Error('save failed'));
    await expect(f.commands.openNotePath('/vault/b.md', { noteId: 'b' })).rejects.toThrow('save failed');
    expect(openNoteSession).not.toHaveBeenCalled(); expect(f.getNavigationDocument()).toBe(f.initialDocument);
    expect(f.initialDocument.working.markdown).toBe('dirty');
  });

  it('allows two panes sharing a document to complete independent opens', async () => {
    const f = setup(); await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId; await f.commands.resolvePaneCommandChoice(second, 'current');
    const firstLoad = deferred<ReturnType<typeof createSessionSnapshot>>(); const entered = deferred<void>();
    vi.mocked(openNoteSession).mockImplementationOnce(() => { entered.resolve(); return firstLoad.promise; });
    f.workspace.setActivePaneId(f.first);
    const left = f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    await entered.promise; f.workspace.setActivePaneId(second);
    const right = f.commands.openNotePath('/vault/c.md', { noteId: 'c', focusEditorAfterOpen: false });
    firstLoad.resolve(createSessionSnapshot(persistedSession('b')));
    await Promise.all([left, right]);
    expect(f.getPaneDocument(f.first).identity).toMatchObject({ noteId: 'b' });
    expect(f.getPaneDocument(second).identity).toMatchObject({ noteId: 'c' });
    f.workspace.assertInvariants();
  });



  it('records a newly remembered note identity before starting a fresh draft', async () => {
    const f = setup({ ...createEmptySessionSnapshot(), title: 'Remembered', bodyMarkdown: 'Draft body' });
    f.save.mockResolvedValue({ ...persistedSession('remembered', 'Draft body'), title: 'Remembered', path: '/vault/Remembered.md' });
    await f.commands.startNewNoteFlow();
    expect(notepadLocationMru.list(f.first)).toContainEqual({ kind: 'editor', noteId: 'remembered', notePath: '/vault/Remembered.md' });
    expect(f.getNavigationDocument().savedBaseline).toBeNull();
    expect(f.workspace.paneCommand).toMatchObject({ paneId: f.first, mode: 'start', sourceDocumentHandle: f.getNavigationDocument().handle });
  });

});
