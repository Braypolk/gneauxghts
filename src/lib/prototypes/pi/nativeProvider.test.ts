import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NativeAdmission, RequestPolicies } from './nativeProvider';
const mock = vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mock.invoke,Channel:class {onmessage?: (frame:unknown)=>void;}}));
import { nativeModels, nativeFetch, admitNativeRequest } from './nativeProvider';
import { Type } from '@earendil-works/pi-ai';

const admission = (provider:'local'|'openai',model='model-a'):NativeAdmission => ({id:'native-opaque',provider,model,reasoningEffort:'off',serviceTier:'standard',tools:true,images:false,audio:false,video:false});
const capabilities={images:false,audio:false,video:false,files:true,acceptedMimeTypes:[],tools:true};
const sse=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
function serve(provider:'local'|'openai',tool=false,mixed=false) {
  mock.invoke.mockImplementation(async(command,args)=>{
    if(command==='pi_admit_answer') return {text:args.raw,sources:[]};
    if(command!=='pi_fetch') return;
    args.frames.onmessage({type:'headers',status:200,content_type:'text/event-stream'});
    let wire='';
    if(provider==='local') {
      const chunk=(delta:unknown,finish_reason:null|string=null)=>({id:'fixture',object:'chat.completion.chunk',model:JSON.parse(args.body).model,choices:[{index:0,delta,finish_reason}]});
      wire+=sse(chunk({role:'assistant'}));
      if(tool && mixed)wire+=sse(chunk({content:'unvalidated draft'}));
      wire+=tool?sse(chunk({tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'read_note',arguments:'{"note'}}]}))+sse(chunk({tool_calls:[{index:0,function:{arguments:'Id":"n1"}'}}]})):sse(chunk({content:'hello'}));
      wire+=sse(chunk({},tool?'tool_calls':'stop'))+'data: [DONE]\n\n';
    } else {
      const outputIndex=tool && mixed?1:0;
      const prefix={type:'message',id:'draft-1',role:'assistant',status:'completed',content:[{type:'output_text',text:'unvalidated draft',annotations:[]}]};
      const item=tool?{type:'function_call',id:'fc-1',call_id:'call-1',name:'read_note',arguments:''}:{type:'message',id:'msg-1',role:'assistant',status:'in_progress',content:[]};
      wire+=sse({type:'response.created',response:{id:'resp-1'}});
      if(tool && mixed)wire+=sse({type:'response.output_item.added',output_index:0,item:{...prefix,status:'in_progress',content:[]}})+sse({type:'response.output_text.delta',output_index:0,content_index:0,delta:'unvalidated draft'})+sse({type:'response.output_item.done',output_index:0,item:prefix});
      wire+=sse({type:'response.output_item.added',output_index:outputIndex,item});
      if(tool)wire+=sse({type:'response.function_call_arguments.delta',output_index:outputIndex,delta:'{"note'})+sse({type:'response.function_call_arguments.delta',output_index:outputIndex,delta:'Id":"n1"}'});
      else wire+=sse({type:'response.output_text.delta',output_index:0,content_index:0,delta:'hello'});
      const done=tool?{...item,arguments:'{"noteId":"n1"}',status:'completed'}:{...item,status:'completed',content:[{type:'output_text',text:'hello',annotations:[]}]};
      wire+=sse({type:'response.output_item.done',output_index:outputIndex,item:done})+sse({type:'response.completed',response:{id:'resp-1',status:'completed',output:tool && mixed?[prefix,done]:[done],usage:{input_tokens:4,output_tokens:4,total_tokens:8}}});
    }
    // Split inside SSE/UTF-8 boundaries to exercise Pi's real pinned parser.
    const bytes=new TextEncoder().encode(wire);
    for(let i=0;i<bytes.length;i+=17)args.frames.onmessage({type:'chunk',bytes:[...bytes.slice(i,i+17)]});
    args.frames.onmessage({type:'done'});
  });
}

