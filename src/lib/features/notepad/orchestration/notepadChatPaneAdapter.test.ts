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
  const controller = {} as ChatController;
  const coordinator = {
    getController: vi.fn(() => controller),
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
    setPaneDocument,
    getPaneConversationId: () => 'conversation-1',
    setPaneConversationId,
    touchPaneLocation,
    getPaneSelectedText: (paneId) => `${paneId} selection`,
    getEditorPaneIds: () => options.editorPaneIds ?? ['editor'],
    setActivePane,
    openNote,
    openWikilink,
    flushPendingAutosave,
    getNoteSaveQueue
  });
  return {
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
    paneOrder,
    paneKinds
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
    const { adapter, documents, getNoteSaveQueue } = setup({
      paneOrder: ['chat'],
      paneKinds: { chat: 'chat', editor: 'chat' }
    });

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
    const { adapter, documents, setPaneDocument, paneOrder, paneKinds } =
      setup();

    adapter.syncRetainedContexts();

    expect(setPaneDocument).toHaveBeenCalledWith('chat', documents.editor);
    expect(documents.chat).toBe(documents.editor);

    // After the editor closes, context falls back to the aligned retain.
    paneOrder.length = 0;
    paneOrder.push('chat');
    paneKinds.chat = 'chat';
    paneKinds.editor = 'chat';

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

  it('opens chat wikilinks through the nearest editor context', async () => {
    const { adapter, openWikilink } = setup();

    await adapter.getBindings('chat').context.onOpenWikilink(
      'Notes/Referenced.md#Details'
    );

    expect(openWikilink).toHaveBeenCalledWith(
      'editor',
      'Notes/Referenced.md#Details'
    );
  });

  it('uses the chat pane context for wikilinks when no editor exists', async () => {
    const { adapter, openWikilink } = setup({
      paneOrder: ['chat'],
      paneKinds: { chat: 'chat', editor: 'editor' },
      editorPaneIds: []
    });

    await adapter.getBindings('chat').context.onOpenWikilink('Referenced');

    expect(openWikilink).toHaveBeenCalledWith('chat', 'Referenced');
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
