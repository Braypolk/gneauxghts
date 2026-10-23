import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotepadComposition, deferred, persistedSession } from './notepadCompositionTestSupport';
import { createEmptySessionSnapshot, createSessionSnapshot, openNoteSession, readNoteSession, clearLastOpenedNote } from '../session/session';
import { finalizeNoteEditingWindow } from '#lib/features/history/historyApi.js';
import { notepadLocationMru, type NavLocation } from '../navigation/locationMru';
import { updateDocumentMarkdown, dispatchDocumentExternalSync, externalDocumentSnapshotFromCommittedNote } from '../document/documentState';
import { saveEditorViewState, loadEditorViewState } from '../editor/editorViewState';
import type { SearchItem } from '#lib/types/semantic.js';
vi.mock('../session/session', async importOriginal => ({
  ...await importOriginal<typeof import('../session/session')>(),
  openNoteSession: vi.fn(), readNoteSession: vi.fn(), clearLastOpenedNote: vi.fn(async () => {})
}));
vi.mock('#lib/features/history/historyApi.js', () => ({ finalizeNoteEditingWindow: vi.fn(async () => {}) }));
const fixtures: ReturnType<typeof createNotepadComposition>[] = [];
function setup(initial?: Parameters<typeof createNotepadComposition>[0]) {
  const fixture = createNotepadComposition(initial);
  fixtures.push(fixture);
  return fixture;
}
const editorLocation = (id: string): NavLocation => ({ kind: 'editor', noteId: id, notePath: `/vault/${id}.md` });
const chatLocation = (): NavLocation => ({ kind: 'chat', conversationId: 'chat-1', contextNoteId: 'a', contextNotePath: '/vault/a.md' });
beforeEach(() => {
  vi.clearAllMocks();
  notepadLocationMru.clearAll();
  vi.stubGlobal('document', { activeElement: null });
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { setTimeout, clearTimeout, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  }});
  vi.mocked(finalizeNoteEditingWindow).mockResolvedValue(undefined);
  vi.mocked(openNoteSession).mockImplementation(async (id, path) => createSessionSnapshot({ ...persistedSession(id ?? 'opened'), path }));
});
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workspace destinations and history', () => {
  it('retries recent locations after failed startup seeding', async () => {
    const f = setup();
    vi.mocked(f.deps.derivedViews.loadRecentNotes).mockResolvedValueOnce(null).mockResolvedValueOnce([{ noteId: 'b', notePath: '/vault/b.md' } as SearchItem]);
    expect(await f.commands.listLocationHistory()).toEqual([]);
    expect(await f.commands.listLocationHistory()).toEqual([{ location: editorLocation('b'), label: 'b' }]);
    expect(f.deps.derivedViews.loadRecentNotes).toHaveBeenCalledTimes(2);
  });

  it.each(['previous', 'explicit', 'beside-editor'] as const)('restores retained chat through %s navigation', async mode => {
    const f = setup();
    if (mode === 'beside-editor') {
      await f.commands.splitWorkspace();
      await f.commands.resolvePaneCommandChoice(f.workspace.activePaneId, 'current');
      f.workspace.setActivePaneId(f.first);
    }
    vi.mocked(f.deps.presentation.focusPaneEditor).mockReturnValue(false);
    if (mode === 'explicit') await f.commands.openLocationFromHistory(chatLocation());
    else {
      notepadLocationMru.touch(f.first, chatLocation());
      await f.commands.goToPreviousLocation();
    }
    expect(f.workspace.getPaneState(f.first)).toMatchObject({ kind: 'chat', chatConversationId: 'chat-1', documentHandle: f.initialDocument.handle });
    expect(openNoteSession).not.toHaveBeenCalled();
    expect(f.deps.presentation.focusPaneChat).toHaveBeenCalledWith(f.first);
  });

  it('drops a missing previous note, restores the next, and resumes MRU recording', async () => {
    const f = setup();
    notepadLocationMru.touch(f.first, editorLocation('b'));
    notepadLocationMru.touch(f.first, editorLocation('missing'));
    vi.mocked(openNoteSession).mockRejectedValueOnce(new Error('Missing note path'));
    await f.commands.goToPreviousLocation();
    expect(openNoteSession).toHaveBeenNthCalledWith(1, 'missing', '/vault/missing.md');
    expect(openNoteSession).toHaveBeenNthCalledWith(2, 'b', '/vault/b.md');
    expect(f.getNavigationDocument().identity).toMatchObject({ noteId: 'b' });
    expect(notepadLocationMru.list(f.first)).not.toContainEqual(editorLocation('missing'));
    f.commands.touchCurrentLocation();
    expect(notepadLocationMru.list(f.first)).toContainEqual(editorLocation('b'));
  });

  it('preserves pane and conversation after failed finalization, then retries', async () => {
    const f = setup();
    vi.mocked(finalizeNoteEditingWindow).mockRejectedValueOnce(new Error('seal failed'));
    await expect(f.commands.openLocationFromHistory(chatLocation())).rejects.toThrow('seal failed');
    expect(f.workspace.getPaneState(f.first)).toMatchObject({ kind: 'editor', chatConversationId: null });
    expect(f.paneLifecycle.saveCursorPosition).not.toHaveBeenCalled();
    expect(clearLastOpenedNote).not.toHaveBeenCalled();
    await f.commands.openLocationFromHistory(chatLocation());
    expect(f.workspace.getPaneState(f.first)).toMatchObject({ kind: 'chat', chatConversationId: 'chat-1' });
    expect(finalizeNoteEditingWindow).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('keeps feedback suppressed until both pane restores finish (second fails=%s)', async fails => {
    const f = setup();
    await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId;
    await f.commands.resolvePaneCommandChoice(second, 'current');
    const presented = deferred<void>();
    const firstEntered = deferred<void>();
    const secondLoad = deferred<ReturnType<typeof createSessionSnapshot>>();
    const secondEntered = deferred<void>();
    vi.mocked(f.paneLifecycle.bindDocument).mockImplementationOnce(async () => { firstEntered.resolve(); await presented.promise; return 'applied'; });
    vi.mocked(openNoteSession).mockResolvedValueOnce(createSessionSnapshot(persistedSession('b'))).mockImplementationOnce(() => { secondEntered.resolve(); return secondLoad.promise; });
    f.workspace.setActivePaneId(f.first);
    const first = f.commands.openLocationFromHistory(editorLocation('b'));
    await firstEntered.promise;
    f.workspace.setActivePaneId(second);
    const right = f.commands.openLocationFromHistory(editorLocation('c'));
    await secondEntered.promise;
    presented.resolve();
    await first;
    const previous = [...notepadLocationMru.list(f.first)];
    f.commands.touchCurrentLocation(f.first);
    expect(notepadLocationMru.list(f.first)).toEqual(previous);
    if (fails) {
      secondLoad.reject(new Error('second failed'));
      await expect(right).rejects.toThrow('second failed');
    } else {
      secondLoad.resolve(createSessionSnapshot(persistedSession('c')));
      await right;
    }
    f.commands.touchCurrentLocation(f.first);
    expect(notepadLocationMru.list(f.first)).toContainEqual(editorLocation('b'));
  });
});

