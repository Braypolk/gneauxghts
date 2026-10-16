// Provider plans only. Importing this module opens no listener or application.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { DUMMY_AUTHORIZATION } from './shared-resource-gate.mjs';

export const PARITY_ANSWER = 'Echo phrase. Echo phrase.\n\n## Details\n\nFaithful synthetic answer.';
export const PARITY_EDIT = 'Human-reviewed orchard plan.\n\n## Selected addition\n';
const objects = value => value && typeof value === 'object'
  ? [value, ...Object.values(value).flatMap(objects)] : [];

// Context is differently labelled in the two runtimes. Parse actual embedded
// JSON objects, rather than copying selectors or inventing evidence references.
export function embeddedObjects(text) {
  const found=[];
  for(let start=0;start<text.length;start++) {
    if(!'{['.includes(text[start]))continue;
    let quoted=false,escaped=false;const stack=[];
    for(let end=start;end<text.length;end++) {
      const char=text[end];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"'){quoted=true;continue;}
      if(char==='{'||char==='[')stack.push(char);
      else if(char==='}'||char===']') {
        if(stack.pop()!==(char==='}'?'{':'['))break;
        if(!stack.length){try{found.push(...objects(JSON.parse(text.slice(start,end+1))));start=end;}catch{}break;}
      }
    }
  }
  return found;
}

export function planParityReply(body,lane,protocol='compatible',authorization) {
  assert(['old','pi'].includes(lane),'Unknown parity lane');
  assert(['compatible','responses'].includes(protocol),'Unknown protocol');
  assert(authorization===undefined||authorization===DUMMY_AUTHORIZATION,'Unexpected fixture credentials');
  const history=protocol==='compatible'?body.messages:body.input;
  assert(Array.isArray(history),'Provider history required');
  const textOf=item=>typeof item.content==='string'?item.content:(item.content??[]).map(part=>part.text??'').join('');
  const last=history.findLastIndex(item=>item.role==='user');
  assert(last>=0,'Authored request required');
  const marker=textOf(history[last]).match(/PARITY:([A-Z_]+)(?::([a-zA-Z0-9_-]+))?/);
  assert(marker,'Unknown synthetic journey');
  const [,journey,noteId]=marker,tail=history.slice(last+1);
  const calls=tail.flatMap(item=>item.tool_calls?.map(call=>call.function.name)??(item.type==='function_call'?[item.name]:[]));
  const outputs=tail.filter(item=>item.role==='tool'||item.type==='function_call_output');
  const delivered=outputs.flatMap(item=>embeddedObjects(typeof(item.output??item.content)==='string'?(item.output??item.content):JSON.stringify(item.output??item.content)));
  const tools=(body.tools??[]).map(item=>item.function??item);
  const tool=(name,args)=>{assert(tools.some(item=>item.name===name),`Fixture requested unavailable ${name}`);return{journey,tool:{name,arguments:JSON.stringify(args)}};};
  const finish=(text,sources=[])=>{
    const value={segments:[{text,sources}]};
    const formatter=tools.find(item=>item.parameters?.properties?.segments);
    if(lane==='old'&&formatter)return tool(formatter.name,value);
    assert(lane!=='old'||sources.length===0,'Old grounded answer formatter absent');
    return{journey,text:sources.length?JSON.stringify(value):text};
  };
  const sourceAnswer=()=>{
    const source=delivered.find(value=>typeof value.sourceId==='string'&&value.location==='body')??delivered.find(value=>typeof value.sourceId==='string');
    assert(source,'No actually delivered sourceId');
    return finish('Synthetic canonical orchard evidence.',[source.sourceId]);
  };
  const readName=lane==='old'?'read_notes':'read_note';
  const readArgs=lane==='old'?{purpose:'answer',note_id:noteId}:{noteId};
  if(journey==='READ'||journey==='DENIED') {
    if(!calls.includes(readName))return tool(readName,readArgs);
    if(journey==='DENIED'){assert(!delivered.some(item=>item.sourceId),'Denied note delivered evidence');return finish('Synthetic denied read; no note facts delivered.');}
    return sourceAnswer();
  }
  if(journey==='CONTEXT') {
    const context=history.slice(0,last+1).flatMap(item=>embeddedObjects(textOf(item)));
    const selector=context.find(value=>value.selectionRead?.cursor)?.selectionRead
      ??context.find(value=>value.kind==='selected_excerpt'&&value.read?.cursor)?.read;
    assert(selector,'Selected canonical context omitted');
    if(!calls.includes('read_notes'))return tool('read_notes',{...(lane==='old'?{purpose:'answer'}:{}),cursor:selector.cursor});
    return sourceAnswer();
  }
  if(journey==='HISTORY') {
    if(!calls.includes('find_notes'))return tool('find_notes',{query:'orchard',mode:'literal',note_ids:[noteId],include_history:true,
      activity_range:{start:'2020-01-01T00:00:00Z',end:'2100-01-01T00:00:00Z',timezone:'UTC'}});
    if(!calls.includes('read_notes')) {
      const historical=delivered.find(value=>typeof value.evidenceId==='string'&&(value.historical||value.sourceKind==='retained_note_change'));
      assert(historical,'Retained discovery item absent');
      return tool('read_notes',{...(lane==='old'?{purpose:'answer'}:{}),evidence_ids:[historical.evidenceId]});
    }
    return sourceAnswer();
  }
  if(journey==='CREATE') {
    const name=lane==='old'?'propose_note_change':'propose_note';
    if(!calls.includes(name))return tool(name,{...(lane==='old'?{operation:'create'}:{}),title:'Paired orchard plan',markdown:'Synthetic proposal body for editable review.'});
    return finish('Synthetic proposal staged for human review.');
  }
  if(journey==='HELLO')return finish(PARITY_ANSWER);
  throw new Error('Unsupported synthetic journey');
}