beforeEach(()=>{mock.invoke.mockReset();});
describe('native Pi provider configuration',()=>{
  it('registers multiple models and preserves registered models through switching',()=>{
    const models=nativeModels(new Map());
    models.registerModel('local','model-a',capabilities);models.registerModel('local','model-b',capabilities);
    models.registerModel('openai','hosted-b',capabilities);
    expect(models.getModel('local','model-a')?.id).toBe('model-a');
    expect(models.getModel('local','model-b')?.id).toBe('model-b');
    expect(models.getModel('openai','hosted-b')?.api).toBe('openai-responses');
    expect(models.getModel('local','missing')).toBeUndefined();
    expect(models.getModel('local','model-b')?.compat).toMatchObject({supportsDeveloperRole:false,supportsMidConvoSystemMessages:false});
  });
  it('admits native routing without sending endpoints or credentials',async()=>{
    mock.invoke.mockResolvedValue(admission('local'));
    await admitNativeRequest('local','model-a','off','standard');
    expect(mock.invoke).toHaveBeenCalledWith('pi_admit_provider_request',{provider:'local',model:'model-a',reasoningEffort:'off',serviceTier:'standard'});
  });
  for(const provider of ['local','openai'] as const) {
    for(const tool of [false,true]) it(`${provider} assembles ${tool?'split tool arguments':'answer'} using admitted model`,async()=>{
      serve(provider,tool);
      const policies:RequestPolicies=new Map([['session',{access:'none',sources:[],taskId:1,admission:admission(provider),history:[{role:'user',content:'previous question',timestamp:1}]}]]);
      const models=nativeModels(policies);const model=models.registerModel(provider,'model-a',capabilities);
      const result=await models.streamSimple(model,{systemPrompt:'First',messages:[{role:'user',content:'current',timestamp:2},{role:'system',content:'Second',timestamp:3}]}, {sessionId:'session'}).result();
      expect(result.stopReason).toBe(tool?'toolUse':'stop');
      if(tool)expect(result.content).toContainEqual(expect.objectContaining({type:'toolCall',name:'read_note',arguments:{noteId:'n1'}}));
      else expect(result.content).toEqual([{type:'text',text:'hello'}]);
      const request=mock.invoke.mock.calls.find(([command])=>command==='pi_fetch')![1];
      expect(request.admissionId).toBe('native-opaque');expect(JSON.parse(request.body).model).toBe('model-a');
      const wire=JSON.parse(request.body);
      expect(JSON.stringify(wire)).toContain('previous question');
      if(provider==='local')expect(wire.messages.filter((message:{role:string})=>message.role==='system')).toHaveLength(1);
      expect(policies.size).toBe(0);
    });
    for(const structured of [true,false])it(`${provider} ${structured?'hides structured draft':'retains ordinary text'} beside split tool calls in all forwarded messages`,async()=>{
      serve(provider,true,true);
      const policies:RequestPolicies=new Map([['session',{access:'none',sources:[],taskId:1,admission:admission(provider),structured}]]);
      const models=nativeModels(policies);const model=models.registerModel(provider,'model-a',capabilities);
      const stream=models.streamSimple(model,{messages:[{role:'user',content:'read note',timestamp:1}]},{sessionId:'session'});
      const events=[];for await(const event of stream)events.push(event);
      const result=await stream.result();
      expect(result.stopReason).toBe('toolUse');
      expect(result.content).toContainEqual(expect.objectContaining({type:'toolCall',name:'read_note',arguments:{noteId:'n1'}}));
      const forwarded=events.flatMap(event=>'partial' in event?[event.partial]:'message' in event?[event.message]:'error' in event?[event.error]:[]);
      expect(forwarded.length).toBeGreaterThan(1);
      if(structured) {
        expect(events.some(event=>event.type.startsWith('text_'))).toBe(false);
        for(const message of forwarded)expect(message.content.some(block=>block.type==='text')).toBe(false);
        expect(result.content.some(block=>block.type==='text')).toBe(false);
      } else {
        expect(events.filter(event=>event.type==='text_delta').map(event=>event.delta).join('')).toBe('unvalidated draft');
        expect(result.content).toContainEqual(expect.objectContaining({type:'text',text:'unvalidated draft'}));
      }
      // A tool-use handoff is never mistaken for final answer admission.
      expect(mock.invoke.mock.calls.some(([command])=>command==='pi_admit_answer')).toBe(false);
    });
    it(`${provider} denies stale or missing admissions without dispatch`,async()=>{
      const policies:RequestPolicies=new Map([['session',{access:'none',sources:[],taskId:1,admission:admission(provider,'other')}]]);
      const models=nativeModels(policies);const model=models.registerModel(provider,'model-a',capabilities);
      const result=await models.streamSimple(model,{messages:[{role:'user',content:'hello',timestamp:1}]},{sessionId:'session'}).result();
      expect(result.stopReason).toBe('error');expect(mock.invoke).not.toHaveBeenCalled();
    });
  }
  it('retains explicit retry routing and capability snapshots without credential material',async()=>{
    mock.invoke.mockResolvedValue(admission('local'));
    const original={localBaseUrl:'http://127.0.0.1:1111/v1',capabilities};
    await admitNativeRequest('local','model-a','off','standard',original);
    expect(mock.invoke).toHaveBeenCalledWith('pi_admit_provider_request',expect.objectContaining({configuration:original}));
    expect(JSON.stringify(mock.invoke.mock.calls)).not.toContain('apiKey');
  });
  it('streams ordinary text once and rechecks policy before final admission',async()=>{
    serve('local');const validate=vi.fn(async()=>{});
    const policies:RequestPolicies=new Map([['session',{access:'none',sources:[],taskId:1,admission:admission('local'),structured:false,validate}]]);
    const models=nativeModels(policies);const model=models.registerModel('local','model-a',capabilities);
    let delta='';for await(const event of models.streamSimple(model,{messages:[{role:'user',content:'hello',timestamp:1}]},{sessionId:'session'}))if(event.type==='text_delta')delta+=event.delta;
    expect(delta).toBe('hello');expect(validate).toHaveBeenCalledTimes(2);
    expect(mock.invoke).toHaveBeenCalledWith('pi_admit_answer',expect.objectContaining({structured:false,raw:'hello'}));
  });
  it('mandatory policy failure prevents dispatch even when hooks permit generation',async()=>{
    const policies:RequestPolicies=new Map([['session',{access:'none',sources:[],taskId:1,admission:admission('local'),validate:async()=>{throw new Error('Evidence revoked');}}]]);
    const models=nativeModels(policies);const model=models.registerModel('local','model-a',capabilities);
    const result=await models.streamSimple(model,{messages:[{role:'user',content:'hello',timestamp:1}]},{sessionId:'session'}).result();
    expect(result.stopReason).toBe('error');expect(result.errorMessage).toContain('Evidence revoked');expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('aborts native HTTP before headers and rejects instead of completing',async()=>{
    let pendingResolve:()=>void=()=>{};
    mock.invoke.mockImplementation((command)=>command==='pi_fetch'?new Promise<void>(resolve=>{pendingResolve=resolve;}):Promise.resolve());
    const signal=new AbortController();const fetch=nativeFetch('local',admission('local'));
    const result=fetch('https://native.invalid',{method:'POST',body:'{}',signal:signal.signal});
    signal.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});
    expect(mock.invoke).toHaveBeenCalledWith('pi_cancel_fetch',expect.objectContaining({id:expect.any(String)}));pendingResolve();
  });
  it('reports a native connection failure explicitly',async()=>{
    mock.invoke.mockImplementation(()=>Promise.reject('Native provider connection failed'));
    await expect(nativeFetch('local',admission('local'))('https://native.invalid',{method:'POST',body:'{}'})).rejects.toBe('Native provider connection failed');
  });
  for(const provider of ['local','openai'] as const)for(const purpose of ['researchSelection','summary'] as const)it(`${provider} ${purpose} preserves isolated history and validates without admitting an answer`,async()=>{
    serve(provider);
    const validate=vi.fn(async()=>{}),validateOutput=vi.fn(async()=>{}),persist=vi.fn(async()=>{});
    const tool={name:'find_notes',description:'Find notes',parameters:Type.Object({query:Type.String()})};
    const policies:RequestPolicies=new Map([['worker',{purpose,access:'none',sources:[],taskId:90,
      admission:admission(provider),validate,validateOutput,history:[{role:'user',content:'PARENT HISTORY MUST STAY OUT',timestamp:0}]}]]);
    const models=nativeModels(policies,persist),model=models.registerModel(provider,'model-a',capabilities);
    const result=await models.streamSimple(model,{systemPrompt:'isolated contract',tools:[tool],messages:[
      {role:'user',content:'worker earlier question',timestamp:1},
      {role:'user',content:'worker latest question',timestamp:2}
    ]},{sessionId:'worker'}).result();
    expect(result.stopReason).toBe('stop');expect(result.content).toEqual([expect.objectContaining({type:'text',text:'hello'})]);
    if(provider==='openai')expect(result.content[0]).toHaveProperty('textSignature');
    expect(validate).toHaveBeenCalledTimes(2);expect(validateOutput).toHaveBeenCalledWith('hello');
    expect(persist).not.toHaveBeenCalled();expect(mock.invoke.mock.calls.some(([command])=>command==='pi_admit_answer')).toBe(false);
    const request=mock.invoke.mock.calls.find(([command])=>command==='pi_fetch')![1];
    expect(request.purpose).toBe(purpose);
    expect(request.body).toContain('worker earlier question');expect(request.body).toContain('worker latest question');
    expect(request.body).not.toContain('PARENT HISTORY');
    const wire=JSON.parse(request.body);
    expect(wire.tools?.length ?? 0).toBe(purpose==='summary'?0:1);
  });
  it('requires isolated authorization and output validators before dispatch',async()=>{
    const policies:RequestPolicies=new Map([['worker',{purpose:'summary',access:'none',sources:[],taskId:90,admission:admission('local')}]]);
    const models=nativeModels(policies),model=models.registerModel('local','model-a',capabilities);
    const result=await models.streamSimple(model,{messages:[{role:'user',content:'summarize',timestamp:1}]},{sessionId:'worker'}).result();
    expect(result.stopReason).toBe('error');expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('retains provider usage when closed output validation rejects an isolated completion',async()=>{
    serve('openai');const persist=vi.fn(async()=>{});
    const policies:RequestPolicies=new Map([['worker',{purpose:'researchSelection',access:'none',sources:[],taskId:90,
      admission:admission('openai'),validate:async()=>{},validateOutput:()=>{throw new Error('Malformed selection');}}]]);
    const models=nativeModels(policies,persist),model=models.registerModel('openai','model-a',capabilities);
    const result=await models.streamSimple(model,{messages:[{role:'user',content:'research',timestamp:1}]},{sessionId:'worker'}).result();
    expect(result.stopReason).toBe('error');expect(result.errorMessage).toContain('Malformed selection');
    expect(result.usage.input).toBe(4);expect(result.usage.output).toBe(4);expect(result.content).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });
  it('forwards durable attachment bytes separately from Pi JSON without inventing Pi content types',async()=>{
    serve('openai');
    const attachments=[{id:'admitted-attachment',kind:'file' as const,name:'source.pdf',mimeType:'application/pdf',sizeBytes:4,dataBase64:'JVBERg=='}];
    const policies:RequestPolicies=new Map([['session',{access:'none',sources:[],taskId:1,admission:admission('openai'),structured:false,attachments}]]);
    const models=nativeModels(policies),model=models.registerModel('openai','model-a',capabilities);
    await models.streamSimple(model,{messages:[{role:'user',content:'read attached',timestamp:1}]},{sessionId:'session'}).result();
    const request=mock.invoke.mock.calls.find(([command])=>command==='pi_fetch')![1];
    expect(request.attachments).toEqual(attachments);expect(request.body).not.toContain('JVBERg==');
    expect(JSON.parse(request.body).input.at(-1).role).toBe('user');
  });
  it('adds authored web inventory only after canonical answer admission',async()=>{
    serve('local');const handler=mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async(command,args)=>command==='pi_admit_answer'
      ? {text:'Fact [site](https://example.com).',sources:[],associations:[]}:handler(command,args));
    const persist=vi.fn(async()=>{}),policy={access:'none' as const,sources:[],taskId:1,admission:admission('local'),structured:false};
    const models=nativeModels(new Map([['session',policy]]),persist),model=models.registerModel('local','model-a',capabilities);
    const result=await models.streamSimple(model,{messages:[{role:'user',content:'question',timestamp:1}]},{sessionId:'session'}).result();
    expect(result.content).toEqual([{type:'text',text:'Fact [site](https://example.com).'}]);
    expect(persist).toHaveBeenCalledWith(policy,expect.objectContaining({sources:[expect.objectContaining({kind:'web',url:'https://example.com',passage:null})]}));
    expect(policy.sources).toEqual([]);
  });
  it('uses the admitted compacted answer context without dropping retained tool groups',async()=>{
    serve('local');
    const tool={name:'read_note',description:'Read note',parameters:Type.Object({id:Type.String()})};
    const policies:RequestPolicies=new Map([['session',{access:'none',sources:[],taskId:1,admission:admission('local'),structured:false,
      history:[{role:'user',content:'OBSOLETE HISTORY',timestamp:0}],context:[
        {role:'system',content:'original answer contract',toolsAdded:[tool],timestamp:1},
        {role:'user',content:'original request retained',timestamp:2},
        {role:'toolResult',toolCallId:'retained-call',toolName:'read_note',content:[{type:'text',text:'retained current tool group'}],isError:false,timestamp:3},
        {role:'user',content:'Pi working summary marker',timestamp:4}
      ]}]]);
    const models=nativeModels(policies),model=models.registerModel('local','model-a',capabilities);
    await models.streamSimple(model,{messages:[{role:'user',content:'WRONG latest user slice',timestamp:5}]},{sessionId:'session'}).result();
    const wire=mock.invoke.mock.calls.find(([command])=>command==='pi_fetch')![1].body;
    expect(wire).toContain('original answer contract');expect(wire).toContain('original request retained');
    expect(wire).toContain('retained current tool group');expect(wire).not.toContain('OBSOLETE HISTORY');
    expect(wire).not.toContain('WRONG latest user slice');
  });
  it('does not admit isolated output after authorization changes during inference',async()=>{
    serve('openai');let checks=0;const validateOutput=vi.fn(async()=>{}),persist=vi.fn(async()=>{});
    const policies:RequestPolicies=new Map([['worker',{purpose:'summary',access:'none',sources:[],taskId:1,admission:admission('openai'),
      validate:async()=>{if(++checks>1)throw new Error('Authorization retired');},validateOutput}]]);
    const models=nativeModels(policies,persist),model=models.registerModel('openai','model-a',capabilities);
    const result=await models.streamSimple(model,{messages:[{role:'user',content:'summary',timestamp:1}]},{sessionId:'worker'}).result();
    expect(result.stopReason).toBe('error');expect(result.errorMessage).toContain('Authorization retired');
    expect(result.usage.totalTokens).toBe(8);expect(validateOutput).not.toHaveBeenCalled();expect(persist).not.toHaveBeenCalled();
  });
  it('rejects a provider tool call on a summary request',async()=>{
    serve('openai',true);const validateOutput=vi.fn(async()=>{});
    const policies:RequestPolicies=new Map([['worker',{purpose:'summary',access:'none',sources:[],taskId:1,admission:admission('openai'),validate:async()=>{},validateOutput}]]);
    const models=nativeModels(policies),model=models.registerModel('openai','model-a',capabilities);
    const result=await models.streamSimple(model,{messages:[{role:'user',content:'summary',timestamp:1}]},{sessionId:'worker'}).result();
    expect(result.stopReason).toBe('error');expect(result.errorMessage).toContain('cannot execute tools');
    expect(result.content).toEqual([]);expect(validateOutput).not.toHaveBeenCalled();
  });
});