describe('document departure admission', () => {
  it('does not name an untitled note when reopening that same note', async () => {
    const saved = { noteId: 'capture', path: '/vault/Untitled Note capture.md', title: '', markdown: 'Still writing' };
    const f = setup(createSessionSnapshot(saved));
    vi.mocked(openNoteSession).mockResolvedValueOnce(createSessionSnapshot(saved));
    await f.commands.openNotePath(saved.path, { noteId: saved.noteId });
    expect(f.getNavigationDocument().working.title).toBe('');
    expect(f.save).not.toHaveBeenCalled();
    expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
  });

  it('keeps autosaved capture titles blank, then names from eight first-line words on departure', async () => {
    const body = 'Collect rainwater for the tomatoes while we travel next summer.\n\nKeep the full body.';
    const f = setup({ ...createEmptySessionSnapshot(), bodyMarkdown: body });
    f.save.mockImplementation(async (title, markdown) => ({ noteId: 'capture',
      path: `/vault/${title || 'Untitled Note capture'}.md`, title, markdown }));
    await f.persistence.enqueueSave(f.initialDocument);
    expect(f.initialDocument.working.title).toBe('');
    expect(f.initialDocument.identity).toMatchObject({ noteId: 'capture', path: '/vault/Untitled Note capture.md' });
    await f.commands.startNewNoteFlow();
    expect(f.save).toHaveBeenLastCalledWith('Collect rainwater for the tomatoes while we travel', body,
      '/vault/Untitled Note capture.md', undefined, 'capture');
    expect(f.getNavigationDocument().working.title).toBe('');
  });

  it('keeps a capture untitled while another editor still displays it', async () => {
    const f = setup(createSessionSnapshot({ noteId: 'capture', path: '/vault/Untitled Note capture.md',
      title: '', markdown: 'A quiet place to collect new ideas' }));
    await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId;
    await f.commands.resolvePaneCommandChoice(second, 'current');
    await f.commands.setPaneKind(f.first, 'chat');
    expect(f.initialDocument.working.title).toBe('');
    expect(f.save).not.toHaveBeenCalled();
    f.save.mockImplementation(async (title, markdown) => ({ noteId: 'capture', path: `/vault/${title}.md`, title, markdown }));
    await f.commands.setPaneKind(second, 'chat');
    expect(f.initialDocument.working.title).toBe('A quiet place to collect new ideas');
    expect(f.save).toHaveBeenCalledOnce();
  });

  it('retains the document and chosen fallback when its departure rename fails', async () => {
    const f = setup(createSessionSnapshot({ noteId: 'capture', path: '/vault/Untitled Note capture.md',
      title: '', markdown: 'Keep this idea safe' }));
    f.save.mockRejectedValueOnce(new Error('rename failed'));
    await expect(f.commands.startNewNoteFlow()).rejects.toThrow('rename failed');
    expect(f.getNavigationDocument()).toBe(f.initialDocument);
    expect(f.initialDocument.identity).toMatchObject({ path: '/vault/Untitled Note capture.md' });
    expect(f.initialDocument.working.title).toBe('Keep this idea safe');
    expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
  });

  it('saves a newer typed title before departing when the fallback save is already pending', async () => {
    const body = 'First-line fallback';
    const f = setup(createSessionSnapshot({ noteId: 'capture', path: '/vault/Untitled Note capture.md', title: '', markdown: body }));
    const entered = deferred<void>();
    const held = deferred<void>();
    f.save.mockImplementation(async (title, markdown) => {
      if (title === body) { entered.resolve(); await held.promise; }
      return { noteId: 'capture', path: `/vault/${title}.md`, title, markdown };
    });
    const departure = f.commands.startNewNoteFlow();
    await entered.promise;
    f.editing.updateTitle(f.initialDocument, 'My chosen title');
    held.resolve();
    await departure;
    expect(f.save).toHaveBeenLastCalledWith('My chosen title', body, `/vault/${body}.md`, undefined, 'capture');
    expect(f.initialDocument.savedBaseline?.content.title).toBe('My chosen title');
    expect(f.getNavigationDocument()).not.toBe(f.initialDocument);
  });

  it.each([
    { edits: ['Temporary title', ''], expected: 'First-line fallback' },
    { edits: ['   '], expected: 'First-line fallback' },
    { edits: ['', 'My chosen title'], expected: 'My chosen title' }
  ])('settles the latest title edits $edits during a pending departure save', async ({ edits, expected }) => {
    const body = 'First-line fallback';
    const f = setup(createSessionSnapshot({ noteId: 'capture', path: '/vault/Untitled Note capture.md', title: '', markdown: body }));
    const entered = deferred<void>();
    const held = deferred<void>();
    f.save.mockImplementation(async (title, markdown) => {
      if (f.save.mock.calls.length === 1) { entered.resolve(); await held.promise; }
      return { noteId: 'capture', path: `/vault/${title || 'Untitled Note capture'}.md`, title, markdown };
    });
    const departure = f.commands.startNewNoteFlow();
    await entered.promise;
    for (const title of edits) f.editing.updateTitle(f.initialDocument, title);
    held.resolve();
    await departure;
    expect(f.initialDocument.working.title).toBe(expected);
    expect(f.initialDocument.savedBaseline?.content.title).toBe(expected);
    expect(f.initialDocument.savedBaseline?.content.body.toMarkdown()).toBe(body);
    expect(f.initialDocument.identity).toMatchObject({ noteId: 'capture', path: `/vault/${expected}.md` });
    expect(f.getNavigationDocument()).not.toBe(f.initialDocument);
  });

  it('retains the latest typed title if edits keep outpacing the departure saves', async () => {
    const f = setup(createSessionSnapshot({ noteId: 'capture', path: '/vault/Untitled Note capture.md', title: '', markdown: 'First-line fallback' }));
    let edits = 0;
    f.save.mockImplementation(async (title, markdown) => {
      f.editing.updateTitle(f.initialDocument, `Newer typed title ${++edits}`);
      return { noteId: 'capture', path: `/vault/${title}.md`, title, markdown };
    });
    await expect(f.commands.startNewNoteFlow()).rejects.toThrow('could not be saved');
    expect(f.getNavigationDocument()).toBe(f.initialDocument);
    expect(f.initialDocument.working.title).toBe('Newer typed title 3');
    expect(f.initialDocument.savedBaseline?.content.title).toBe('Newer typed title 2');
    expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
  });

  it('saves assigned identity before finalizing and storing its cursor', async () => {
    const f = setup({ ...createEmptySessionSnapshot(), title: 'Draft', bodyMarkdown: 'body' });
    f.save.mockResolvedValue({ ...persistedSession('saved', 'body'), title: 'Draft' });
    const events: string[] = [];
    vi.mocked(finalizeNoteEditingWindow).mockImplementation(async id => {
      expect(id).toBe('saved'); events.push('finalized');
    });
    vi.mocked(f.paneLifecycle.saveCursorPosition).mockImplementation(async (paneId, note) => {
      expect(note.identity).toMatchObject({ noteId: 'saved', path: '/vault/saved.md' });
      saveEditorViewState('/vault/saved.md', { anchor: 2, head: 2 }, paneId, 'saved');
      events.push('cursor');
      return 'applied';
    });
    vi.mocked(clearLastOpenedNote).mockImplementation(async () => { events.push('cleared'); });
    await f.commands.startNewNoteFlow();
    expect(events).toEqual(['finalized', 'cursor', 'cleared']);
    expect(loadEditorViewState('/vault/saved.md', f.first, 'saved')).toEqual({ anchor: 2, head: 2 });
  });

  it.each([false, true])('serializes shared departures and recovers a failed first departure (%s)', async fails => {
    const f = setup();
    await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId;
    await f.commands.resolvePaneCommandChoice(second, 'current');
    const cursor = deferred<void>();
    const entered = deferred<void>();
    vi.mocked(f.paneLifecycle.saveCursorPosition).mockImplementationOnce(async () => {
      entered.resolve(); await cursor.promise;
      if (fails) throw new Error('cursor failed');
      return 'applied';
    });
    const left = f.commands.setPaneKind(f.first, 'chat').catch(error => error.message);
    await entered.promise;
    const right = f.commands.setPaneKind(second, 'chat');
    expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
    cursor.resolve();
    expect(await left).toBe(fails ? 'cursor failed' : undefined);
    await right;
    if (fails) {
      expect(f.workspace.getPaneState(f.first).kind).toBe('editor');
      expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
      await f.commands.setPaneKind(f.first, 'chat');
    }
    expect(f.workspace.getEditorPaneIds()).toEqual([]);
    expect(finalizeNoteEditingWindow).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('saves a transient location without sealing when Previous has no destination, then seals on actual departure', async () => {
    const f = setup({ ...createEmptySessionSnapshot(), title: 'Draft', bodyMarkdown: 'body' });
    f.save.mockResolvedValue({ ...persistedSession('a', 'body'), title: 'Draft' });
    await f.commands.goToPreviousLocation();
    expect(f.save).toHaveBeenCalledOnce();
    expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
    notepadLocationMru.touch(f.first, editorLocation('b'));
    await f.commands.goToPreviousLocation();
    expect(finalizeNoteEditingWindow).toHaveBeenCalledExactlyOnceWith('a');
    expect(f.save).toHaveBeenCalledOnce();
  });

  it('rejects superseded same-pane loads without blocking the next admitted destination', async () => {
    const f = setup();
    const old = deferred<ReturnType<typeof createSessionSnapshot>>();
    const entered = deferred<void>();
    vi.mocked(openNoteSession).mockImplementationOnce(() => { entered.resolve(); return old.promise; });
    const first = f.commands.openNotePath('/vault/b.md', { noteId: 'b' });
    await entered.promise;
    const second = f.commands.openNotePath('/vault/c.md', { noteId: 'c' });
    old.resolve(createSessionSnapshot(persistedSession('b')));
    await Promise.all([first, second]);
    expect(f.getNavigationDocument().identity).toMatchObject({ noteId: 'c' });
    expect(f.paneLifecycle.bindDocument).toHaveBeenCalledOnce();
  });
});

describe('picker and activation', () => {
  it('keeps Previous open without a destination, then applies one resolved location', async () => {
    const f = setup();
    await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId;
    await f.commands.resolvePaneCommandChoice(second, 'previous');
    expect(f.workspace.paneCommand.paneId).toBe(second);
    expect(openNoteSession).not.toHaveBeenCalled();
    notepadLocationMru.touch(f.first, editorLocation('b'));
    await f.commands.resolvePaneCommandChoice(second, 'previous');
    expect(f.workspace.paneCommand.paneId).toBeNull();
    expect(openNoteSession).toHaveBeenCalledExactlyOnceWith('b', '/vault/b.md');
    expect(f.getPaneDocument(second).identity).toMatchObject({ noteId: 'b' });
  });

  it('does not consume a picker from a superseded location lookup', async () => {
    const f = setup();
    await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId;
    notepadLocationMru.clearAll();
    const load = deferred<SearchItem[]>();
    const entered = deferred<void>();
    vi.mocked(f.deps.derivedViews.loadRecentNotes).mockImplementationOnce(() => { entered.resolve(); return load.promise; });
    const choosing = f.commands.resolvePaneCommandChoice(second, 'previous');
    await entered.promise;
    await f.commands.setPaneKind(second, 'editor');
    load.resolve([]);
    await choosing;
    expect(f.workspace.paneCommand.paneId).toBe(second);
    expect(openNoteSession).not.toHaveBeenCalled();
  });

  it('activates the concrete pane and refreshes its derived views', async () => {
    const f = setup();
    await f.commands.splitWorkspace('thoughtPartner');
    vi.clearAllMocks();
    f.commands.activatePane(f.first);
    expect(f.workspace.activePaneId).toBe(f.first);
    expect(f.deps.derivedViews.scheduleSearchIfNeeded).toHaveBeenCalledOnce();
    expect(f.deps.derivedViews.scheduleRelatedIfNeeded).toHaveBeenCalledWith({ immediate: true });
  });
});

it('selects the nearest editor for navigation and cycles real workspace panes', async () => {
  const f = setup();
  await f.commands.splitWorkspace();
  const second = f.workspace.activePaneId;
  await f.commands.resolvePaneCommandChoice(second, 'current');
  await f.commands.setPaneKind(f.first, 'chat');
  f.workspace.setPaneConversationId(f.first, 'retained-conversation');
  f.workspace.setActivePaneId(f.first);
  expect(f.workspace.getEditorPaneIds()).toEqual([second]);
  expect(f.workspace.getNavigationPaneId()).toBe(second);
  expect(f.workspace.getNextPaneId(second)).toBe(f.first);

  await f.commands.openNotePath('/vault/b.md', { noteId: 'b' });

  expect(f.workspace.activePaneId).toBe(second);
  expect(f.workspace.getPaneState(f.first)).toMatchObject({
    kind: 'chat',
    chatConversationId: 'retained-conversation',
    documentHandle: f.initialDocument.handle
  });
  expect(f.getPaneDocument(second).identity).toMatchObject({
    kind: 'persisted', noteId: 'b', path: '/vault/b.md'
  });
});

it('opens an explicit note selection in the chosen chat pane and retains its previous location', async () => {
  const f = setup();
  await f.commands.splitWorkspace('thoughtPartner');
  const chat = f.workspace.activePaneId;
  f.workspace.setPaneConversationId(chat, 'retained-conversation');
  await f.commands.openNotePath('/vault/b.md', { noteId: 'b', paneId: chat });
  expect(f.workspace.activePaneId).toBe(chat);
  expect(f.workspace.getPaneState(chat)).toMatchObject({ kind: 'editor' });
  expect(f.getPaneDocument(chat).identity).toMatchObject({ noteId: 'b' });
  expect(f.getPaneDocument(f.first)).toBe(f.initialDocument);
  expect(notepadLocationMru.list(chat)).toContainEqual(expect.objectContaining({ kind: 'chat', conversationId: 'retained-conversation' }));
});

describe('discovery results in a new split', () => {
  it('loads the selected note beside the retained dirty source without saving or leaving it', async () => {
    const f = setup();
    updateDocumentMarkdown(f.initialDocument, 'retained local work');
    const destination = await f.commands.openNoteInSplit('/vault/b.md', { noteId: 'b' });
    expect(destination).not.toBeNull();
    expect(f.workspace.paneOrder).toEqual([f.first, destination]);
    expect(f.workspace.activePaneId).toBe(destination);
    expect(f.workspace.paneCommand.paneId).toBeNull();
    expect(f.getPaneDocument(f.first)).toBe(f.initialDocument);
    expect(f.initialDocument.working.body.toMarkdown()).toBe('retained local work');
    expect(f.getPaneDocument(destination!)).toMatchObject({ identity: { noteId: 'b', path: '/vault/b.md' } });
    expect(f.save).not.toHaveBeenCalled();
    expect(finalizeNoteEditingWindow).not.toHaveBeenCalled();
    expect(f.deps.presentation.focusPaneEditor).toHaveBeenCalledWith(destination);
    f.workspace.assertInvariants();
  });

  it('retains the solo workspace when loading fails and permits retry', async () => {
    const f = setup();
    vi.mocked(openNoteSession).mockRejectedValueOnce(new Error('Missing note path'));
    await expect(f.commands.openNoteInSplit('/vault/missing.md')).rejects.toThrow('Missing note path');
    expect(f.workspace.paneOrder).toEqual([f.first]);
    expect(f.workspace.activePaneId).toBe(f.first);
    expect(f.getPaneDocument(f.first)).toBe(f.initialDocument);
    f.workspace.assertInvariants();
    expect(await f.commands.openNoteInSplit('/vault/b.md')).not.toBeNull();
  });

  it('shares the retained document when the result is the current dirty note', async () => {
    const f = setup();
    updateDocumentMarkdown(f.initialDocument, 'newer local text');
    const destination = await f.commands.openNoteInSplit('/vault/a.md', { noteId: 'a' });
    expect(f.getPaneDocument(destination!)).toBe(f.initialDocument);
    expect(f.initialDocument.working.body.toMarkdown()).toBe('newer local text');
    expect(f.save).not.toHaveBeenCalled();
    f.workspace.assertInvariants();
  });

  it('admits only one simultaneous split and refuses existing split layouts', async () => {
    const f = setup();
    const load = deferred<ReturnType<typeof createSessionSnapshot>>();
    vi.mocked(openNoteSession).mockImplementation(() => load.promise);
    const first = f.commands.openNoteInSplit('/vault/b.md', { noteId: 'b' });
    const second = f.commands.openNoteInSplit('/vault/b.md', { noteId: 'b' });
    load.resolve(createSessionSnapshot(persistedSession('b')));
    const results = await Promise.all([first, second]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(f.workspace.paneOrder).toHaveLength(2);
    const active = f.workspace.activePaneId;
    expect(await f.commands.openNoteInSplit('/vault/c.md')).toBeNull();
    expect(f.workspace.activePaneId).toBe(active);
    expect(f.workspace.paneOrder).toHaveLength(2);
    f.workspace.assertInvariants();
  });

  it('retains a chat source and selects an editor destination immediately', async () => {
    const f = setup();
    await f.commands.setPaneKind(f.first, 'chat');
    f.workspace.setPaneConversationId(f.first, 'original-chat');
    const destination = await f.commands.openNoteInSplit('/vault/b.md', { noteId: 'b' });
    expect(f.workspace.getPaneState(f.first)).toMatchObject({ kind: 'chat', chatConversationId: 'original-chat' });
    expect(f.workspace.getPaneState(destination!)).toMatchObject({ kind: 'editor' });
  });
});

it('waits for pane presentation and rejects stale keyboard focus after a newer activation', async () => {
  const f = setup();
  await f.commands.splitWorkspace('thoughtPartner');
  const second = f.workspace.activePaneId;
  const settled = deferred<void>();
  const entered = deferred<void>();
  f.deps.presentation.waitForPaneMotion = async () => {
    entered.resolve();
    await settled.promise;
  };
  vi.clearAllMocks();
  const switching = f.commands.switchActivePane();
  await entered.promise;
  expect(f.workspace.activePaneId).toBe(f.first);
  expect(f.deps.presentation.focusPaneEditor).not.toHaveBeenCalled();
  f.commands.activatePane(second);
  settled.resolve();
  await switching;
  expect(f.deps.presentation.focusPaneEditor).not.toHaveBeenCalled();
  await f.commands.switchActivePane();
  expect(f.deps.presentation.focusPaneEditor).toHaveBeenCalledWith(f.first);
});

it('retains the current chat when its dirty context blocks restoration of another conversation', async () => {
  const f = setup();
  await f.commands.setPaneKind(f.first, 'chat');
  f.workspace.setPaneConversationId(f.first, 'original-chat');
  updateDocumentMarkdown(f.initialDocument, 'local work');
  dispatchDocumentExternalSync(f.initialDocument, {
    type: 'externalCaptured',
    external: {
      kind: 'snapshot', source: 'watcher',
      document: externalDocumentSnapshotFromCommittedNote({ ...persistedSession('a'), markdown: 'external work' })
    }
  });
  await f.commands.openLocationFromHistory({
    kind: 'chat', conversationId: 'other-chat', contextNoteId: 'b', contextNotePath: '/vault/b.md'
  });
  expect(f.workspace.getPaneState(f.first)).toMatchObject({
    kind: 'chat', chatConversationId: 'original-chat', documentHandle: f.initialDocument.handle
  });
  expect(openNoteSession).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it('retires a pending open and disk refresh when the workspace is disposed', async () => {
  const f = setup();
  const opened = deferred<ReturnType<typeof createSessionSnapshot>>();
  const disk = deferred<ReturnType<typeof persistedSession>>();
  const entered = deferred<void>();
  vi.mocked(openNoteSession).mockImplementationOnce(() => {
    entered.resolve();
    return opened.promise;
  });
  vi.mocked(readNoteSession).mockReturnValueOnce(disk.promise);
  const refresh = f.commands.refreshDocumentFromDisk(f.initialDocument);
  const opening = f.commands.openNotePath('/vault/b.md', { noteId: 'b' });
  await entered.promise;
  f.commands.dispose();
  opened.resolve(createSessionSnapshot(persistedSession('b')));
  disk.resolve(persistedSession('a', 'late disk'));
  await opening;
  expect(await refresh).toBe('stale');
  expect(f.getPaneDocument(f.first)).toBe(f.initialDocument);
  expect(f.initialDocument.working.body.toMarkdown()).toBe('a');
  expect(f.paneLifecycle.bindDocument).not.toHaveBeenCalled();
});

it('keeps pane capacity when two splits finish asynchronous preparation together', async () => {
  const f = setup();
  await f.commands.splitWorkspace('thoughtPartner');
  expect(f.workspace.paneOrder).toHaveLength(2);
  const recent = deferred<SearchItem[]>();
  vi.mocked(f.deps.derivedViews.loadRecentNotes)
    .mockImplementationOnce(() => recent.promise)
    .mockImplementationOnce(() => recent.promise);

  const firstSplit = f.commands.splitWorkspace('thoughtPartner');
  const secondSplit = f.commands.splitWorkspace('thoughtPartner');
  recent.resolve([]);
  await Promise.all([firstSplit, secondSplit]);

  expect(f.workspace.paneOrder).toHaveLength(f.deps.maxVisiblePanes);
  f.workspace.assertInvariants();
});
