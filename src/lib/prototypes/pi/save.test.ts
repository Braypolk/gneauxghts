import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Harness,MemoryStorage,createRegistry} from '@earendil-works/pi-durable';
import {createModels} from '@earendil-works/pi-ai';
import {fauxProvider} from '@earendil-works/pi-ai/providers/faux';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {Reviews,reviewExtension,readReview,keepReview,discardReview} from './reviews';
import {Evidence} from './notesExtension';
import {conversationFromOriginPath,originProjectionPath,saveAnswer,saveOrigin} from './save';

const prepared={kind:'create' as const,noteId:null,title:'Saved',baseHash:null,suggestedPath:'/vault/Saved.md',
  preview:{reviewId:'preview',proposedEditorMarkdown:'**same** [[Source|Source]]\n\n[[Chats/Pi/pi-1/Origin#^msg_pi-assistant-2|Open in chat]]'},
  payload:{markdown:'**same** [[Source|Source]]\n\n[[Chats/Pi/pi-1/Origin#^msg_pi-assistant-2|Open in chat]]',wholeAnswer:false,originalSave:true}};
const receipt={status:'committed',applied:{kind:'createNote',path:'/vault/Saved.md',previousPath:null},noteId:'saved-id',committedMarkdown:prepared.payload.markdown,message:null};
const harnesses:Harness[]=[];
beforeEach(()=>{native.invoke.mockReset();native.invoke.mockImplementation(async command=>command==='pi_prepare_save'?structuredClone(prepared):command==='pi_publish_review'?receipt:undefined);});
afterEach(async()=>{await Promise.all(harnesses.splice(0).map(h=>h.close(context)));});
async function setup(storage=new MemoryStorage()) {
  const registry=createRegistry();registry.install(reviewExtension(async()=> 'none',()=> 'pi-assistant-2'));
  const models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
  const harness=await Harness.open(storage,{models,registry},context);harnesses.push(harness);
  return {harness,storage,models,faux};
}
const answer={text:'Same **same**.\n\nSame **same**. [Source 1](passage:proof)',sourcesJson:'[{"kind":"passage","noteId":"source","passage":{"id":"proof"}}]',associationsJson:'[{"start":16,"end":61,"links":["[Source 1](passage:proof)"]}]'};
const selection={markdown:'**same**',text:'same',occurrence:1};

describe('deterministic Pi Save',()=>{
  it('uses stable exact selection and explicit copy intents for origins',()=>{
    expect(saveOrigin('pi-1','pi-assistant-2',selection,{})).toBe(saveOrigin('pi-1','pi-assistant-2',{...selection,text:' same '},undefined));
    expect(saveOrigin('pi-1','pi-assistant-2',selection)).not.toBe(saveOrigin('pi-1','pi-assistant-2',{...selection,occurrence:0}));
    expect(saveOrigin('pi-1','pi-assistant-2',selection)).not.toBe(saveOrigin('pi-1','pi-assistant-2',selection,{copyIntent:'copy-1'}));
    expect(saveOrigin('pi-1','pi-assistant-2')).not.toBe(saveOrigin('pi-1','pi-assistant-2',undefined,{targetNoteId:'target',heading:'Plan'}));
  });
  it('verifies durable answer and recorded associations natively, deduplicates concurrent Save without model calls',async()=>{
    const {harness}=await setup();const conversation=await harness.root(context);
    const submit=vi.spyOn(conversation,'submit');
    const input={conversationId:`pi-${conversation.id}`,messageId:'pi-assistant-2',answer,selection,access:'none' as const};
    const [left,right]=await Promise.all([saveAnswer(harness,input),saveAnswer(harness,input)]);
    expect(left.id).toBe(right.id);
    expect((await harness.snapshot(Reviews,context))?.ids).toHaveLength(1);
    expect(native.invoke).toHaveBeenCalledWith('pi_prepare_save',{input:expect.objectContaining({markdown:answer.text,selection,sources:JSON.parse(answer.sourcesJson),associations:JSON.parse(answer.associationsJson),targetNoteId:null})});
    expect((await readReview(harness,left.id)).draft.markdown).toBe(prepared.payload.markdown);
    expect(submit).not.toHaveBeenCalled();
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_model_request')).toBe(false);
  });
  it('reopens the same pending and committed origin after harness restart without another native preparation',async()=>{
    let {harness,storage}=await setup();const conversation=await harness.root(context);
    await harness.commit(async tx=>{(await tx.doc(Evidence,conversation.id)).access='none';},context);
    const input={conversationId:`pi-${conversation.id}`,messageId:'pi-assistant-2',answer,selection,access:'none' as const};
    const pending=await saveAnswer(harness,input);
    // Retain the committed in-memory backing store across Harness lifetimes,
    // as a reopened SQLite file does in the native restart fixture.
    storage.close=async()=>{};
    await harness.close(context);harnesses.splice(harnesses.indexOf(harness),1);
    ({harness}=await setup(storage));
    expect((await saveAnswer(harness,input)).id).toBe(pending.id);
    expect(await keepReview(harness,pending.id,prepared.payload.markdown,1)).toEqual(receipt);
    expect((await saveAnswer(harness,input))).toMatchObject({id:pending.id,status:'committed',payload:{committedNoteId:'saved-id'}});
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_prepare_save')).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_publish_review')).toHaveLength(1);
  });
  it('Discard creates no note and explicit copy stages a distinct origin',async()=>{
    const {harness}=await setup();const conversation=await harness.root(context);
    const input={conversationId:`pi-${conversation.id}`,messageId:'pi-assistant-2',answer,selection,access:'none' as const};
    const original=await saveAnswer(harness,input);await discardReview(harness,original.id);
    const copy=await saveAnswer(harness,{...input,options:{copyIntent:'copy-intent-1'}});
    expect(copy.id).not.toBe(original.id);
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_publish_review')).toBe(false);
  });
  it('routes only the reserved Pi origin shape across absolute/relative paths',()=>{
    const path=originProjectionPath('pi-12');expect(conversationFromOriginPath(path)).toBe('pi-12');
    expect(conversationFromOriginPath(`/vault/${path}`)).toBe('pi-12');
    expect(conversationFromOriginPath('C:\\vault\\Chats\\Pi\\pi-12\\Origin.md')).toBe('pi-12');
    for(const invalid of ['Chats/Pi/pi-0/Origin.md','Chats/Pi/pi-1/../Origin.md','Chats/Pi/pi-1/Origin.md.backup','Chats/Pi/pi-1/Other.md'])expect(conversationFromOriginPath(invalid)).toBeNull();
  });
});
