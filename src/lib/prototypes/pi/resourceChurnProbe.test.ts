import {expect,it,vi} from 'vitest';
import type {ChatApi} from '$lib/features/chat/api';
import {assertOwnedResourcePlateau,runResourceChurnProbe} from './resourceChurnProbe';
vi.mock('./chatApi',()=>({readPiChatResourceSnapshot:()=>{throw new Error('Explicit fake snapshot expected');}}));

function fixture(leak=false){
  let listeners=12;const visits:string[]=[];
  const snapshot=async()=>({liveApiOwners:1,policyCancellationOwners:1,quiesceListenerRequested:true,
    owners:[{enginePresent:true,closing:false,commitSubscription:true,projectionListener:true,listeners,listenerEventKeys:12,listenerEventSets:listeners===12?4:5,
      eventStreams:0,evidenceWatches:0,requestEventBindings:0,sequences:0,admissions:0,admitting:0,active:0,policies:0,permitted:0,projectionStates:3}],
    upstreamDocumentTrackers:null,upstreamWatchers:null,nativeLeases:null,coverage:'app-owned-collections-only' as const});
  const api={getConversation:async(id:string)=>({id,activeRequestId:null,messages:[{id:`m-${id}`,content:'synthetic',status:'completed'}]}),
    listPendingProposals:async(id:string)=>id==='a'?[{id:'pending-review',status:'pending'}]:[],
    on:async()=>{listeners++;let stopped=false;return()=>{if(!stopped){stopped=true;if(!leak)listeners--;}}}} as unknown as ChatApi;
  return {api,snapshot,visits,navigate:async(id:string)=>{visits.push(id);}};
}
it('measures actual callback attachment and returns to a nonzero mounted-owner baseline in all twenty cycles',async()=>{
  const f=fixture();const result=await runResourceChurnProbe(f.api,['a','b','c'],20,f.snapshot,f.navigate);
  expect(result.after).toEqual(result.before);expect(result.samples).toHaveLength(20);expect(f.visits).toHaveLength(60);
  expect(result).toMatchObject({mountedNavigationObserved:true,controllerDisposalObserved:false,unexpectedCallbacks:0,historyAndPendingReviewsUnchanged:true});
});
it('rejects an actual detached-callback leak, even with no unsolicited event',async()=>{
  const f=fixture(true);await expect(runResourceChurnProbe(f.api,['a','b','c'],20,f.snapshot)).rejects.toThrow('baseline');
});
it('does not accept another owner or a watch leak as stable resources',async()=>{
  const f=fixture(),before=await f.snapshot();
  expect(()=>assertOwnedResourcePlateau(before,{...before,liveApiOwners:2})).toThrow('baseline');
  expect(()=>assertOwnedResourcePlateau(before,{...before,owners:[{...before.owners[0],evidenceWatches:1}]})).toThrow('baseline');
  await expect(runResourceChurnProbe(f.api,['a','a','b'],20,f.snapshot)).rejects.toThrow('distinct');
});
