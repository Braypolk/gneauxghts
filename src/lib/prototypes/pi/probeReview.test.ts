import {describe,it,expect,vi} from 'vitest';
import {acquireProbeReview,acknowledgedProbeDraft} from './probeReview';
import {NotepadChatCoordinator,type NotepadChatCoordinatorDeps} from '$lib/features/notepad/orchestration/notepadChatCoordinator.svelte';
import {fakeApi} from '$lib/features/chat/chatTestSupport';
import type {ChatAgentProposal,ChatProposalDraft} from '$lib/features/chat/types';
import type {DurableProposalReviewRequest} from '$lib/features/proposals/types';

describe('ordinary workspace probe review acquisition',()=>{
  it.each(['path','title'] as const)('awaits refreshed %s acknowledgement before capturing the exact confirmation baseline',async field=>{
    const mounted={markdown:'Reviewed authored text',decisions:[],title:'Human title',path:'/vault/Current.md'};
    const stale:ChatProposalDraft={...mounted,version:4,[field]:field==='path'?'/vault/Old.md':'Old title'};
    const acknowledged={...mounted,version:5};
    let stored=stale;
    const until=async<V>(read:()=>V|Promise<V>,label:string):Promise<NonNullable<V>>=>{
      for(let poll=0;poll<3;poll++) {
        const value=await read();if(value)return value as NonNullable<V>;
        stored=acknowledged;
      }
      throw new Error(`deadline: ${label}`);
    };
    const baseline=await acknowledgedProbeDraft({draft:async()=>stored,working:()=>mounted,until});
    expect(baseline).toEqual(acknowledged);
    // The confirmation itself performs no checkpoint or version substitution.
    expect(await Promise.resolve(stored)).toEqual(baseline);
  });
  it.each([false,true])('observes the Save coordinator delayed editor mount (automatic wait: %s)',async waitForAutomaticMount=>{
    const draft:ChatProposalDraft={version:1,title:'Saved Pi answer',path:'/vault/Saved.md',markdown:'Faithful answer\n\n[[Chats/Pi/pi-10/Origin|Open in chat]]',decisions:[]};
    const proposal:ChatAgentProposal={id:'save-1',runId:null,conversationId:'conversation-1',assistantMessageId:'answer-1',kind:'create',noteId:null,
      title:draft.title,suggestedPath:draft.path,baseHash:null,payload:{markdown:draft.markdown},preview:{proposedEditorMarkdown:draft.markdown},status:'pending',createdAtMillis:1,updatedAtMillis:1};
    const fake=fakeApi(),mount=Promise.withResolvers<void>(),loading=Promise.withResolvers<void>();
    let editor:{markdown:string;title:string}|undefined;
    const loadDurableProposal=vi.fn(async(request:DurableProposalReviewRequest)=>{
      loading.resolve();await mount.promise;
      editor={markdown:request.working!.markdown,title:request.working!.title};return true;
    });
    const api={...fake.api,prepareNoteSave:vi.fn(async()=>proposal),getProposalDraft:vi.fn(async()=>draft)};
    fake.api.listPendingProposals.mockResolvedValue([proposal]);
    const coordinator=new NotepadChatCoordinator(['chat'],{api,getProposalOrchestration:()=>({loadDurableProposal})} as unknown as NotepadChatCoordinatorDeps<'chat'>);
    try {
      const saving=Promise.resolve(coordinator.selectionActions.onSaveToNote!({conversationId:'conversation-1',messageId:'answer-1'}));
      await loading.promise;expect(editor).toBeUndefined();
      const openCard=vi.fn(async()=>undefined),openChat=vi.fn(async()=>{
        if(waitForAutomaticMount)throw new Error('Open chat raced automatic Save review mount');
      });
      const until=async<V>(read:()=>V|Promise<V>,label:string):Promise<NonNullable<V>>=>{
        for(let poll=0;poll<3;poll++) {
          const value=await read();if(value)return value as NonNullable<V>;
          if(poll===0){mount.resolve();await saving;}
        }
        throw new Error(`Interactive UI deadline: ${label}`);
      };
      await expect(acquireProbeReview({editor:()=>editor,card:()=>undefined,openChat,openCard,until,waitForAutomaticMount})).resolves.toEqual({markdown:draft.markdown,title:draft.title});
      expect(openCard).not.toHaveBeenCalled();expect(openChat).toHaveBeenCalledTimes(waitForAutomaticMount?0:1);
      expect(api.prepareNoteSave).toHaveBeenCalledExactlyOnceWith('conversation-1','answer-1',undefined,{copyIntent:undefined,targetNoteId:undefined,heading:undefined});
      expect(loadDurableProposal).toHaveBeenCalledOnce();
    } finally {mount.resolve();coordinator.dispose();}
  });
  it('fails closed when normal Save never mounts its exact review despite a card being present',async()=>{
    const openChat=vi.fn(async()=>undefined),openCard=vi.fn(async()=>undefined);
    const until=async<V>(read:()=>V|Promise<V>,label:string):Promise<NonNullable<V>>=>{
      expect(await read()).toBeUndefined();throw new Error(`deadline: ${label}`);
    };
    await expect(acquireProbeReview({editor:()=>undefined,card:()=>({id:'save-1'}),openChat,openCard,until,waitForAutomaticMount:true})).rejects.toThrow('deadline: normal Save-mounted proposal review');
    expect(openChat).not.toHaveBeenCalled();expect(openCard).not.toHaveBeenCalled();
  });
  it('opens the matching card once and waits for its editor without repeated clicks',async()=>{
    const card={id:'pending'},editor={id:'retained'};let mounted=false,polls=0;
    const openCard=vi.fn(async()=>undefined);
    const until=async<V>(read:()=>V|Promise<V>):Promise<NonNullable<V>>=>{
      for(let poll=0;poll<4;poll++) {polls++;const value=await read();if(value)return value as NonNullable<V>;if(poll===1)mounted=true;}
      throw new Error('deadline');
    };
    expect(await acquireProbeReview({editor:()=>mounted?editor:undefined,card:()=>card,openChat:async()=>undefined,openCard,until})).toBe(editor);
    expect(openCard).toHaveBeenCalledExactlyOnceWith(card);expect(polls).toBeGreaterThan(1);
  });
});
