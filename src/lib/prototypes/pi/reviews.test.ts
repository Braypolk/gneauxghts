import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Harness,MemoryStorage,createRegistry,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {createModels} from '@earendil-works/pi-ai';
import {fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {Review,stageReview,reviewExtension,readReview,checkpointReview,keepReview,discardReview} from './reviews';
import {Evidence} from './notesExtension';

const prepared={kind:'create' as const,noteId:null,title:'Plan',baseHash:null,suggestedPath:'/vault/Plan.md',
  preview:{reviewId:'preview',proposedEditorMarkdown:'draft'},payload:{markdown:'draft',title:'Plan'}};
const receipt={status:'committed',applied:{kind:'createNote',path:'/vault/Plan.md',previousPath:null},noteId:'note-1',committedMarkdown:'draft',message:null};
const harnesses:Harness[]=[];
// Keep the committed in-memory backing across harness lifetimes; native SQLite
// process recovery is separately exercised by the real-webview acceptance.
class RetainedMemoryStorage extends MemoryStorage {override async close(){}}
beforeEach(()=>{native.invoke.mockReset();native.invoke.mockImplementation(async(command)=>command==='pi_publish_review'?receipt:command==='pi_prepare_review'?prepared:undefined);});
afterEach(async()=>{await Promise.all(harnesses.splice(0).map(h=>h.close(context)));});
async function setup(){
  const extension=reviewExtension(async()=> 'full',()=> 'answer-1');
  const registry=createRegistry();registry.install(extension);
  const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
  const storage=new RetainedMemoryStorage();
  const harness=await Harness.open(storage,{models,registry},context);harnesses.push(harness);
  const conversation=await harness.root(context,{agent:{model:{provider:'faux',modelId:'faux-1'}}});
  let taskId=0;
  await harness.commit(async tx=>{(await tx.doc(Evidence,conversation.id)).access='full';taskId=await stageReview(tx,conversation.id,prepared,'answer-1','origin');},context);
  const id=`pi-review-${taskId}`;
  const api={conversationId:conversation.id,taskId:500,callId:'refine-1',snapshot:harness.snapshot.bind(harness),commit:harness.commit.bind(harness)} as unknown as ToolExecutionApi;
  const refine=(input:{expectedVersion:number;title:string;markdown:string})=>extension.tools!.find(t=>t.name==='refine_note_proposal')!.execute!({proposalId:id,...input} as never,api,context);
  return {harness,id,taskId,refine,extension,api,conversation,storage,models,registry};
}
describe('Pi durable review tasks and extension effects',()=>{
  it('conversation Stop leaves its staged background review available',async()=>{
    const {harness,id,conversation}=await setup();
    await conversation.abort(context);
    expect((await readReview(harness,id)).proposal.status).toBe('pending');
    expect(await keepReview(harness,id,'draft',1)).toEqual(receipt);
  });
  it('reopening the harness restores acknowledged review text without native publication',async()=>{
    const {harness,id,storage,models,registry}=await setup();
    const original=(await readReview(harness,id)).draft;
    await checkpointReview(harness,id,{...original,markdown:'acknowledged before close'},undefined,'full');
    await harness.close(context);harnesses.splice(harnesses.indexOf(harness),1);
    const reopened=await Harness.open(storage,{models,registry},context);harnesses.push(reopened);
    expect((await readReview(reopened,id)).draft).toMatchObject({version:2,markdown:'acknowledged before close'});
    expect((await readReview(reopened,id)).proposal.status).toBe('pending');
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_publish_review')).toBe(false);
    await discardReview(reopened,id);
  });
  it('checkpoints acknowledged edits and Discard settles without any native publication',async()=>{
    const {harness,id}=await setup();const original=(await readReview(harness,id)).draft;
    const edited=await checkpointReview(harness,id,{...original,markdown:'human edit'},undefined,'full');
    expect(edited.version).toBe(2);expect((await readReview(harness,id)).draft.markdown).toBe('human edit');
    expect((await discardReview(harness,id)).status).toBe('dismissed');
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_publish_review')).toBe(false);
  });
  it('a failed native checkpoint does not acknowledge edits or discard the pending review',async()=>{
    const {harness,id}=await setup();const original=(await readReview(harness,id)).draft;
    native.invoke.mockRejectedValueOnce(new Error('checkpoint storage unavailable'));
    await expect(checkpointReview(harness,id,{...original,markdown:'retained in editor'},undefined,'full')).rejects.toThrow('unavailable');
    expect((await readReview(harness,id)).draft).toEqual(original);
    expect((await readReview(harness,id)).proposal.status).toBe('pending');
  });
  it('concurrent and repeated Keep converge through one durable task and native effect',async()=>{
    const {harness,id}=await setup();
    const results=await Promise.all([keepReview(harness,id,'draft',1),keepReview(harness,id,'draft',1)]);
    expect(results).toEqual([receipt,receipt]);
    expect(await keepReview(harness,id,'draft',1)).toEqual(receipt);
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_publish_review')).toHaveLength(1);
    await expect(keepReview(harness,id,'draft',2)).rejects.toThrow('committed');
  });
  it('Keep uses the final acknowledged hunk decision version and rejects a pre-click duplicate',async()=>{
    const {harness,id}=await setup();
    const initial=(await readReview(harness,id)).draft;
    const beforeClick=await checkpointReview(harness,id,{...initial,decisions:[{
      id:'creation',baseFrom:0,baseTo:0,proposedFrom:0,proposedTo:5,
      oldText:'',newText:'draft',from:0,to:5,status:'modified'
    }]},undefined,'full');
    const final=await checkpointReview(harness,id,{...beforeClick,decisions:beforeClick.decisions.map(hunk=>({...hunk,status:'kept' as const}))},undefined,'full');
    expect(final).toMatchObject({version:beforeClick.version+1,markdown:beforeClick.markdown,title:beforeClick.title,path:beforeClick.path});
    expect(await keepReview(harness,id,final.markdown,final.version)).toEqual(receipt);
    await expect(keepReview(harness,id,beforeClick.markdown,beforeClick.version)).rejects.toThrow('committed review');
    const acknowledged=(await readReview(harness,id)).draft;
    expect(acknowledged).toEqual(final);
    expect(await keepReview(harness,id,acknowledged.markdown,acknowledged.version)).toEqual(receipt);
    const calls=native.invoke.mock.calls.filter(([command])=>command==='pi_publish_review');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].accepted).toMatchObject({version:final.version,markdown:beforeClick.markdown});
  });
  it('unknown publication acknowledgement pins the exact native intent for Retry Keep',async()=>{
    const {harness,id}=await setup();
    native.invoke.mockRejectedValueOnce(new Error('receipt unavailable'));
    expect((await keepReview(harness,id,'draft',1)).status).toBe('conflict');
    const uncertain=await readReview(harness,id),intent=uncertain.value.acceptedJson;
    expect(uncertain.draft.version).toBe(1);
    await expect(checkpointReview(harness,id,{...uncertain.draft,markdown:'unsafe new version'},undefined,'full')).rejects.toThrow('Retry Keep');
    await expect(discardReview(harness,id)).rejects.toThrow('Retry Keep');
    expect(await keepReview(harness,id,'draft',1)).toEqual(receipt);
    expect((await readReview(harness,id)).value.acceptedJson).toBe(intent);
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_publish_review').map(([,args])=>args.accepted)).toEqual([JSON.parse(intent),JSON.parse(intent)]);
  });
  it('the refinement extension updates the same pending record once and replay cannot revive settled work',async()=>{
    const {harness,id,refine}=await setup();
    await refine({expectedVersion:1,title:'Plan',markdown:'refined'});
    expect((await readReview(harness,id)).draft).toMatchObject({version:2,markdown:'refined'});
    await discardReview(harness,id);
    await refine({expectedVersion:1,title:'Plan',markdown:'refined'}); // Durable tool replay.
    expect((await readReview(harness,id)).proposal.status).toBe('dismissed');
    expect((await readReview(harness,id)).draft.version).toBe(2);
  });
  it('late refinement cannot overwrite a human checkpoint admitted during native preview',async()=>{
    const {harness,id,refine}=await setup();const gate=Promise.withResolvers<typeof prepared>();
    native.invoke.mockImplementation(async command=>command==='pi_prepare_review'?gate.promise:undefined);
    const pending=refine({expectedVersion:1,title:'Plan',markdown:'late model output'});
    await vi.waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('pi_prepare_review',expect.anything()));
    const original=(await readReview(harness,id)).draft;
    await checkpointReview(harness,id,{...original,markdown:'human edit'},undefined,'full');
    gate.resolve(prepared);
    await expect(pending).rejects.toThrow('latest checkpoint');
    expect((await readReview(harness,id)).draft.markdown).toBe('human edit');
  });
  it('late refinement cannot revive a discarded review',async()=>{
    const {harness,id,refine}=await setup();const gate=Promise.withResolvers<typeof prepared>();
    native.invoke.mockImplementation(async command=>command==='pi_prepare_review'?gate.promise:undefined);
    const pending=refine({expectedVersion:1,title:'Plan',markdown:'late model output'});
    await vi.waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('pi_prepare_review',expect.anything()));
    await discardReview(harness,id);gate.resolve(prepared);
    await expect(pending).rejects.toThrow('settled');
    expect((await readReview(harness,id)).proposal.status).toBe('dismissed');
  });
});
