import type {AgentEvent} from '@earendil-works/pi-durable';
import type {AssistantMessage} from '@earendil-works/pi-ai';

type TextUpdate={type:'delta';delta:string}|{type:'draft';attempt:1;sequence:number;content:string};

/** One active request's sanitized Pi partial. Replacements cannot be appended
 * to existing UI text, so once one occurs all further updates use snapshots. */
export function createTextProjection():(event:AgentEvent)=>TextUpdate|undefined {
  const blocks=new Map<number,string>();
  let displayed='',draft=false,sequence=0;
  const replace=(message:AssistantMessage)=>{
    blocks.clear();message.content.forEach((block,index)=>{if(block.type==='text')blocks.set(index,block.text);});
  };
  return event=>{
    if(event.type==='message_start'&&event.message.role==='assistant')replace(event.message);
    else if(event.type==='snapshot'&&event.generation?.message)replace(event.generation.message);
    else if(event.type==='message_update')for(const change of event.changes) {
      if(change.type==='message')replace(change.message);
      else if(change.type==='text_delta')blocks.set(change.contentIndex,(blocks.get(change.contentIndex)??'')+change.delta);
      else if('block' in change) {
        if(change.block.type==='text')blocks.set(change.contentIndex,change.block.text);
        else blocks.delete(change.contentIndex);
      }
    } else return;
    const content=[...blocks].sort(([left],[right])=>left-right).map(([,text])=>text).join('');
    if(content===displayed)return;
    const previous=displayed;displayed=content;
    if(!draft&&content.startsWith(previous))return {type:'delta',delta:content.slice(previous.length)};
    draft=true;return {type:'draft',attempt:1,sequence:++sequence,content};
  };
}
