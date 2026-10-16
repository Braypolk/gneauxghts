import { resolveCurrentPassage } from "$lib/features/chat/api";
vi.mock("$lib/features/chat/api", () => ({ resolveCurrentPassage: vi.fn() }));
import { describe, expect, it, vi } from 'vitest';
import type { ChatController } from '$lib/features/chat/controller.svelte';
import type {
  ChatAgentProposal,
  ChatCitation,
  ChatProposalDraft
} from '$lib/features/chat/types';
import {
  createNoteDraftState, type NoteDraftState
} from '$lib/features/notepad/state/noteStore';
import { dispatchDocumentOperation, updateDocumentMarkdown } from '$lib/features/notepad/document/documentState';
import {
  createEmptySessionSnapshot,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import { createProposalReviewSession } from '$lib/features/proposals/reviewSession.svelte';
import { createNotepadChatPaneAdapter } from './notepadChatPaneAdapter';
import { NotepadChatCoordinator, type NotepadChatCoordinatorDeps } from './notepadChatCoordinator.svelte';
import { fakeApi, proposal as agentProposal } from '$lib/features/chat/chatTestSupport';
import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import { createReviewEditorForTest } from '$lib/features/proposals/proposalEditorTestSupport';
import { documentRegistry } from '../document/documentRegistry';

type PaneId = 'chat' | 'editor';

function note(overrides: Partial<SessionSnapshot> = {}) {
  return createNoteDraftState({
    ...createEmptySessionSnapshot(),
    ...overrides
  });
}

function noteCitation(): Extract<ChatCitation, { kind: 'note' }> {
  return {
    id: 'citation-1',
    kind: 'note',
    label: 'Referenced note',
    noteId: 'note-2',
    notePath: 'Notes/Referenced.md',
    sectionLabel: null,
    startLine: null,
    excerpt: null
  };
}

function setup({ singlePane = false } = {}) {
  const paneOrder: PaneId[] = singlePane ? ['chat'] : ['chat', 'editor'];
  const documents = {
    chat: note({
      currentNoteId: 'context-note',
      currentNotePath: 'Notes/Chat Context.md',
      title: 'Chat Context',
      bodyMarkdown: '# Chat Context\n\nRetained draft'
    }),
    editor: note({
      currentNoteId: 'note-1',
      currentNotePath: 'Notes/Project.md',
      title: '',
      bodyMarkdown: '# Project\n\nCurrent draft'
    })
  };
  const setPaneConversationId = vi.fn();
  const setPaneDocument = vi.fn((paneId: PaneId, document: NoteDraftState) => {
    documents[paneId] = document;
  });
  const touchPaneLocation = vi.fn();
  const setActivePane = vi.fn();
  const openNote = vi.fn(async () => {});
  const openWikilink = vi.fn(async () => {});
  const flushPendingAutosave = vi.fn();
  const getNoteSaveQueue = vi.fn(async () => {});
  const setSurfaceHandle = vi.fn();
  const reviewAgentProposal = vi.fn(async () => true);
  const controller = { getSnapshot: () => ({ proposals: [] }) } as unknown as ChatController;
  const coordinator = {
    getController: vi.fn(() => controller),
    getTargetAnchor: vi.fn(() => null),
    selectionActions: {},
    setSurfaceHandle,
    reviewAgentProposal
  };
  const proposal = {
    session: createProposalReviewSession(),
    keepAll: vi.fn(),
    undoAll: vi.fn(),
    reviewNext: vi.fn(),
    retryCommit: vi.fn(),
    copyCurrent: vi.fn(),
    reloadDisk: vi.fn()
  };
  const focusPassage = vi.fn(() => true);
  const openRevisionCitation = vi.fn().mockResolvedValue(undefined);
  const adapter = createNotepadChatPaneAdapter({
    coordinator,
    proposal,
    getPaneOrder: () => paneOrder,
    getPaneKind: (paneId) => paneId === 'chat' ? 'chat' : 'editor',
    getPaneDocument: (paneId) => documents[paneId],
    setPaneDocument,
    getPaneConversationId: () => 'conversation-1',
    setPaneConversationId,
    touchPaneLocation,
    getPaneSelectedText: (paneId) => `${paneId} selection`,
    setActivePane,
    focusPassage,
    openRevisionCitation,
    openNote,
    openWikilink,
    flushPendingAutosave,
    getNoteSaveQueue
  });
  return {
    focusPassage,
    openRevisionCitation,
    adapter,
    documents,
    setPaneDocument,
    setPaneConversationId,
    touchPaneLocation,
    setActivePane,
    openNote,
    openWikilink,
    flushPendingAutosave,
    getNoteSaveQueue,
    setSurfaceHandle,
    reviewAgentProposal,
    proposal,
    paneOrder
  };
}

describe('createNotepadChatPaneAdapter', () => {
  it.each([false, true])('retains ordinary Review next when there is no matching durable proposal (legacy active: %s)', async active => {
    const { adapter, proposal, reviewAgentProposal } = setup();
    if (active) proposal.session.dispatchWorkflow({ type: 'openRequested', identity: {
      proposalId: 'legacy-review', reviewId: 'legacy-preview', notePath: '/vault/Legacy.md'
    } });
    await adapter.getBindings('chat').proposalReview.onReview();
    expect(proposal.reviewNext).toHaveBeenCalledOnce();
    expect(reviewAgentProposal).not.toHaveBeenCalled();
  });

  it.each([false, true])('reopens the active same-ID refined draft through its durable owner, preserving newer local edits (%s)', async laterTyping => {
    const document = note();
    const editor = createReviewEditorForTest(document);
    const orchestration = createProposalOrchestration({
      session: createProposalReviewSession(),
      getEditorPaneDocument: () => document,
      getEditorForDocument: () => editor.adapter,
      presentReviewDocument: async () => document,
      onReviewMarkdownChange: updateDocumentMarkdown,
      finishReviewDocument: async () => {},
      acknowledgeDocumentCommit: async () => {},
      reloadReviewDocument: async () => {}
    });
    const original: ChatProposalDraft = { version: 7, title: 'Human title', path: '/vault/Human.md',
      markdown: 'Latest human checkpoint', decisions: [] };
    const refined: ChatProposalDraft = { ...original, version: 8, title: 'Refined title', path: '/vault/Refined.md',
      markdown: 'Latest human checkpoint\n\nModel refinement' };
    let draft = original;
    let pending = agentProposal({ id: 'pi-review-148', kind: 'create', noteId: null, title: draft.title,
      suggestedPath: draft.path, payload: { markdown: draft.markdown },
      preview: { reviewId: 'before-refinement', proposedEditorMarkdown: draft.markdown } });
    const api = { ...fakeApi().api, getProposalDraft: vi.fn(async () => structuredClone(draft)) };
    api.listPendingProposals.mockImplementation(async () => [pending]);
    const coordinator = new NotepadChatCoordinator<PaneId>([], { api,
      getProposalOrchestration: () => orchestration } as unknown as NotepadChatCoordinatorDeps<PaneId>);
    // The controller still holds the initially announced proposal. The real
    // coordinator must reread its durable record rather than trust that preview.
    const announced = pending;
    vi.spyOn(coordinator, 'getController').mockReturnValue({ getSnapshot: () => ({ proposals: [announced] }) } as unknown as ChatController);
    const reviewNext = vi.spyOn(orchestration, 'reviewNext');
    const adapter = createNotepadChatPaneAdapter<PaneId>({ coordinator, proposal: orchestration,
      getPaneOrder: () => ['chat', 'editor'], getPaneKind: id => id === 'chat' ? 'chat' : 'editor',
      getPaneDocument: () => document, setPaneDocument: () => {}, getPaneConversationId: () => 'conversation-1',
      setPaneConversationId: () => {}, touchPaneLocation: () => {}, getPaneSelectedText: () => null,
      setActivePane: () => {}, openNote: async () => {}, openRevisionCitation: async () => {},
      openWikilink: async () => {}, flushPendingAutosave: () => {}, getNoteSaveQueue: async () => {} });
    try {
      expect(await coordinator.reviewAgentProposal('chat', announced)).toBe(true);
      expect(editor.markdown).toBe(original.markdown);
      const bindings = adapter.getBindings('chat');
      draft = refined;
      pending = { ...pending, title: refined.title, suggestedPath: refined.path, payload: { markdown: refined.markdown },
        preview: { reviewId: 'after-refinement', proposedEditorMarkdown: refined.markdown } };
      if (laterTyping) editor.adapter.insertMarkdown(' newer local edit', { target: 'end' });
      const working = editor.markdown;
      const localHunks = structuredClone(editor.review?.hunks);
      await bindings.proposalReview.onReview();
      expect(api.getProposalDraft).toHaveBeenCalledTimes(2);
      expect(reviewNext).not.toHaveBeenCalled();
      expect(api.commitAgentProposal).not.toHaveBeenCalled();
      if (laterTyping) {
        expect(editor.markdown).toBe(working);
        expect(editor.review?.hunks).toEqual(localHunks);
        expect(document.working.title).toBe(original.title);
        expect(orchestration.session.snapshot).toMatchObject({ notePath: original.path,
          error: 'This review has newer local edits. Save them before reopening the updated draft.' });
      } else {
        expect(editor.markdown).toBe(refined.markdown);
        expect(document.working.title).toBe(refined.title);
        expect(editor.review).toMatchObject({ reviewId: 'after-refinement', hunks: [{
          id: `${announced.id}-creation`, newText: refined.markdown, from: 0, to: refined.markdown.length, status: 'pending'
        }] });
        expect(orchestration.session.snapshot).toMatchObject({ proposalId: announced.id, notePath: refined.path, title: refined.title });
      }
    } finally {
      orchestration.dispose(); coordinator.dispose();
      if (editor.review) editor.runtime.endReview(editor.review.reviewId);
      editor.dispose(); documentRegistry.dispose(document.handle);
      vi.restoreAllMocks();
    }
  });

  it('opens proposal review only through the explicit review binding', () => {
    const { adapter, reviewAgentProposal } = setup();
    const proposal = {
      id: 'proposal-1',
      conversationId: 'conversation-1',
      kind: 'update'
    } as ChatAgentProposal;

    adapter
      .getBindings('chat')
      .proposalReview.onReviewAgentProposal?.(proposal);

    expect(reviewAgentProposal).toHaveBeenCalledOnce();
    expect(reviewAgentProposal).toHaveBeenCalledWith(
      'chat',
      proposal
    );
  });

  it('follows the sibling editor note and waits for its save before snapshotting', async () => {
    const {
      adapter,
      documents,
      flushPendingAutosave,
      getNoteSaveQueue
    } = setup();

    const bindings = adapter.getBindings('chat');
    expect(bindings.context.note).toEqual({
      noteId: 'note-1',
      notePath: 'Notes/Project.md',
      noteTitle: 'Project'
    });

    const snapshot = await bindings.context.getActiveNoteSnapshot();

    expect(flushPendingAutosave).toHaveBeenCalledWith(documents.editor);
    expect(getNoteSaveQueue).toHaveBeenCalledWith(documents.editor);
    expect(snapshot).toMatchObject({
      noteId: 'note-1',
      title: 'Project',
      path: 'Notes/Project.md',
      body: '# Project\n\nCurrent draft',
      selection: 'editor selection'
    });
    expect(snapshot?.bodyHash).toBeTruthy();
  });

  it('uses the chat pane retained note when no editor pane is visible', async () => {
    const { adapter, documents, getNoteSaveQueue } = setup({ singlePane: true });

    const bindings = adapter.getBindings('chat');
    expect(bindings.context.note).toEqual({
      noteId: 'context-note',
      notePath: 'Notes/Chat Context.md',
      noteTitle: 'Chat Context'
    });

    const snapshot = await bindings.context.getActiveNoteSnapshot();

    expect(getNoteSaveQueue).toHaveBeenCalledWith(documents.chat);
    expect(snapshot).toMatchObject({
      noteId: 'context-note',
      path: 'Notes/Chat Context.md',
      body: '# Chat Context\n\nRetained draft',
      selection: 'chat selection'
    });
  });

  it('aligns the chat retained note with the sibling editor it follows', () => {
    const { adapter, documents, setPaneDocument, paneOrder } =
      setup();

    adapter.syncRetainedContexts();

    expect(setPaneDocument).toHaveBeenCalledWith('chat', documents.editor);
    expect(documents.chat).toBe(documents.editor);

    // After the editor closes, context falls back to the aligned retain.
    paneOrder.length = 0;
    paneOrder.push('chat');

    expect(adapter.getBindings('chat').context.note).toEqual({
      noteId: 'note-1',
      notePath: 'Notes/Project.md',
      noteTitle: 'Project'
    });
  });

  it('rejects a snapshot when the note save failed', async () => {
    const { adapter, documents, getNoteSaveQueue } = setup();
    getNoteSaveQueue.mockImplementation(async () => {
      dispatchDocumentOperation(documents.editor, {
        type: 'start',
        operation: 'saving'
      });
      dispatchDocumentOperation(documents.editor, {
        type: 'fail',
        error: new Error('disk failed'),
        token: documents.editor.operation.token
      });
    });

    await expect(
      adapter.getBindings('chat').context.getActiveNoteSnapshot()
    ).rejects.toThrow('could not be saved before sending');
  });

  it('opens citations in an existing editor pane', async () => {
    const { adapter, setActivePane, openNote } = setup();

    await adapter.getBindings('chat').context.onOpenCitation(noteCitation());

    expect(setActivePane).toHaveBeenCalledWith('editor');
    expect(openNote).toHaveBeenCalledWith('Notes/Referenced.md', {
      noteId: 'note-2',
      focusEditorAfterOpen: true
    });
  });

  it('reveals an editor from the chat pane when no editor pane exists', async () => {
    const { adapter, setActivePane, openNote } = setup({ singlePane: true });

    await adapter.getBindings('chat').context.onOpenCitation(noteCitation());

    expect(setActivePane).toHaveBeenCalledWith('chat');
    expect(openNote).toHaveBeenCalledWith('Notes/Referenced.md', {
      noteId: 'note-2',
      revealEditorAfterOpen: true,
      focusEditorAfterOpen: true
    });
  });

  it.each([
    { singlePane: false, destination: 'editor' },
    { singlePane: true, destination: 'chat' }
  ])('routes chat wikilinks through $destination context', async ({ singlePane, destination }) => {
    const { adapter, openWikilink } = setup({ singlePane });
    await adapter.getBindings('chat').context.onOpenWikilink('Notes/Referenced.md#Details');
    expect(openWikilink).toHaveBeenCalledWith(destination, 'Notes/Referenced.md#Details');
  });

  it('owns conversation and mounted-surface bookkeeping for the pane', () => {
    const {
      adapter,
      setPaneConversationId,
      touchPaneLocation,
      setSurfaceHandle
    } = setup();
    const bindings = adapter.getBindings('chat');
    const handle = { focusComposer: () => true };

    bindings.session.onConversationChange('conversation-2');
    bindings.session.onSurfaceHandleChange(handle);

    expect(setPaneConversationId).toHaveBeenCalledWith(
      'chat',
      'conversation-2'
    );
    expect(touchPaneLocation).toHaveBeenCalledWith('chat');
    expect(setSurfaceHandle).toHaveBeenCalledWith('chat', handle);
  });
});


it('opens revision evidence without navigating or repurposing any pane', async () => {
  const { adapter, openRevisionCitation, openNote, setActivePane, setPaneDocument } = setup();
  const citation = { ...noteCitation(), revision: { noteId: 'cited', revisionId: 'old', atMillis: 10, source: 'editor' as const, currentExcerpt: 'current' } };
  await adapter.getBindings('chat').context.onOpenCitation(citation);
  expect(openRevisionCitation).toHaveBeenCalledWith('chat', citation);
  expect(openNote).not.toHaveBeenCalled();
  expect(setActivePane).not.toHaveBeenCalled();
  expect(setPaneDocument).not.toHaveBeenCalled();
});

it('revalidates a passage and focuses its exact Unicode occurrence in the current editor', async () => {
  const { adapter, documents, focusPassage, openNote } = setup();
  documents.editor.working.markdown = '☕ same\nsame';
  const citation = { ...noteCitation(), noteId: 'note-1', passage: {
    id: 'p2', noteId: 'note-1', contentHash: 'h', location: 'body', start: 9, end: 13, excerpt: 'same', revisions: []
  } };
  vi.mocked(resolveCurrentPassage).mockResolvedValue({ source: citation, markdown: '☕ same\nsame', selection: { anchor: 7, head: 11 } });
  await adapter.getBindings('chat').context.onOpenCitation(citation);
  expect(resolveCurrentPassage).toHaveBeenCalledWith('conversation-1', 'p2');
  expect(openNote).toHaveBeenCalledWith('Notes/Referenced.md', expect.objectContaining({ noteId: 'note-1' }));
  expect(focusPassage).toHaveBeenCalledWith('editor', { anchor: 7, head: 11 });
});
it('does not navigate when backend passage validation fails', async () => {
  const {adapter,openNote}=setup();
  vi.mocked(resolveCurrentPassage).mockRejectedValue(new Error('Passage changed'));
  const citation={...noteCitation(),passage:{id:'e1',noteId:'note-1',contentHash:'h',location:'body',start:0,end:1,excerpt:'old',revisions:[]}};
  await expect(adapter.getBindings('chat').context.onOpenCitation(citation)).rejects.toThrow('Passage changed');
  expect(openNote).not.toHaveBeenCalled();
});

it('refuses a resolved location when the editor changes during navigation', async () => {
  const {adapter,focusPassage}=setup();
  const citation={...noteCitation(),noteId:'note-1',passage:{id:'p3',noteId:'note-1',contentHash:'h',location:'body',start:0,end:3,excerpt:'old',revisions:[]}};
  vi.mocked(resolveCurrentPassage).mockResolvedValue({source:citation,markdown:'old snapshot',selection:{anchor:0,head:3}});
  await expect(adapter.getBindings('chat').context.onOpenCitation(citation)).rejects.toThrow('cannot be highlighted');
  expect(focusPassage).not.toHaveBeenCalled();
});

it.each(['properties', 'title', 'body'])('opens a validated %s source without inventing a body selection', async (location) => {
  const {adapter,documents,openNote,focusPassage}=setup();
  const citation={...noteCitation(),noteId:'note-1',passage:{id:'non-body',noteId:'note-1',contentHash:'h',location,start:0,end:5,excerpt:'value',revisions:[]}};
  vi.mocked(resolveCurrentPassage).mockResolvedValue({source:citation,markdown:documents.editor.working.markdown,selection:null});
  await expect(adapter.getBindings('chat').context.onOpenCitation(citation)).resolves.toBeUndefined();
  expect(openNote).toHaveBeenCalledWith(citation.notePath,expect.objectContaining({noteId:'note-1',revealEditorAfterOpen:true}));
  expect(focusPassage).not.toHaveBeenCalled();
});


it('opens a revalidated historical passage in its retained content revision', async () => {
  const {adapter,openRevisionCitation,openNote,focusPassage}=setup();
  const citation={...noteCitation(),noteId:'note-1',passage:{id:'history-1',noteId:'note-1',contentHash:'h',location:'body',start:0,end:3,excerpt:'old',revisions:[],historical:{revisionId:'deletion',contentRevisionId:'before-deletion',changeKind:'removed',timeEvidence:{kind:'committed' as const,committedAtMillis:100},source:'editor' as const}}};
  vi.mocked(resolveCurrentPassage).mockResolvedValue({source:citation,markdown:'',selection:null,historicalRevisionId:'before-deletion'});
  await adapter.getBindings('chat').context.onOpenCitation(citation);
  expect(openRevisionCitation).toHaveBeenCalledWith('chat',expect.objectContaining({revision:expect.objectContaining({revisionId:'before-deletion'})}));
  expect(openNote).not.toHaveBeenCalled();
  expect(focusPassage).not.toHaveBeenCalled();
});
