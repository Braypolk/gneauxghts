import { describe, expect, it, vi } from 'vitest';
import type { ChatController } from '$lib/features/chat/controller.svelte';
import type {
  ChatAgentProposal,
  ChatCitation
} from '$lib/features/chat/types';
import type { ProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import {
  createNoteDraftState,
  type NoteDraftState
} from '$lib/features/notepad/state/noteStore';
import { dispatchDocumentOperation } from '$lib/features/notepad/document/documentState';
import {
  createEmptySessionSnapshot,
  type SessionSnapshot
} from '$lib/features/notepad/session/session';
import type { NotepadChatCoordinator } from './notepadChatCoordinator.svelte';
import { createNotepadChatPaneAdapter } from './notepadChatPaneAdapter';

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

function setup(options: {
  paneOrder?: PaneId[];
  paneKinds?: Record<PaneId, 'editor' | 'chat'>;
  documents?: Record<PaneId, NoteDraftState>;
  editorPaneIds?: PaneId[];
} = {}) {
  const paneOrder = options.paneOrder ?? ['chat', 'editor'];
  const paneKinds =
    options.paneKinds ?? { chat: 'chat', editor: 'editor' };
  const documents =
    options.documents ?? {
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
  const touchPaneLocation = vi.fn();
  const setActivePane = vi.fn();
  const openNote = vi.fn(async () => {});
  const flushPendingAutosave = vi.fn();
  const getNoteSaveQueue = vi.fn(async () => {});
  const setSurfaceHandle = vi.fn();
  const reviewAgentProposal = vi.fn(async () => true);
  const controller = {} as ChatController;
  const coordinator = {
    getController: vi.fn(() => controller),
    getDraftSeed: vi.fn(() => null),
    getTargetAnchor: vi.fn(() => null),
    selectionActions: {},
    setSurfaceHandle,
    reviewAgentProposal
  } as unknown as NotepadChatCoordinator<PaneId>;
  const proposal = {
    session: {
      snapshot: null
    },
    keepAll: vi.fn(),
    undoAll: vi.fn(),
    reviewNext: vi.fn(),
    retryCommit: vi.fn(),
    copyCurrent: vi.fn(),
    reloadDisk: vi.fn()
  } as unknown as ProposalOrchestration;
  const adapter = createNotepadChatPaneAdapter({
    coordinator,
    proposal,
    getPaneOrder: () => paneOrder,
    getPaneKind: (paneId) => paneKinds[paneId],
    getPaneDocument: (paneId) => documents[paneId],
    getPaneConversationId: () => 'conversation-1',
    setPaneConversationId,
    touchPaneLocation,
    getSelectedRelatedText: () => 'selected text',
    getEditorPaneIds: () => options.editorPaneIds ?? ['editor'],
    setActivePane,
    openNote,
    flushPendingAutosave,
    getNoteSaveQueue
  });
  return {
    adapter,
    documents,
    setPaneConversationId,
    touchPaneLocation,
    setActivePane,
    openNote,
    flushPendingAutosave,
    getNoteSaveQueue,
    setSurfaceHandle,
    reviewAgentProposal
  };
}

describe('createNotepadChatPaneAdapter', () => {
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

  it('uses the chat pane retained note and waits for its save before snapshotting', async () => {
    const {
      adapter,
      documents,
      flushPendingAutosave,
      getNoteSaveQueue
    } = setup();

    const bindings = adapter.getBindings('chat');
    expect(bindings.context.note).toEqual({
      noteId: 'context-note',
      notePath: 'Notes/Chat Context.md',
      noteTitle: 'Chat Context'
    });

    const snapshot = await bindings.context.getActiveNoteSnapshot();

    expect(flushPendingAutosave).toHaveBeenCalledWith(documents.chat);
    expect(getNoteSaveQueue).toHaveBeenCalledWith(documents.chat);
    expect(snapshot).toMatchObject({
      noteId: 'context-note',
      title: 'Chat Context',
      path: 'Notes/Chat Context.md',
      body: '# Chat Context\n\nRetained draft',
      selection: 'selected text'
    });
    expect(snapshot?.bodyHash).toBeTruthy();
  });

  it('rejects a snapshot when the note save failed', async () => {
    const { adapter, documents, getNoteSaveQueue } = setup();
    getNoteSaveQueue.mockImplementation(async () => {
      dispatchDocumentOperation(documents.chat, {
        type: 'start',
        operation: 'saving'
      });
      dispatchDocumentOperation(documents.chat, {
        type: 'fail',
        error: new Error('disk failed'),
        token: documents.chat.operation.token
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
    const { adapter, setActivePane, openNote } = setup({
      paneOrder: ['chat'],
      paneKinds: { chat: 'chat', editor: 'editor' },
      editorPaneIds: []
    });

    await adapter.getBindings('chat').context.onOpenCitation(noteCitation());

    expect(setActivePane).toHaveBeenCalledWith('chat');
    expect(openNote).toHaveBeenCalledWith('Notes/Referenced.md', {
      noteId: 'note-2',
      revealEditorAfterOpen: true,
      focusEditorAfterOpen: true
    });
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