export async function startParityFixture(port=1443) {
  let lane='old';const requests=[];
  const server=createServer(async(req,res)=>{
    let record;
    try {
      assert(req.headers.authorization===undefined||req.headers.authorization===DUMMY_AUTHORIZATION,'Unexpected fixture credentials');
      if(req.method==='GET') {
        assert(req.url?.includes('models'),'Unknown metadata route');res.writeHead(200,{'content-type':'application/json'});
        return res.end(JSON.stringify({object:'list',data:[{id:'pi-native-fixture',object:'model',type:'llm',max_context_length:32768}]}));
      }
      assert(req.method==='POST','Unknown fixture method');
      assert(requests.filter(record=>record.lane===lane).length<128,'Bounded parity dispatch budget exceeded');
      const protocol=req.url==='/local/v1/chat/completions'?'compatible':req.url==='/openai/v1/responses'?'responses':null;
      assert(protocol,'Unknown fixture route');
      let raw='';for await(const chunk of req){raw+=chunk;assert(Buffer.byteLength(raw)<=524288,'Oversize fixture request');}
      const body=JSON.parse(raw),reply=planParityReply(body,lane,protocol,req.headers.authorization);
      record={lane,protocol,journey:reply.journey,tool:reply.tool?.name??null,index:requests.length,completed:false};requests.push(record);
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const send=async value=>{res.write(`data: ${JSON.stringify(value)}\n\n`);await delay(10);};
      const id=`parity_${record.index}`;
      if(protocol==='compatible') {
        const chunk=(delta,finish_reason=null)=>({id,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]});
        await send(chunk({role:'assistant'}));
        await send(chunk(reply.tool?{tool_calls:[{index:0,id,type:'function',function:reply.tool}]}:{content:reply.text}));
        await send({...chunk({},reply.tool?'tool_calls':'stop'),usage:{prompt_tokens:8,completion_tokens:8,total_tokens:16}});
        record.completed=true;res.end('data: [DONE]\n\n');
      } else {
        const item=reply.tool?{type:'function_call',id,call_id:id,name:reply.tool.name,arguments:''}:{type:'message',id,role:'assistant',status:'in_progress',content:[]};
        await send({type:'response.created',response:{id}});await send({type:'response.output_item.added',output_index:0,item});
        await send(reply.tool?{type:'response.function_call_arguments.delta',output_index:0,delta:reply.tool.arguments}:{type:'response.output_text.delta',output_index:0,content_index:0,delta:reply.text});
        const done=reply.tool?{...item,arguments:reply.tool.arguments,status:'completed'}:{...item,status:'completed',content:[{type:'output_text',text:reply.text,annotations:[]}]};
        await send({type:'response.output_item.done',output_index:0,item:done});
        await send({type:'response.completed',response:{id,status:'completed',output:[done],usage:{input_tokens:8,output_tokens:8,total_tokens:16}}});record.completed=true;res.end();
      }
    } catch(error) {
      requests.push({lane,failed:true,error:String(error).slice(0,300)});if(!res.headersSent)res.writeHead(500);res.end('Synthetic fixture refused');
    }
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  return{requests,setLane(value){assert(['old','pi'].includes(value));lane=value;},close:()=>new Promise(ok=>{server.close(ok);server.closeAllConnections();})};
}
