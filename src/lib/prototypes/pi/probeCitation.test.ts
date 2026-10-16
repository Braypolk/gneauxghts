import {describe,it,expect,vi} from 'vitest';
import {observeStaleProbeCitation} from './probeCitation';
import {renderChatMarkdown} from '$lib/features/chat/ui/chatMarkdown';

describe('stale citation fixture navigation',()=>{
  it('reacquires the exact connected message after native editing replaces its DOM',async()=>{
    let connected=true,error:string|undefined,changed=false;
    // The delegated click reaches the normal navigation handler only while its
    // node is attached. Native editing replaces this message during the await.
    const staleClick=vi.fn(()=>{if(connected)error='Source unavailable';});
    const currentClick=vi.fn(()=>{error='Passage changed before navigation';});
    const stale={get isConnected(){return connected;},click:staleClick};
    const current={isConnected:true,click:currentClick};
    const oldMessage={querySelector:()=>stale,querySelectorAll:()=>[]},newMessage={querySelector:()=>current,querySelectorAll:()=>[]};
    const query=vi.fn((selector:string)=>selector==='[data-chat-message-id="answer-42"]'?(changed?newMessage:oldMessage):undefined);
    const root={querySelector:query,querySelectorAll:()=>error?[{textContent:error}]:[]} as unknown as ParentNode;
    const until=async<V>(read:()=>V|Promise<V>,label:string):Promise<NonNullable<V>>=>{
      for(let poll=0;poll<3;poll++){const value=await read();if(value)return value as NonNullable<V>;}
      throw new Error(`deadline: ${label}`);
    };
    await expect(observeStaleProbeCitation({messageId:'answer-42',root,until,change:async()=>{connected=false;changed=true;}})).resolves.toEqual({mode:'navigation-error',message:'Passage changed before navigation'});
    expect(staleClick).not.toHaveBeenCalled();expect(currentClick).toHaveBeenCalledOnce();
    expect(query.mock.calls.every(([selector])=>selector==='[data-chat-message-id="answer-42"]')).toBe(true);
  });
  it('waits for a connected control and requires the visible stale-source error',async()=>{
    let connected=false,error:string|undefined;
    const click=vi.fn(()=>{error='Source unavailable';});
    const citation={get isConnected(){return connected;},click};
    const root={querySelector:()=>({querySelector:()=>citation,querySelectorAll:()=>[]}),querySelectorAll:()=>error?[{textContent:error}]:[]} as unknown as ParentNode;
    const until=async<V>(read:()=>V|Promise<V>,label:string):Promise<NonNullable<V>>=>{
      for(let poll=0;poll<3;poll++){
        const value=await read();if(value)return value as NonNullable<V>;
        expect(click).not.toHaveBeenCalled();connected=true;
      }
      throw new Error(`deadline: ${label}`);
    };
    expect(await observeStaleProbeCitation({messageId:'answer-42',root,until,change:async()=>undefined})).toEqual({mode:'navigation-error',message:'Source unavailable'});
    expect(click).toHaveBeenCalledOnce();
  });
  it('recognizes the actual renderer explicit unavailable marker only with API withholding proof',async()=>{
    const html=renderChatMarkdown('Evidence. [Source 1](passage:issued-passage)',[]);
    expect(html).toContain('<span data-chat-selection-ignore>[citation unavailable]</span>');
    expect(html).not.toContain('data-chat-note-citation-id');
    const marker={textContent:'[citation unavailable]',isConnected:true};
    const message={querySelector:()=>undefined,querySelectorAll:(selector:string)=>selector==='span[data-chat-selection-ignore]'?[marker]:[]};
    const root={querySelector:()=>message,querySelectorAll:()=>[]} as unknown as ParentNode;
    const until=async<V>(read:()=>V|Promise<V>):Promise<NonNullable<V>>=>{const value=await read();if(value)return value as NonNullable<V>;throw new Error('deadline');};
    const unavailable=vi.fn(async()=>true);
    expect(await observeStaleProbeCitation({messageId:'answer-42',root,until,change:async()=>undefined,unavailable})).toEqual({mode:'withheld-source',message:'[citation unavailable]'});
    expect(unavailable).toHaveBeenCalledOnce();
    unavailable.mockResolvedValue(false);
    await expect(observeStaleProbeCitation({messageId:'answer-42',root,until,change:async()=>undefined,unavailable})).rejects.toThrow('API withholding proof');
    message.querySelectorAll=()=>[];
    await expect(observeStaleProbeCitation({messageId:'answer-42',root,until,change:async()=>undefined,unavailable})).rejects.toThrow('deadline');
  });
});
