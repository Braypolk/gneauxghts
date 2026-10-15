// Disposable acceptance driver. It operates the actual chat and retained editor
// UI; no replacement HTML or editor is mounted for the experiment.
import {invoke} from '@tauri-apps/api/core';
import {EditorView} from '@codemirror/view';
import {chatApi} from '$lib/features/chat/api';
import type {ChatApi} from '$lib/features/chat/api';
type ProbeApi=ChatApi & {prototypeState:()=>Promise<{conversationId:string;keepId:string;discardId:string;uiBody:string;uiTitle:string}>;prototypeCheckpoint:(value:unknown)=>Promise<void>};
const api=chatApi as ProbeApi;
const until=async<T>(read:()=>T|Promise<T>,description:string):Promise<NonNullable<T>>=>{const deadline=Date.now()+25000;while(Date.now()<deadline){const value=await read();if(value)return value as NonNullable<T>;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(`UI deadline: ${description}`);};
const button=(label:string,root:ParentNode=document)=>Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label && !b.disabled);
const click=async(selector:string)=>{const element=await until(()=>{const value=document.querySelector<HTMLElement>(selector);return value && !('disabled' in value && value.disabled) ? value : undefined;},selector);element.click();};
const review=async(id:string)=>{
  const draft=await api.getProposalDraft!(id);
  const matchingEditor=()=>{
    const title=Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).some(e=>e.value===draft.title);
    if(!title)return undefined;
    for(const element of document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-editor')){const view=EditorView.findFromDOM(element);if(view?.state.doc.toString()===draft.markdown && button('Keep',element))return view;}
    return undefined;
  };
  if(!matchingEditor()) {
    if(!document.querySelector('[aria-label="Thought partner chat"]'))await click('button[aria-label="Open thought partner"]');
    const card=await until(()=>document.querySelector(`section[data-proposal-id="${id}"]`),'pending proposal card');
    const open=await until(()=>button('Review in editor',card),'Review in editor');open.click();
  }
  return until(matchingEditor,'actual target review in CodeMirror');
};
const reviewActions=async(id:string)=>{
  if(!document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${id}"]`))await click('button[aria-label="Open thought partner"]');
  return until(()=>document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${id}"]`),'review action strip in chat');
};

export async function runUiProbe(){
  if(!(await invoke<{fixture:boolean;uiGate:boolean}>('pi_probe_config')).uiGate)return;
  const report:Record<string,unknown>={phase:new URL(location.href).searchParams.get('piUiTest'),checks:[]};
  const checks=report.checks as string[];
  try {
    await until(()=>document.querySelector('[data-testid="workspace-pane"]'),'real workspace');
    if(!document.querySelector('[aria-label="Thought partner chat"]'))await click('button[aria-label="Open thought partner"]');
    await until(()=>document.querySelector('[aria-label="Thought partner chat"]'),'real chat panel');
    const state=await api.prototypeState();
    await click('button[aria-label="Conversations"]');
    const item=await until(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(e=>e.textContent?.trim()==='Pi UI gate'),'Pi conversation picker');item.click();
    await until(()=>document.querySelector('[aria-label="Assistant response"]')?.textContent?.includes('Synthetic native answer'),'Pi-owned message in real chat');checks.push('Pi-owned transcript mounted in existing chat UI');
    let view=await review(state.keepId);checks.push('durable proposal mounted in actual retained CodeMirror review');
    if(report.phase==='first') {
      const body='Actual editor checkpoint retained through process restart.';
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:body},userEvent:'input.type'});
      const title=await until(()=>Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="note-title"]')).find(e=>!e.readOnly),'editable proposal title');
      title.focus();await new Promise(resolve=>setTimeout(resolve,50));title.value='UI edited Pi title';title.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'UI edited Pi title'}));await new Promise(resolve=>setTimeout(resolve,50));title.blur();
      const saved=await until(async()=>{const draft=await api.getProposalDraft!(state.keepId);return draft.markdown===body && draft.title==='UI edited Pi title' ? draft : undefined;},'acknowledged live editor/title checkpoint');
      await api.prototypeCheckpoint({uiBody:body,uiTitle:saved.title,uiCheckpointVersion:saved.version});
      await review(state.discardId);view=await review(state.keepId);
      if(view.state.doc.toString()!==body)throw new Error('Switch lost live review edits');checks.push('actual editor/title checkpoint and review switch retention');
      report.draft=saved;
    } else {
      const restored=await api.getProposalDraft!(state.keepId);
      if(view.state.doc.toString()!==state.uiBody || restored.title!==state.uiTitle)throw new Error('Relaunch UI restored the wrong draft');
      const keepActions=await reviewActions(state.keepId);
      const keep=await until(()=>button('Keep All',keepActions) ?? button('Keep Remaining',keepActions),'Keep reviewed changes');keep.click();
      await until(async()=>!(await api.listPendingProposals(state.conversationId)).some(p=>p.id===state.keepId),'native Keep settled');
      const duplicate=await api.commitAgentProposal(state.keepId,restored.markdown,restored.version);
      if(duplicate.status!=='committed' || duplicate.committedMarkdown!==state.uiBody)throw new Error('Keep receipt differs from reviewed editor bytes');
      await review(state.discardId);const discardActions=await reviewActions(state.discardId);const discard=await until(()=>button('Discard',discardActions),'Discard reviewed creation');discard.click();
      await until(async()=>!(await api.listPendingProposals(state.conversationId)).some(p=>p.id===state.discardId),'Discard settled');
      checks.push('relaunch actual review restored edited text/title; UI Keep and Discard settled');
      report.receipt=duplicate;await api.prototypeCheckpoint({phase:'settled'});
    }
    report.status='passed';
  } catch(error){report.status='failed';report.error=String(error);report.body=document.body.innerText.slice(0,7000);}
  await invoke('pi_ui_report',{report});
}
