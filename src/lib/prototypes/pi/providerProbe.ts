// Synthetic native acceptance helpers. Never used by the interactive evaluation.
import { invoke } from '@tauri-apps/api/core';
import { defineDoc, defineExtension, hook, GenerationTask, ProviderDoc, type ConversationId, type Harness } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { admitNativeRequest, releaseNativeRequest, type NativeAdmission, type RequestPolicies } from './nativeProvider';
import { prepareEvidence, stageEvidence } from './notesExtension';

const ProviderSwitchState=defineDoc({kind:'gneauxghts.fixture-provider-switch',version:1,scope:'session',initial:()=>({local:0,openai:0})});
export async function restoreProviderSwitchProbe(harness:Harness,mark:(name:string)=>Promise<void>) {
  const previous=await harness.snapshot(ProviderSwitchState,context);
  for(const provider of ['local','openai'] as const)if(previous?.[provider]) {
    const conversation=await harness.conversation(previous[provider] as ConversationId,context);
    if(!conversation || (await conversation.agent(context)).model?.modelId!=='pi-native-fixture-b')throw new Error('Provider model choice lost after native relaunch');
    if(!(await conversation.context(context)).entries.some(entry=>entry.kind==='pi.assistant'))throw new Error('History lost after native model relaunch');
    await mark(`${provider}: switched model and committed history restored after native relaunch`);
  }
}
export async function rememberProviderSwitchProbe(harness:Harness,provider:'local'|'openai',id:number) {
  await harness.commit(async tx=>{(await tx.doc(ProviderSwitchState))[provider]=id;},context);
}

export function fixtureProviderAdmissions(policies:RequestPolicies) {
  const admissions=new Map<number,NativeAdmission>();
  const extension=defineExtension({name:'gneauxghts.fixture-provider-admissions',hooks:[hook(GenerationTask,{
    beforeRequest:async({messages},api,ctx)=>{
      const provider=await api.snapshot(ProviderDoc,api.conversationId,ctx);
      const policy=provider && policies.get(provider.sessionId);
      const admission=admissions.get(api.conversationId);
      if(policy && admission){policy.admission=admission;policy.structured=true;}
      return {messages};
    }
  })]});
  return {extension,
    admit:async(harness:Harness,id:number,provider:'local'|'openai',model='pi-native-fixture')=>{
      const previous=admissions.get(id);if(previous)await releaseNativeRequest(previous);
      const evidence=await prepareEvidence({},'full');
      await harness.commit(async tx=>{await stageEvidence(tx,id as ConversationId,evidence);},context);
      admissions.set(id,await admitNativeRequest(provider,model,'off','standard'));
    },
    release:async(id:number)=>{const admission=admissions.get(id);admissions.delete(id);if(admission)await releaseNativeRequest(admission);}
  };
}

// Exercises native admission directly without sending inference or inspecting keys.
export async function fixtureAdmissionProbe(mark:(name:string)=>Promise<void>) {
  for(const provider of ['local','openai'] as const) {
    const first=await admitNativeRequest(provider,'pi-native-fixture','off','standard');
    const second=await admitNativeRequest(provider,'pi-native-fixture-b','off','flex');
    if(first.id===second.id || first.model===second.model || first.serviceTier!=='standard' || second.serviceTier!=='flex')throw new Error('Native admission configuration was not frozen');
    let rejected=false;try{await admitNativeRequest(provider,'unknown-fixture-model','off','standard');}catch{rejected=true;}
    if(!rejected)throw new Error('Unknown fixture model admitted');
    await releaseNativeRequest(first);await releaseNativeRequest(second);
    await mark(`${provider}: multiple native model admissions, immutable options and unknown-model rejection`);
  }
  let rejected=false;try{await invoke('pi_admit_provider_request',{provider:'local',model:'pi-native-fixture',reasoningEffort:'unsupported-option',serviceTier:'standard'});}catch{rejected=true;}
  if(!rejected)throw new Error('Unsupported fixture reasoning admitted');
  await mark('native unsupported reasoning option rejects before inference');
}
