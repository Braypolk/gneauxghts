import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotepadComposition, deferred, persistedSession } from './notepadCompositionTestSupport';
import { createNotepadWorkspaceSession } from './notepadWorkspaceSession';
import { createWorkspacePersistenceService } from '../workspace/workspacePersistenceService';
import { createNotepadProposalAdapter } from './notepadProposalAdapter';
import { createProposalReviewSession } from '$lib/features/proposals/reviewSession.svelte';
import { createReviewEditorForTest } from '$lib/features/proposals/proposalEditorTestSupport';
import { createSessionSnapshot, openNoteSession, readNoteSession } from '../session/session';
import type { NotepadPaneId } from '../workspace/workspaceStore.svelte';
import { documentRegistry } from '../document/documentRegistry';
import { updateDocumentMarkdown } from '../document/documentState';
import { captureExternalSnapshotForTest } from '../document/documentExternalSyncTestSupport';
import type { DurableProposalReviewRequest } from '$lib/features/proposals/types';
vi.mock('../session/session', async original => ({ ...await original<typeof import('../session/session')>(), openNoteSession: vi.fn(), readNoteSession: vi.fn(), clearLastOpenedNote: vi.fn(async () => {}) }));
vi.mock('$lib/features/history/historyApi', () => ({ finalizeNoteEditingWindow: vi.fn(async () => {}) }));
const fixtures: ReturnType<typeof createNotepadComposition>[] = [];
function setup() {
  const f = createNotepadComposition();
  const editors = new Map<NotepadPaneId, { handle: string; editor: ReturnType<typeof createReviewEditorForTest> }>();
  const getEditor = (id: NotepadPaneId) => {
    if (f.workspace.getPaneState(id).kind !== 'editor') return null;
    const document = f.getPaneDocument(id);
    let entry = editors.get(id);
    if (!entry || entry.handle !== document.handle) {
      entry?.editor.dispose();
      entry = { handle: document.handle, editor: createReviewEditorForTest(document) };
      editors.set(id, entry);
    }
    return entry.editor.adapter;
  };
  const session = createProposalReviewSession();
  const createAdapter = (commands = f.commands) => createNotepadProposalAdapter({
    session,
    workspace: f.workspace,
    state: f.state,
    commands,
    documentEditing: f.editing,
    getEditor
  });
  const adapter = createAdapter();
  fixtures.push({ ...f, dispose: async () => {
    adapter.orchestration.dispose();
    const review = session.workflow.kind === 'idle' ? null : session.workflow.review;
    if (review) documentRegistry.get(review.document.handle)?.resources()?.runtime.endReview(review.request.preview.reviewId);
    for (const entry of editors.values()) entry.editor.dispose();
    await f.dispose();
  } });
  f.setReviewing(adapter.orchestration.session.isReviewingDocument);
  const request = (id = 'a'): DurableProposalReviewRequest => ({
    proposalId: `proposal-${id}`, noteId: id,
    preview: { reviewId: `review-${id}`, notePath: `/vault/${id}.md`, title: id, baseContentHash: 'hash', baseEditorMarkdown: id, proposedEditorMarkdown: 'proposed',
      hunks: [{ id: `hunk-${id}`, baseFrom: 0, baseTo: id.length, proposedFrom: 0, proposedTo: 8, oldText: id, newText: 'proposed' }] },
    commit: vi.fn<DurableProposalReviewRequest['commit']>(async () => ({ status: 'committed', applied: { kind: 'updateNote', path: `/vault/${id}.md`, previousPath: `/vault/${id}.md` }, noteId: id, message: null, committedMarkdown: 'proposed' })),
    dismiss: vi.fn(async () => {})
  });
  const remount = () => {
    for (const entry of editors.values()) entry.editor.dispose();
    editors.clear();
    return createAdapter(createNotepadWorkspaceSession(f.deps)).orchestration;
  };
  return { ...f, ...adapter, request, getEditor, remount };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('document', { activeElement: null }); vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.mocked(openNoteSession).mockImplementation(async id => createSessionSnapshot(persistedSession(id ?? 'a')));
  vi.mocked(readNoteSession).mockImplementation(async id => persistedSession(id ?? 'a'));
});
afterEach(async () => { for (const f of fixtures.splice(0)) await f.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('proposal workspace composition', () => {
  it.each([false, true])('adopts normalized proposal text and preserves later typing (%s)', async laterTyping => {
    const f = setup();
    const request = f.request();
    const submitted = '# a\n\nSee [[Plan]]';
    const canonical = 'See [[Plan]]';
    request.preview.proposedEditorMarkdown = submitted;
    request.preview.hunks[0].newText = submitted;
    request.preview.hunks[0].proposedTo = submitted.length;
    const publishing = deferred<Awaited<ReturnType<typeof request.commit>>>();
    vi.mocked(request.commit).mockReturnValueOnce(publishing.promise);
    vi.mocked(readNoteSession).mockResolvedValue(persistedSession('a', canonical));
    await f.orchestration.loadDurableProposalIfOpen(request);
    const keeping = f.orchestration.keepAll();
    if (laterTyping) f.getEditor(f.first)!.insertMarkdown(' later', { target: 'end' });
    publishing.resolve({
      status: 'committed', applied: { kind: 'updateNote', path: '/vault/a.md', previousPath: '/vault/a.md' },
      noteId: 'a', message: null, committedMarkdown: canonical
    });
    await keeping;
    expect(request.commit).toHaveBeenCalledExactlyOnceWith(submitted);
    expect(f.initialDocument.externalSync.kind).toBe('noConflict');
    expect(f.orchestration.session.workflow.kind).toBe('idle');
    if (laterTyping) {
      expect(f.initialDocument.working.markdown).toBe(`${submitted} later`);
      expect(f.save).toHaveBeenCalledExactlyOnceWith('a', `${submitted} later`, '/vault/a.md');
    } else {
      expect(f.initialDocument.savedBaseline?.content.markdown).toBe(canonical);
      expect(f.initialDocument.working.markdown).toBe(canonical);
      expect(documentRegistry.get(f.initialDocument.handle)?.resources()?.runtime.markdown).toBe(canonical);
      expect(f.save).not.toHaveBeenCalled();
    }
  });

  it('still protects reviewed text when disk changes after a normalized publication', async () => {
    const f = setup();
    const request = f.request();
    const submitted = '# a\n\nSee [[Plan]]';
    request.preview.proposedEditorMarkdown = submitted;
    request.preview.hunks[0].newText = submitted;
    request.preview.hunks[0].proposedTo = submitted.length;
    vi.mocked(request.commit).mockResolvedValue({
      status: 'committed', applied: { kind: 'updateNote', path: '/vault/a.md', previousPath: '/vault/a.md' },
      noteId: 'a', message: null, committedMarkdown: 'See [[Plan]]'
    });
    vi.mocked(readNoteSession).mockResolvedValue(persistedSession('a', 'Actual external edit'));
    await f.orchestration.loadDurableProposalIfOpen(request);
    await f.orchestration.keepAll();
    expect(f.initialDocument.working.markdown).toBe(submitted);
    expect(f.initialDocument.savedBaseline?.content.markdown).toBe('a');
    expect(f.initialDocument.externalSync).toMatchObject({
      kind: 'conflict', external: { document: { content: { markdown: 'Actual external edit' } } }
    });
    expect(f.save).not.toHaveBeenCalled();
    expect(request.commit).toHaveBeenCalledOnce();
  });

  it('installs a passive proposal in an existing editor without activating it from chat', async () => {
    const f = setup(); await f.commands.splitWorkspace('thoughtPartner'); const active = f.workspace.activePaneId;
    const order = [...f.workspace.paneOrder];
    const focusHunk = vi.spyOn(f.getEditor(f.first)!, 'focusSelection');
    expect(await f.orchestration.loadDurableProposalIfOpen(f.request())).toBe(true);
    expect(focusHunk).not.toHaveBeenCalled();
    expect(f.workspace.activePaneId).toBe(active); expect(f.workspace.paneOrder).toEqual(order);
    expect(openNoteSession).not.toHaveBeenCalled();
    expect(documentRegistry.get(f.initialDocument.handle)?.resources()?.runtime.review?.reviewId).toBe('review-a');
  });
  it('keeps an absent target queued without opening or repurposing a pane', async () => {
    const f = setup(); const order = [...f.workspace.paneOrder];
    expect(await f.orchestration.loadDurableProposalIfOpen(f.request('b'))).toBe(false);
    expect(f.workspace.paneOrder).toEqual(order); expect(f.getNavigationDocument()).toBe(f.initialDocument);
    expect(openNoteSession).not.toHaveBeenCalled(); expect(f.orchestration.activeProposalId).toBeNull();
  });
  it('explicit review from a chat-only workspace creates an editor while preserving chat context', async () => {
    const f = setup(); await f.commands.setPaneKind(f.first, 'chat');
    expect(await f.orchestration.loadDurableProposal(f.request())).toBe(true);
    expect(f.workspace.paneOrder).toHaveLength(2);
    expect(f.workspace.getPaneState(f.first).kind).toBe('chat');
    const editorId = f.workspace.paneOrder.find(id => f.workspace.getPaneState(id).kind === 'editor')!;
    expect(f.getPaneDocument(editorId)).toBe(f.initialDocument);
    expect(documentRegistry.get(f.initialDocument.handle)?.resources()?.runtime.review?.reviewId).toBe('review-a');
  });
  it('retains review text/hunks while navigating away and reopens the original shared document', async () => {
    const f = setup(); await f.orchestration.loadDurableProposalIfOpen(f.request());
    await f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    expect(f.save).not.toHaveBeenCalled();
    await f.orchestration.reviewNext();
    expect(f.orchestration.activeProposalId).toBe('proposal-a');
    expect(f.getNavigationDocument()).toBe(f.initialDocument);
    expect(documentRegistry.get(f.initialDocument.handle)?.resources()?.runtime.review).toMatchObject({ reviewId: 'review-a', hunks: [{ status: 'pending' }] });
  });
  it('saves outside-hunk edits before releasing an unmounted dismissed review', async () => {
    const f = setup();
    const request = f.request();
    await f.orchestration.loadDurableProposalIfOpen(request);
    f.getEditor(f.first)!.insertMarkdown('\noutside', { target: 'end' });
    await f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    f.getEditor(f.first); // Mount b and detach the last a view.
    expect(documentRegistry.get(f.initialDocument.handle)?.resources()?.runtime.attachedPaneCount).toBe(0);
    await f.orchestration.undoAll();
    expect(request.dismiss).toHaveBeenCalledOnce();
    expect(f.save).toHaveBeenCalledExactlyOnceWith('a', 'a\noutside', '/vault/a.md');
    expect(f.state.documentsByHandle[f.initialDocument.handle]).toBeUndefined();
    expect(documentRegistry.get(f.initialDocument.handle)).toBeNull();
    expect(f.getNavigationDocument().working.markdown).toBe('b');
  });

  it('keeps a review protected through teardown flush and continues it after remount', async () => {
    const f = setup();
    const request = f.request();
    await f.orchestration.loadDurableProposalIfOpen(request);
    f.getEditor(f.first)!.insertMarkdown('\noutside', { target: 'end' });
    await f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    f.getEditor(f.first)!.insertMarkdown(' ordinary', { target: 'end' });
    const barrier = createWorkspacePersistenceService({
      ...f.persistence, getDocuments: () => Object.values(f.state.documentsByHandle),
      flushAllPaneCursorSaves: vi.fn(), isReviewingDocument: f.orchestration.session.isReviewingDocument
    });
    f.commands.dispose();
    const flushing = barrier.flushAllForNavigation();
    f.orchestration.dispose();
    await flushing;
    expect(f.save).toHaveBeenCalledExactlyOnceWith('b', 'b ordinary', '/vault/b.md');
    expect(f.initialDocument.working.markdown).toBe('proposed\noutside');
    expect(documentRegistry.isReviewing(f.initialDocument.handle)).toBe(true);
    const publish = vi.spyOn(f.editing, 'recordReviewEdit');
    const remounted = f.remount();
    await remounted.reviewNext();
    f.getEditor(f.workspace.activePaneId)!.insertMarkdown(' later', { target: 'end' });
    expect(publish).toHaveBeenCalledExactlyOnceWith(f.initialDocument, 'proposed\noutside later');
    await remounted.undoAll();
    expect(request.dismiss).toHaveBeenCalledOnce();
    expect(f.initialDocument.working.markdown).toBe('a\noutside later');
    expect(f.save).toHaveBeenLastCalledWith('a', 'a\noutside later', '/vault/a.md');
    expect(remounted.activeProposalId).toBeNull();
  });

  it('settles one in-flight durable commit after route handoff and preserves newer edits', async () => {
    const f = setup();
    const request = f.request();
    const committed = deferred<Awaited<ReturnType<DurableProposalReviewRequest['commit']>>>();
    vi.mocked(request.commit).mockReturnValueOnce(committed.promise);
    vi.mocked(readNoteSession).mockResolvedValue(persistedSession('a', 'proposed'));
    await f.orchestration.loadDurableProposalIfOpen(request);
    const pending = f.orchestration.keepAll();
    f.commands.dispose();
    f.orchestration.dispose();
    const remounted = f.remount();
    f.getEditor(f.first)!.insertMarkdown(' later', { target: 'end' });
    await remounted.keepAll();
    expect(remounted.session.workflow.kind).toBe('committing');
    committed.resolve({ status: 'committed', applied: { kind: 'updateNote', path: '/vault/a.md', previousPath: '/vault/a.md' }, noteId: 'a', message: null, committedMarkdown: 'proposed' });
    await pending;
    expect(request.commit).toHaveBeenCalledExactlyOnceWith('proposed');
    expect(remounted.session.workflow.kind).toBe('idle');
    expect(f.initialDocument.working.markdown).toBe('proposed later');
    expect(f.save).toHaveBeenCalledExactlyOnceWith('a', 'proposed later', '/vault/a.md');
    expect(documentRegistry.isReviewing(f.initialDocument.handle)).toBe(false);
  });

  it('reloads the retained review document without saving proposed text or touching the visible note', async () => {
    const f = setup();
    const request = f.request();
    await f.orchestration.loadDurableProposalIfOpen(request);
    await f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    f.getEditor(f.first);
    vi.mocked(readNoteSession).mockImplementation(async id => persistedSession(id ?? 'a', id === 'a' ? 'disk a' : 'disk b'));
    await f.orchestration.reloadDisk();
    expect(request.dismiss).not.toHaveBeenCalled();
    await f.orchestration.reloadDisk();
    expect(request.dismiss).toHaveBeenCalledOnce();
    expect(readNoteSession).toHaveBeenCalledExactlyOnceWith('a', '/vault/a.md');
    expect(f.save).not.toHaveBeenCalled();
    expect(f.getNavigationDocument().working.markdown).toBe('b');
    expect(f.initialDocument.working.markdown).toBe('disk a');
    expect(f.orchestration.activeProposalId).toBeNull();
    expect(documentRegistry.get(f.initialDocument.handle)).toBeNull();
  });

  it('preserves typing that occurs after confirming a disk reload', async () => {
    const f = setup();
    await f.orchestration.loadDurableProposalIfOpen(f.request());
    const entered = deferred<void>();
    const disk = deferred<ReturnType<typeof persistedSession>>();
    vi.mocked(readNoteSession).mockImplementationOnce(() => {
      entered.resolve();
      return disk.promise;
    });
    await f.orchestration.reloadDisk();
    const reloading = f.orchestration.reloadDisk();
    await entered.promise;
    f.getEditor(f.first)!.insertMarkdown(' later', { target: 'end' });
    disk.resolve(persistedSession('a', 'disk body'));
    await reloading;
    expect(f.initialDocument.working.markdown).toBe('proposed later');
    expect(documentRegistry.isReviewing(f.initialDocument.handle)).toBe(true);
    expect(f.orchestration.session.snapshot.error).toContain('changed while loading from disk');
    expect(f.save).not.toHaveBeenCalled();
  });

  it('keeps the review text when its confirmed disk read fails', async () => {
    const f = setup();
    await f.orchestration.loadDurableProposalIfOpen(f.request());
    vi.mocked(readNoteSession).mockRejectedValueOnce(new Error('read unavailable'));
    await f.orchestration.reloadDisk();
    await f.orchestration.reloadDisk();
    expect(f.initialDocument.working.markdown).toBe('proposed');
    expect(documentRegistry.isReviewing(f.initialDocument.handle)).toBe(true);
    expect(f.orchestration.session.snapshot.error).toBe('read unavailable');
    expect(f.save).not.toHaveBeenCalled();
  });

  it('retains unsaved terminal work when persistence fails', async () => {
    const f = setup();
    await f.orchestration.loadDurableProposalIfOpen(f.request());
    f.getEditor(f.first)!.insertMarkdown('\noutside', { target: 'end' });
    await f.commands.openNotePath('/vault/b.md', { noteId: 'b', focusEditorAfterOpen: false });
    f.getEditor(f.first);
    f.save.mockRejectedValueOnce(new Error('disk unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await f.orchestration.undoAll();
    expect(f.initialDocument.working.markdown).toBe('a\noutside');
    expect(f.state.documentsByHandle[f.initialDocument.handle]).toBe(f.initialDocument);
    expect(documentRegistry.get(f.initialDocument.handle)?.resources()?.runtime.markdown).toBe('a\noutside');
    expect(f.initialDocument.operation.kind).toBe('failed');
    expect(f.orchestration.session.snapshot.error).toContain('remaining edits in “a” could not be saved');
    expect(f.orchestration.session.snapshot.error).toContain('disk unavailable');
    expect(f.orchestration.activeProposalId).toBeNull();
    log.mockRestore();
  });

  it('refuses a dirty conflicted target without replacing local text', async () => {
    const f = setup(); updateDocumentMarkdown(f.initialDocument, 'local');
    captureExternalSnapshotForTest(f.initialDocument, createSessionSnapshot(persistedSession('a', 'external')), 'watcher');
    expect(await f.orchestration.loadDurableProposalIfOpen(f.request())).toBe(false);
    expect(f.initialDocument.working.markdown).toBe('local'); expect(f.initialDocument.externalSync.kind).toBe('conflict');
  });
});
