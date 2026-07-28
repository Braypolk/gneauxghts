import { describe, expect, it, vi } from 'vitest';
import type { ChatController } from '$lib/features/chat/controller.svelte';
import type { ChatCitation } from '$lib/features/chat/types';
import type { ProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import {
  createNoteDraftState,
  type NoteDraftState
} from '$lib/features/notepad/state/noteStore';
import type { NotepadChatCoordinator } from './notepadChatCoordinator.svelte';
import { createNotepadChatPaneAdapter } from './notepadChatPaneAdapter';

type PaneId = 'chat' | 'editor';

function note(overrides: Partial<NoteDraftState> = {}) {
  return Object.assign(createNoteDraftState(), overrides);
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
      chat: note(),
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
      snapshot: null,
      pendingCount: 0
    },
    showChange: vi.fn(),
    keep: vi.fn(),
    undo: vi.fn(),
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
    setSurfaceHandle
  };
}

describe('createNotepadChatPaneAdapter', () => {
  it('uses the nearest editor note and waits for its save before snapshotting', async () => {
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
      selection: 'selected text'
    });
    expect(snapshot?.bodyHash).toBeTruthy();
  });

  it('rejects a snapshot when the note save failed', async () => {
    const { adapter, documents, getNoteSaveQueue } = setup();
    getNoteSaveQueue.mockImplementation(async () => {
      documents.editor.status = 'error';
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
