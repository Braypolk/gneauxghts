import { describe, expect, it, vi } from 'vitest';
import type { DurableProposalReviewRequest } from '$lib/features/proposals/types';
import { fakeApi } from '$lib/features/chat/chatTestSupport';
import type { ChatAgentProposal } from '$lib/features/chat/types';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import { createProposalReviewSession } from '$lib/features/proposals/reviewSession.svelte';
import { createReviewEditorForTest } from '$lib/features/proposals/proposalEditorTestSupport';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { updateDocumentMarkdown } from '$lib/features/notepad/document/documentState';
import {
  NotepadChatCoordinator,
  type NotepadChatCoordinatorDeps
} from './notepadChatCoordinator.svelte';

function proposal(): ChatAgentProposal {
  return {
    id: 'proposal-1',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'message-1',
    kind: 'update',
    noteId: 'note-1',
    suggestedPath: '/vault/Plan.md',
    title: 'Plan',
    baseHash: 'hash-1',
    payload: {},
    preview: {
      reviewId: 'review-1',
      notePath: '/vault/Plan.md',
      title: 'Plan',
      baseContentHash: 'hash-1',
      baseEditorMarkdown: 'Before',
      proposedEditorMarkdown: 'After',
      hunks: []
    },
    status: 'pending',
    createdAtMillis: 1,
    updatedAtMillis: 1
  };
}

