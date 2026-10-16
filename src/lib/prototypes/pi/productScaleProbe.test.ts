import {describe,it,expect} from 'vitest';
import type {ChatApi} from '$lib/features/chat/api';
import type {ChatConversation} from '$lib/features/chat/types';
import {productScaleTitle,productScaleInput,productScaleReply,verifyProductScale,seedProductScale} from './productScaleProbe';

function fixture(count=1005,turns=1005){
  const ids=Array.from({length:count},(_,index)=>`opaque-${count-index}`);
  const messages=Array.from({length:turns},(_,index)=>[
    {id:`u${index}`,role:'user',content:productScaleInput(index),status:'completed'},
    {id:`a${index}`,role:'assistant',content:productScaleReply(index),status:'completed'}]).flat();
  const rows=ids.map((id,index)=>({id,title:productScaleTitle(index),messageCount:index===0?messages.length:0,messages:index===0?messages:[],activeRequestId:null} as unknown as ChatConversation));
  const api={listConversations:async()=>rows.toReversed(),getConversation:async(id:string)=>rows.find(row=>row.id===id)!} as unknown as ChatApi;
  return {api,rows,identity:{conversations:ids,messages:messages.map(row=>row.id),submissions:turns}};
}
describe('product scale acceptance assertions (mock public API, not native acceptance)',()=>{
  it('checks >1000 identities and full history without relying on list order',async()=>{
    const {api,identity}=fixture();expect(await verifyProductScale(api,identity)).toMatchObject({conversations:1005,messages:2010,allHistoryPositionsVerified:true,productParity:false});
  });
  it('rejects middle Meta loss and message identity substitution despite correct totals',async()=>{
    const first=fixture();first.rows[502].title='incorrect';await expect(verifyProductScale(first.api,first.identity)).rejects.toThrow('Meta');
    const second=fixture();second.rows[0].messages[1004].id='substituted';await expect(verifyProductScale(second.api,second.identity)).rejects.toThrow('identity changed');
  });
  it('rejects a missing interior message even if the last reply remains present',async()=>{
    const {api,identity,rows}=fixture();rows[0].messages.splice(500,1);await expect(verifyProductScale(api,identity)).rejects.toThrow('count');
  });
  it('handles terminal-before-receipt race and detaches all probe listeners',async()=>{
    const {rows}=fixture(0,0),handlers=new Map<string,(event:{requestId:string})=>void>();let serial=0;
    const api={listConversations:async()=>rows,getConversation:async(id:string)=>rows.find(row=>row.id===id)!,
      createConversation:async(input:{title:string})=>{const row={id:`c${rows.length}`,title:input.title,messageCount:0,messages:[],activeRequestId:null} as unknown as ChatConversation;rows.push(row);return row},
      on:async(event:string,handler:(event:{requestId:string})=>void)=>{handlers.set(event,handler);return()=>handlers.delete(event)},
      sendMessage:async()=>{const index=serial++,chat=rows[0],requestId=`r${index}`;
        const user={id:`u${index}`,role:'user',status:'completed',content:productScaleInput(index)} as ChatConversation['messages'][number];
        const assistant={id:`a${index}`,role:'assistant',status:'completed',content:productScaleReply(index)} as ChatConversation['messages'][number];
        chat.messages.push(user,assistant);chat.messageCount+=2;handlers.get('chat://completed')!({requestId});return {requestId,userMessage:user,assistantMessage:assistant};}} as unknown as ChatApi;
    expect(await seedProductScale(api,3,5)).toMatchObject({probeListenersAfter:0,verified:{messages:10}});expect(handlers.size).toBe(0);
    await expect(seedProductScale(api,3,5)).rejects.toThrow('fresh empty');
  });
});
