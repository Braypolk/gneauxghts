import {expect,it,vi} from 'vitest';
import type {ChatApi} from '$lib/features/chat/api';
import {createPiChatApi,readPiChatResourceSnapshot} from './chatApi';

const config=vi.hoisted(()=>({fixture:true,calls:[] as string[]}));
vi.mock('@tauri-apps/api/core',()=>({invoke:async(command:string)=>{
  config.calls.push(command);if(command==='pi_probe_config')return {fixture:config.fixture};
  throw new Error(`Unexpected native operation ${command}`);
}}));
vi.mock('@tauri-apps/api/event',()=>({listen:async()=>{throw new Error('Snapshot must not attach native listeners');}}));

it('counts actual app callbacks and owner disposal without opening storage or attaching native listeners',async()=>{
  const before=await readPiChatResourceSnapshot();
  const api=createPiChatApi({} as ChatApi) as ChatApi & {prototypeClose():Promise<void>};
  try{
    const first=await api.on('chat://completed',()=>{}),second=await api.on('chat://completed',()=>{});
    const third=await api.on('chat://failed',()=>{});
    const attached=await readPiChatResourceSnapshot();
    expect(attached.liveApiOwners).toBe(before.liveApiOwners+1);
    expect(attached.owners.at(-1)).toMatchObject({listeners:3,listenerEventSets:2,enginePresent:false,eventStreams:0,evidenceWatches:0});
    first();first();second();third();
    expect((await readPiChatResourceSnapshot()).owners.at(-1)).toMatchObject({listeners:0,listenerEventSets:0,listenerEventKeys:2});
    expect(config.calls.every(command=>command==='pi_probe_config')).toBe(true);
  }finally{await api.prototypeClose();}
  expect(await readPiChatResourceSnapshot()).toEqual(before);
});

it('refuses ordinary app access instead of opening its engine',async()=>{
  config.fixture=false;
  try{await expect(readPiChatResourceSnapshot()).rejects.toThrow('Synthetic fixture required');}
  finally{config.fixture=true;}
});