describe('NotepadChatCoordinator chat surface registry', () => {
  it('reopens a relocated conflicted all-kept draft with recovery and only commits its exact version on explicit Retry',async()=>{
    const path='/relocated/vault/Plan.md',pending={...proposal(),status:'conflict' as const,suggestedPath:path};
    pending.preview={...pending.preview,notePath:path,hunks:[{id:'hunk-1',baseFrom:0,baseTo:6,proposedFrom:0,proposedTo:5,oldText:'Before',newText:'After'}]};
    const acknowledged={version:17,markdown:'After\nHuman detail',title:'Human title',path,decisions:[{id:'hunk-1',baseFrom:0,baseTo:6,proposedFrom:0,proposedTo:5,oldText:'Before',newText:'After',from:0,to:5,status:'kept' as const}]};
    const fake=fakeApi();fake.api.listPendingProposals.mockResolvedValue([pending]);
    const api={...fake.api,getProposalDraft:vi.fn(async()=>acknowledged),checkpointProposalDraft:vi.fn(async()=>acknowledged)};
    const document=createNoteDraftState({...createEmptySessionSnapshot(),title:'Plan',bodyMarkdown:'Before',currentNoteId:'note-1',currentNotePath:path,lastSavedNoteId:'note-1',lastSavedTitle:'Plan',lastSavedMarkdown:'Before',lastSavedPath:path});
    const editor=createReviewEditorForTest(document),session=createProposalReviewSession();
    const orchestration=createProposalOrchestration({session,getEditorPaneDocument:()=>document,getEditorForDocument:()=>editor.adapter,
      onReviewMarkdownChange:updateDocumentMarkdown,presentReviewDocument:async()=>document,finishReviewDocument:async()=>{},
      acknowledgeDocumentCommit:async()=>{},reloadReviewDocument:async()=>{throw new Error('No implicit reload');}});
    const coordinator=new NotepadChatCoordinator(['chat'],{api,getProposalOrchestration:()=>orchestration} as unknown as NotepadChatCoordinatorDeps<'chat'>);
    try {
      await coordinator.reviewAgentProposal('chat',pending);
      expect(editor.markdown).toBe(acknowledged.markdown);expect(document.working.title).toBe(acknowledged.title);
      expect(editor.review?.hunks).toEqual(acknowledged.decisions);
      expect(session.workflow).toMatchObject({kind:'conflicted',identity:{proposalId:pending.id,reviewId:'review-1',notePath:path}});
      expect(session.snapshot).toMatchObject({isConflicted:true,isApplying:false,unresolvedHunks:0});
      expect(session.snapshot.error).toMatch(/Retry Keep/);
      expect(api.commitAgentProposal).not.toHaveBeenCalled();
      await orchestration.retryCommit();
      expect(api.commitAgentProposal).toHaveBeenCalledExactlyOnceWith(pending.id,acknowledged.markdown,17);
      expect(orchestration.activeProposalId).toBeNull();
      await orchestration.retryCommit();expect(api.commitAgentProposal).toHaveBeenCalledOnce();
    } finally {
      coordinator.dispose();orchestration.dispose();
      if(editor.runtime.review)editor.runtime.endReview(editor.runtime.review.reviewId);
      editor.dispose();documentRegistry.dispose(document.handle);
    }
  });

  it('uses passive display on arrival and navigation only for explicit review', async () => {
    const pending = proposal();
    const fake = fakeApi();
    fake.api.listPendingProposals.mockResolvedValue([pending]);
    const loadDurableProposalIfOpen = vi.fn(async () => true);
    const loadDurableProposal = vi.fn<(request:DurableProposalReviewRequest)=>Promise<boolean>>(async () => true);
    const coordinator = new NotepadChatCoordinator(
      ['chat'],
      {
        api: fake.api,
        getProposalOrchestration: () => ({
          loadDurableProposalIfOpen,
          loadDurableProposal
        })
      } as unknown as NotepadChatCoordinatorDeps<'chat'>
    );

    await coordinator.showAgentProposalIfOpen('chat', pending);

    expect(loadDurableProposalIfOpen).toHaveBeenCalledOnce();
    expect(loadDurableProposal).not.toHaveBeenCalled();

    await coordinator.reviewAgentProposal('chat', pending);

    expect(loadDurableProposal).toHaveBeenCalledOnce();
    expect(loadDurableProposal.mock.calls[0]?.[0]?.recovery).toBeUndefined();

    loadDurableProposalIfOpen.mockClear();
    const controller = coordinator.getController(
      'chat'
    );
    await controller.initialize('conversation-1');
    loadDurableProposalIfOpen.mockClear();
    const openedDocument = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      currentNoteId: 'note-1',
      currentNotePath: '/vault/Plan.md',
      title: 'Plan',
      bodyMarkdown: 'Before'
    });

    await coordinator.showPendingProposalsForDocument(
      openedDocument
    );

    expect(loadDurableProposalIfOpen).toHaveBeenCalledOnce();
  });

  it('focuses registered pane surfaces and releases them when unmounted', () => {
    const coordinator = new NotepadChatCoordinator(
      [],
      {} as NotepadChatCoordinatorDeps<'chat'>
    );
    const focusComposer = vi.fn(() => true);

    expect(coordinator.focusComposer('chat')).toBe(false);

    coordinator.setSurfaceHandle('chat', { focusComposer });
    expect(coordinator.focusComposer('chat')).toBe(true);
    expect(focusComposer).toHaveBeenCalledTimes(1);

    coordinator.setSurfaceHandle('chat', null);
    expect(coordinator.focusComposer('chat')).toBe(false);
  });
});

it.each(['commit', 'dismiss'] as const)('settles a retained review through the durable API after chat teardown (%s)', async action => {
  const pending = proposal();
  const fake = fakeApi();
  fake.api.listPendingProposals.mockResolvedValue([pending]);
  fake.api.dismissAgentProposal.mockResolvedValue({ ...pending, status: 'dismissed' });
  const loadDurableProposal = vi.fn<(request: DurableProposalReviewRequest) => Promise<boolean>>(async () => true);
  const coordinator = new NotepadChatCoordinator(['chat'], {
    api: fake.api,
    getProposalOrchestration: () => ({ loadDurableProposal })
  } as unknown as NotepadChatCoordinatorDeps<'chat'>);
  await coordinator.reviewAgentProposal('chat', pending);
  const request = loadDurableProposal.mock.calls[0][0];
  coordinator.dispose();
  if (action === 'commit') {
    await expect(request.commit('Reviewed text')).resolves.toMatchObject({ status: 'committed' });
    expect(fake.api.commitAgentProposal).toHaveBeenCalledExactlyOnceWith(pending.id, 'Reviewed text');
  } else {
    await expect(request.dismiss()).resolves.toBeUndefined();
    expect(fake.api.dismissAgentProposal).toHaveBeenCalledExactlyOnceWith(pending.id);
  }
});
