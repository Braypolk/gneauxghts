import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

// Deliberately synthetic OpenAI Responses and compatible Chat SSE. No keys.
export async function startFixture(port = 1443) {
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization) throw new Error('Fixture must never receive credentials');
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 262144) throw new Error('oversize'); }
      const body = JSON.parse(raw); requests.push({ path: req.url, body });
      const compatible = req.url === '/local/v1/chat/completions';
      if (!compatible && req.url !== '/openai/v1/responses') throw new Error('unexpected route');
      if (compatible) {
        const system = body.messages.filter(m => m.role === 'system');
        if (system.length > 1 || (system.length && body.messages[0].role !== 'system')) throw new Error('single opening system required');
        if (body.messages.some(m => m.role === 'developer')) throw new Error('unsupported developer role');
      }
      const history = compatible ? body.messages : body.input;
      const lastUserIndex = history.findLastIndex(m => m.role === 'user');
      const user = JSON.stringify(history[lastUserIndex] ?? {});
      const tail = history.slice(lastUserIndex + 1);
      const hasTool = tail.some(m => m.role === 'tool' || m.type === 'function_call_output');
      const noteId = user.match(/READ_NOTE:([a-zA-Z0-9_-]+)/)?.[1];
      const updateId=user.match(/PROPOSE_UPDATE:([a-zA-Z0-9_-]+)/)?.[1];
      const tool = !hasTool ? noteId ? {name:'read_note',arguments:JSON.stringify({noteId})} : user.includes('PROPOSE_CREATE') || updateId ? {name:'propose_note',arguments:JSON.stringify({title:'Synthetic model note',markdown:updateId?'Updated synthetic model reviewed body.':'Synthetic model reviewed body.',...(updateId?{noteId:updateId}:{})})} : undefined : undefined;
      const claim = user.includes('Followup') ? 'Synthetic follow-up.' : hasTool ? 'Synthetic source-backed answer.' : 'Synthetic native answer.';
      const text = JSON.stringify({segments:[{text:claim,sources:hasTool && noteId?['S1']:[]}]});
      res.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache'});
      const send = async value => { if (res.destroyed) return; res.write(`data: ${JSON.stringify(value)}\n\n`); await delay(25); };
      if(hasTool && user.includes('DELAY_FINAL')){await delay(1400);if(res.destroyed)return;}
      if (user.includes('SLOW_CANCEL')) { await delay(3000); if (res.destroyed) return; }
      const parts = tool ? [tool.arguments.slice(0,8),tool.arguments.slice(8)] : [text.slice(0,10),text.slice(10)];
      if (compatible) {
        const chunk = delta => ({id:'synthetic',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:null}]});
        await send(chunk({role:'assistant'}));
        if(tool) {
          await send(chunk({tool_calls:[{index:0,id:'call_synthetic',type:'function',function:{name:tool.name,arguments:parts[0]}}]}));
          await send(chunk({tool_calls:[{index:0,function:{arguments:parts[1]}}]}));
        } else for(const part of parts) await send(chunk({content:part}));
        if(user.includes('PARTIAL_FAILURE') || (hasTool && user.includes('FAIL_AFTER_STAGE'))) { res.destroy(); return; }
        await send({id:'synthetic',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:4,completion_tokens:4,total_tokens:8}});
        res.end('data: [DONE]\n\n');
      } else {
        const item = tool ? {type:'function_call',id:'fc_synthetic',call_id:'call_synthetic',name:tool.name,arguments:''}
          : {type:'message',id:'msg_synthetic',role:'assistant',status:'in_progress',content:[]};
        await send({type:'response.created',response:{id:'resp_synthetic'}});
        await send({type:'response.output_item.added',output_index:0,item});
        for(const part of parts) await send(tool ? {type:'response.function_call_arguments.delta',output_index:0,delta:part}
          : {type:'response.output_text.delta',output_index:0,content_index:0,delta:part});
        if(user.includes('PARTIAL_FAILURE') || (hasTool && user.includes('FAIL_AFTER_STAGE'))) { res.destroy(); return; }
        const done = tool ? {...item,arguments:tool.arguments,status:'completed'} : {...item,status:'completed',content:[{type:'output_text',text,annotations:[]}]};
        await send({type:'response.output_item.done',output_index:0,item:done});
        await send({type:'response.completed',response:{id:'resp_synthetic',status:'completed',output:[done],usage:{input_tokens:4,output_tokens:4,total_tokens:8}}});
        res.end();
      }
    } catch(error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  return { server, requests, close: () => new Promise(resolve => server.close(resolve)) };
}
