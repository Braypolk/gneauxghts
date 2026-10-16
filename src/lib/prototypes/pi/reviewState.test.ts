import {describe,it,expect} from 'vitest';
import {acknowledgeDraft,acceptKeep,draftOf,proposalOf,requirePending,type ReviewRecord} from './reviewState';

function record():ReviewRecord {
  return {proposalJson:JSON.stringify({id:'pi-review-1',conversationId:'pi-2',kind:'update',status:'pending',noteId:'note-1',baseHash:'base',
    title:'Plan',suggestedPath:'/vault/Plan.md',preview:{notePath:'/vault/Plan.md'},payload:{markdown:'draft',originalSave:true}}),
    draftJson:JSON.stringify({version:1,title:'Plan',path:'/vault/Plan.md',markdown:'draft',decisions:[]}),
    decision:'pending',acceptedJson:'',receiptJson:'',receiptVersion:0,fault:''};
}
describe('Pi acknowledged review transitions',()=>{
  it('retains a no-op checkpoint version and persists independent title/location and hunk choices',()=>{
    const state=record(),initial=draftOf(state);
    expect(acknowledgeDraft(state,initial).version).toBe(1);
    const decisions=[{id:'h1',from:0,to:5,status:'modified'}] as never;
    const next=acknowledgeDraft(state,{...initial,title:'Renamed',path:'/vault/folder/Other.md',decisions});
    expect(next).toMatchObject({version:2,title:'Renamed',path:'/vault/folder/Other.md',decisions});
    expect(proposalOf(state).payload.originalSave).toBe(true);
  });
  it('rejects late refinement after a newer human checkpoint without losing the human draft',()=>{
    const state=record(),initial=draftOf(state);
    acknowledgeDraft(state,{...initial,markdown:'human edit'});
    expect(()=>acknowledgeDraft(state,{...initial,markdown:'late model output'})).toThrow('latest checkpoint');
    expect(draftOf(state).markdown).toBe('human edit');
  });
  for(const decision of ['keep','discard'])it(`rejects refinement after ${decision} admission`,()=>{
    const state=record(),initial=draftOf(state);state.decision=decision;
    expect(()=>acknowledgeDraft(state,{...initial,markdown:'late'})).toThrow('settled');
    expect(draftOf(state).markdown).toBe('draft');
  });
  it('binds Keep to version/body/source identity and joins duplicate Keep without mutating intent',()=>{
    const state=record();
    expect(()=>acceptKeep(state,'pi-review-1',2,'draft','full')).toThrow('acknowledged');
    expect(()=>acceptKeep(state,'pi-review-1',1,'unacknowledged','full')).toThrow('acknowledged');
    acceptKeep(state,'pi-review-1',1,'draft','full');const intent=state.acceptedJson;
    expect(JSON.parse(intent)).toMatchObject({version:1,noteId:'note-1',sourcePath:'/vault/Plan.md',path:'/vault/Plan.md',markdown:'draft',baseHash:'base'});
    acceptKeep(state,'pi-review-1',1,'draft','approved');
    expect(state.acceptedJson).toBe(intent);
  });
  it('pins an uncertain native intent to its original payload until Keep reconciliation',()=>{
    const state=record();acceptKeep(state,'pi-review-1',1,'draft','full');const intent=state.acceptedJson;
    state.decision='pending';
    expect(()=>acknowledgeDraft(state,{...draftOf(state),markdown:'later'})).toThrow('Retry Keep');
    acceptKeep(state,'pi-review-1',1,'draft','none');expect(state.acceptedJson).toBe(intent);
  });
  for(const status of ['committed','dismissed'])it(`cannot revive ${status} proposals`,()=>{
    const state=record(),proposal=proposalOf(state);proposal.status=status as never;state.proposalJson=JSON.stringify(proposal);
    expect(()=>requirePending(state)).toThrow('settled');
    expect(()=>acceptKeep(state,'pi-review-1',1,'draft','full')).toThrow('settled');
  });
});
