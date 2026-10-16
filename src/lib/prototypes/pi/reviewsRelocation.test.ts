import {afterEach,describe,expect,it,vi} from 'vitest';
import {Harness,MemoryStorage,createRegistry} from '@earendil-works/pi-durable';
import {createModels,fauxProvider} from '@earendil-works/pi-ai';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {Review,reviewExtension,stageReview,readReview,checkpointReview,keepReview} from './reviews';
import {Evidence} from './notesExtension';

const harnesses:Harness[]=[];
afterEach(async()=>{await Promise.all(harnesses.splice(0).map(harness=>harness.close(context)));native.invoke.mockReset();});
async function setup(uncertain=false){
  let publications=0;
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==='pi_resolve_locations')return (args.paths as string[]).map(path=>{
      if(path.startsWith('/vault/'))return path.replace('/vault/','/moved-vault/');
      if(path.startsWith('/moved-vault/'))return path;
      throw new Error('Location belongs to an unknown vault root');
    });
    if(command==='pi_validate_review_checkpoint'){if(!args.path.startsWith('/moved-vault/'))throw new Error('Target is outside the current vault');return;}
    if(command==='pi_publish_review'){
      if(uncertain&&publications++===0)throw new Error('Native receipt acknowledgement unavailable');
      return {status:'committed',applied:{kind:'createNote',path:'/moved-vault/Plan.md',previousPath:null},noteId:'note-1',committedMarkdown:'draft',message:null};
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const registry=createRegistry();registry.install(reviewExtension(async()=> 'full',()=> 'answer-1'));
  const models=createModels();models.setProvider(fauxProvider().provider);
  const harness=await Harness.open(new MemoryStorage(),{models,registry},context);harnesses.push(harness);
  const conversation=await harness.root(context);let taskId=0;
  await harness.commit(async tx=>{
    const evidence=await tx.doc(Evidence,conversation.id);evidence.access='full';evidence.grantsJson='["original-grant"]';
    taskId=await stageReview(tx,conversation.id,{kind:'create',noteId:null,title:'Plan',baseHash:null,suggestedPath:'/vault/Plan.md',preview:{reviewId:'original-preview'},payload:{markdown:'draft',title:'Plan',proof:'original-proof'}},'answer-1','origin');
  },context);
  return {harness,id:`pi-review-${taskId}`,taskId};
}

describe('relocated review presentation preserves accepted native identity',()=>{
  it('acknowledges the unchanged relocated uncertain draft and retries the exact original intent',async()=>{
    const {harness,id}=await setup(true);expect((await keepReview(harness,id,'draft',1)).status).toBe('conflict');
    const before=await readReview(harness,id);const exact=before.value.acceptedJson;
    const acknowledged=await checkpointReview(harness,id,{...before.draft,path:'/moved-vault/Plan.md'},undefined,'full');
    expect(acknowledged).toEqual({...before.draft,path:'/moved-vault/Plan.md'});
    expect((await readReview(harness,id)).value).toEqual(before.value);
    expect(JSON.parse(exact)).toMatchObject({path:'/vault/Plan.md',grants:['original-grant'],version:1});
    expect((await keepReview(harness,id,'draft',1)).status).toBe('committed');
    expect((await readReview(harness,id)).value.acceptedJson).toBe(exact);
    expect(native.invoke.mock.calls.filter(([command])=>command==='pi_publish_review').map(([,args])=>args.accepted)).toEqual([JSON.parse(exact),JSON.parse(exact)]);
  });

  it('does not treat a proven root relocation as a new pending draft version',async()=>{
    const {harness,id}=await setup();const before=await readReview(harness,id);
    const display={...before.draft,path:'/moved-vault/Plan.md'};
    expect(await checkpointReview(harness,id,display,undefined,'full')).toEqual(display);
    expect((await readReview(harness,id)).value).toEqual(before.value);
    const edited=await checkpointReview(harness,id,{...display,markdown:'human edit'},undefined,'full');
    expect(edited).toMatchObject({version:2,path:'/moved-vault/Plan.md',markdown:'human edit'});
    expect((await readReview(harness,id)).draft).toMatchObject({version:2,path:'/vault/Plan.md',markdown:'human edit'});
    expect(native.invoke.mock.calls.some(([command])=>command==='pi_prepare_review')).toBe(false);
  });

  it('still refuses changed text, another target, or an unknown root while Keep is uncertain',async()=>{
    const {harness,id}=await setup(true);await keepReview(harness,id,'draft',1);const before=await readReview(harness,id);
    await expect(checkpointReview(harness,id,{...before.draft,path:'/moved-vault/Plan.md',markdown:'changed'},undefined,'full')).rejects.toThrow('Retry Keep');
    await expect(checkpointReview(harness,id,{...before.draft,path:'/moved-vault/Other.md'},undefined,'full')).rejects.toThrow('Retry Keep');
    await expect(checkpointReview(harness,id,{...before.draft,path:'/unknown-vault/Plan.md'},undefined,'full')).rejects.toThrow('unknown vault');
    expect((await harness.snapshot(Review,String(before.taskId),context))).toEqual(before.value);
  });
});
