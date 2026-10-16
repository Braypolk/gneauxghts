import { describe, expect, it, vi } from 'vitest';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { MemoryStorage } from '@earendil-works/pi-durable/storage/memory';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
vi.mock('./chatApi',()=>({closePiChatApis:vi.fn()}));
import { seedScale } from './scaleProbe';

async function setup(){const storage=new MemoryStorage(),models=createModels(),faux=fauxProvider();models.setProvider(faux.provider);
  const harness=await Harness.open(storage,{models,registry:createRegistry(),settings:{retry:{enabled:false,maxRetries:0},compaction:{enabled:false}}},context);
  return {storage,harness,faux};}
describe('native scale seeder preparation',()=>{
  it('admits real Harness turns and refuses to overwrite existing conversations',async()=>{
    const {storage,harness,faux}=await setup();
    try{
      const result=await seedScale(harness,storage,reply=>faux.setResponses([fauxAssistantMessage(reply)]),3,5);
      expect(result).toMatchObject({conversations:3,submissions:5,messages:10,earlyMiddleLateVerified:true,productParity:false});
      expect(faux.state.callCount).toBe(5);
      await expect(seedScale(harness,storage,()=>{},3,5)).rejects.toThrow('fresh empty');
    }finally{await harness.close(context);}
  });
  it('creates and reads more than 1000 real engine conversations without native SQL',async()=>{
    const {storage,harness,faux}=await setup();
    try{
      const result=await seedScale(harness,storage,reply=>faux.setResponses([fauxAssistantMessage(reply)]),1005,3);
      expect(result).toMatchObject({conversations:1005,submissions:3,messages:6,earlyMiddleLateVerified:true});
      expect(faux.state.callCount).toBe(3);
    }finally{await harness.close(context);}
  },30000);
});
