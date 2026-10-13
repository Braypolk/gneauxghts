import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteDraftState, findOpenDocument, upsertNote } from '../state/noteStore';
import { createSessionSnapshot } from '../session/session';
import { updateDocumentMarkdown } from '../document/documentState';
import { documentRegistry } from '../document/documentRegistry';
import { finalizeNoteEditingWindow } from '$lib/features/history/historyApi';
import { notepadLocationMru } from '../navigation/locationMru';
import { createNotepadComposition, deferred, persistedSession } from './notepadCompositionTestSupport';

vi.mock('$lib/features/history/historyApi', () => ({ finalizeNoteEditingWindow: vi.fn(async () => {}) }));
const fixtures: ReturnType<typeof createNotepadComposition>[] = [];
function setup(initial?: Parameters<typeof createNotepadComposition>[0]) {
  const fixture = createNotepadComposition(initial);
  fixtures.push(fixture);
  return fixture;
}
beforeEach(() => {
  vi.clearAllMocks();
  notepadLocationMru.clearAll();
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workspace pane lifecycle through real command owners', () => {
  it('returns a policy-blocked last-pane close to ready', async () => {
    const f = setup();
    await f.commands.closePane(f.first);
    expect(f.workspace.getPaneMembership(f.first).kind).toBe('ready');
    expect(f.workspace.paneOrder).toEqual([f.first]);
    expect(f.paneLifecycle.disposePane).not.toHaveBeenCalled();
  });

  it('does not remove the pane when close preparation fails', async () => {
    const f = setup();
    await f.commands.splitWorkspace('thoughtPartner');
    updateDocumentMarkdown(f.initialDocument, 'unsaved');
    f.save.mockRejectedValue(new Error('save failed'));
    await expect(f.commands.closePane(f.first)).rejects.toThrow('save failed');
    expect(f.workspace.paneOrder).toContain(f.first);
    expect(f.workspace.getPaneMembership(f.first).kind).toBe('ready');
    expect(f.paneLifecycle.disposePane).not.toHaveBeenCalled();
  });

  it('prepares, removes, tears down, then releases retired pane state', async () => {
    const f = setup();
    await f.commands.splitWorkspace('thoughtPartner');
    const events: string[] = [];
    vi.mocked(finalizeNoteEditingWindow).mockImplementation(async () => { events.push('prepare'); });
    const retire = f.workspace.retirePane.bind(f.workspace);
    vi.spyOn(f.workspace, 'retirePane').mockImplementation((...args) => {
      events.push('remove');
      return retire(...args);
    });
    vi.mocked(f.paneLifecycle.disposePane).mockImplementation(async id => {
      events.push('dispose');
      expect(f.workspace.paneOrder).not.toContain(id);
      expect(f.workspace.getPaneMembership(id).kind).toBe('retiring');
    });
    const complete = f.workspace.completePaneDisposal.bind(f.workspace);
    vi.spyOn(f.workspace, 'completePaneDisposal').mockImplementation((...args) => {
      events.push('finalize');
      return complete(...args);
    });
    await f.commands.closePane(f.first);
    expect(events).toEqual(['prepare', 'remove', 'dispose', 'finalize']);
    expect(f.workspace.getPaneMembership(f.first).kind).toBe('disposed');
  });

  it('blocks two dirty collision drafts, then drains a cleaned side without rewriting it', async () => {
    const f = setup(createSessionSnapshot({ ...persistedSession('left', 'left baseline'), path: '/vault/Shared.md' }));
    await f.commands.splitWorkspace();
    const rightPane = f.workspace.activePaneId;
    await f.commands.resolvePaneCommandChoice(rightPane, 'current');
    const right = createNoteDraftState(createSessionSnapshot({ ...persistedSession('right', 'right baseline'), path: '/vault/Shared.md' }));
    upsertNote(f.state, right);
    f.workspace.setPaneDocumentHandle(rightPane, right.handle);
    updateDocumentMarkdown(right, 'right dirty');
    updateDocumentMarkdown(f.initialDocument, 'left dirty');
    await f.commands.closePane(f.first);
    expect(f.workspace.getPaneMembership(f.first).kind).toBe('ready');
    expect(f.save).not.toHaveBeenCalled();

    updateDocumentMarkdown(f.initialDocument, 'left baseline');
    const runtime = documentRegistry.ensure(f.initialDocument.handle);
    const queued = deferred<void>();
    runtime.requestSave(() => queued.promise);
    const waiting = deferred<void>();
    const getQueue = runtime.getSaveQueue.bind(runtime);
    vi.spyOn(runtime, 'getSaveQueue').mockImplementation(() => { waiting.resolve(); return getQueue(); });
    const cancel = vi.spyOn(runtime, 'clearSaveTimer');
    const close = f.commands.closePane(f.first);
    await waiting.promise;
    expect(f.workspace.paneOrder).toContain(f.first);
    expect(f.paneLifecycle.saveCursorPosition).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    queued.resolve();
    await close;
    expect(f.paneLifecycle.saveCursorPosition).toHaveBeenCalledWith(f.first, f.initialDocument, undefined);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.state.documentsByHandle[f.initialDocument.handle]).toBeUndefined();
    expect(right.canonicalCollision).toBeNull();
    expect(findOpenDocument(f.state, { noteId: 'right', path: '/vault/Shared.md' })).toBe(right);
  });

  it('creates chat with retained context and no throwaway editor or draft', async () => {
    const f = setup();
    vi.mocked(f.deps.presentation.focusPaneEditor).mockReturnValue(false);
    await f.commands.splitWorkspace('thoughtPartner');
    const second = f.workspace.activePaneId;
    expect(f.getPaneDocument(second)).toBe(f.initialDocument);
    expect(Object.keys(f.state.documentsByHandle)).toEqual([f.initialDocument.handle]);
    expect(f.workspace.paneCommand.paneId).toBeNull();
    expect(f.paneLifecycle.ensurePaneEditors).not.toHaveBeenCalled();
    expect(notepadLocationMru.list(second)).toContainEqual({ kind: 'editor', noteId: 'a', notePath: '/vault/a.md' });
    expect(f.deps.presentation.focusPaneChat).toHaveBeenCalledWith(second);
    expect(f.workspace.getPaneMembership(second).kind).toBe('ready');
  });

  it.each(['current', 'previous'] as const)('admits a %s chat split directly with its retained identity', async choice => {
    const f = setup();
    const location = { kind: 'chat' as const, conversationId: 'retained-chat',
      contextNoteId: 'a', contextNotePath: '/vault/a.md' };
    if (choice === 'current') {
      await f.commands.setPaneKind(f.first, 'chat');
      f.workspace.setPaneConversationId(f.first, location.conversationId);
    } else {
      notepadLocationMru.touch(f.first, location);
    }
    vi.mocked(f.paneLifecycle.ensurePaneEditors).mockClear();
    const admit = vi.spyOn(f.workspace, 'completePaneCreation');
    await f.commands.splitWorkspace(choice);
    const second = f.workspace.activePaneId;
    expect(admit).toHaveBeenCalledWith(second, expect.any(Number), f.initialDocument.handle, 'chat');
    expect(f.workspace.getPaneState(second)).toMatchObject({ kind: 'chat', chatConversationId: 'retained-chat' });
    expect(f.getPaneDocument(second)).toBe(f.initialDocument);
    expect(Object.keys(f.state.documentsByHandle)).toEqual([f.initialDocument.handle]);
    expect(f.workspace.paneCommand.paneId).toBeNull();
    expect(f.paneLifecycle.ensurePaneEditors).not.toHaveBeenCalled();
  });

  it('disposes a creating runtime when split preparation fails', async () => {
    const f = setup();
    vi.mocked(f.deps.derivedViews.loadRecentNotes).mockRejectedValue(new Error('recent notes unavailable'));
    await expect(f.commands.splitWorkspace()).rejects.toThrow('recent notes unavailable');
    expect(f.workspace.getPaneMembership('notepad-pane-2').kind).toBe('disposed');
    expect(f.workspace.paneOrder).toEqual([f.first]);
    expect(f.paneLifecycle.disposePane).toHaveBeenCalledWith('notepad-pane-2');
  });

  it('inherits the split from the active pane, not the first pane in order', async () => {
    const f = setup();
    await f.commands.splitWorkspace('thoughtPartner');
    const second = f.workspace.activePaneId;
    const other = createNoteDraftState(createSessionSnapshot(persistedSession('other')));
    upsertNote(f.state, other);
    f.workspace.setPaneDocumentHandle(second, other.handle);
    await f.commands.splitWorkspace();
    expect(f.workspace.paneCommand).toMatchObject({
      paneId: f.workspace.activePaneId, sourcePaneId: second, sourceDocumentHandle: other.handle, mode: 'split'
    });
  });

  it('changes only the selected shared editor into retained chat', async () => {
    const f = setup();
    await f.commands.splitWorkspace();
    const second = f.workspace.activePaneId;
    await f.commands.resolvePaneCommandChoice(second, 'current');
    await f.commands.setPaneKind(second, 'chat');
    expect(f.workspace.getPaneState(second)).toMatchObject({ kind: 'chat', documentHandle: f.initialDocument.handle });
    expect(f.workspace.getPaneState(f.first)).toMatchObject({ kind: 'editor', documentHandle: f.initialDocument.handle });
  });
});
