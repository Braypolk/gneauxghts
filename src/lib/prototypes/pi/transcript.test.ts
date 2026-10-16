import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {EntryRecord,SubmissionRecord} from '@earendil-works/pi-durable';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {buildTranscriptSnapshot,createTranscriptPublisher,type TranscriptStatus} from './transcript';
const entry=(id:number,role:string,text:string,extra:Record<string,unknown>={})=>({id,kind:'message',model:[{role,content:[{type:'text',text}]}],...extra}) as unknown as EntryRecord;
const input=(id:number,status='done')=>({id,conversationId:1,type:'input',status,entry:id*2-1,...(status==='done'?{answer:id*2}:status==='unanswered'?{reason:'aborted'}:{})}) as unknown as SubmissionRecord;
const make=(extra:Record<string,unknown>={})=>buildTranscriptSnapshot({conversationId:'pi-1',title:'Chat',createdAtMillis:1,entries:[entry(1,'user','Question'),entry(2,'assistant','Committed answer',{byTaskId:4})],submissions:[input(1)],answers:new Map(),...extra});
const status:TranscriptStatus={projectionPath:'/vault/Chats/Pi/pi-1/Origin.md',detached:false,conflict:null,warning:null};
beforeEach(()=>native.invoke.mockReset());
describe('committed Pi transcript projection',()=>{
  it('publishes acknowledged text and settled origins without a model or live draft',()=>{
    expect(make({settledOrigins:[{messageId:'pi-assistant-1',noteId:'saved'}]})).toMatchObject({messages:[{content:'Question'},{id:'pi-assistant-1',content:'Committed answer'}],settledOrigins:[{noteId:'saved'}]});
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it('withholds provisional structured content until its exact admitted answer exists',()=>{
    expect(make({structuredSubmissions:new Set([1])}).messages[1]).toMatchObject({content:'',sources:[]});
    expect(make({structuredSubmissions:new Set([1]),answers:new Map([[4,{text:'Validated',sourcesJson:'[{"kind":"note","noteId":"source","title":"Source","excerpt":"quote"}]'}]])}).messages[1]).toMatchObject({content:'Validated',sources:[{noteId:'source'}]});
  });
  it('retains interrupted acknowledged output and never guesses unplaced input pairs',()=>{
    const value=make({submissions:[input(1,'unanswered'),{id:2,type:'input',status:'queued'}]});
    expect(value.messages).toHaveLength(2);expect(value.messages[1]).toMatchObject({status:'cancelled',content:'Committed answer'});
  });
  it('keeps histories beyond the former 1000 item cap',()=>{
    const entries=Array.from({length:1200},(_,i)=>[entry(i*2+1,'user',`Question ${i}`),entry(i*2+2,'assistant',`Answer ${i}`)]).flat();
    const value=make({entries,submissions:Array.from({length:1200},(_,i)=>input(i+1))});
    expect(value.messages).toHaveLength(2400);expect(value.messages.at(-1)?.content).toBe('Answer 1199');
  });
  it('serializes publications and reloads the latest committed snapshot after a race',async()=>{
    let release!:()=>void;
    native.invoke.mockImplementationOnce(()=>new Promise<TranscriptStatus>(resolve=>{release=()=>resolve(status);})).mockResolvedValue(status);
    let title='First';const load=vi.fn(async()=>make({title}));
    const publisher=createTranscriptPublisher(load);
    publisher.schedule('pi-1');await vi.waitFor(()=>expect(native.invoke).toHaveBeenCalledTimes(1));
    title='Latest';publisher.schedule('pi-1');publisher.schedule('pi-1');release();await publisher.flush();
    expect(native.invoke.mock.calls.map(([,args])=>args.snapshot.title)).toEqual(['First','Latest']);
    await publisher.close();publisher.schedule('pi-1');expect(load).toHaveBeenCalledTimes(2);
  });
  it('reports projection failure without rejecting committed work and retries on a later schedule',async()=>{
    native.invoke.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(status);
    const observed:TranscriptStatus[]=[];const publisher=createTranscriptPublisher(async()=>make(),(_,value)=>observed.push(value));
    publisher.schedule('pi-1');await publisher.flush();expect(observed[0].warning).toContain('disk full');
    publisher.schedule('pi-1');await publisher.flush();expect(observed[1]).toEqual(status);
  });
});
