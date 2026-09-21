import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { browser, $ } from '@wdio/globals';
type Note = {noteId:string;path:string;title:string};
type Event = {type:string;status?:string;name?:string;details?:Record<string,unknown>;aggregate?:Record<string,number>};
type Message = {id:string;role:string;status:string;content:string;error?:string;sources:{title:string;kind:string;noteId?:string;url?:string;anchor?:string;passage?:{id:string}}[];agentEvents:{event:Event}[]};
type Conversation = {id:string;messages:Message[]};
async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync(
    (command: string, args: Record<string, unknown>, done: (value: { ok: boolean; value?: unknown; error?: string }) => void) => {
      const native = window as typeof window & {
        __TAURI_INTERNALS__?: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      };
      if (!native.__TAURI_INTERNALS__) return done({ ok: false, error: 'Real native IPC is required' });
      void native.__TAURI_INTERNALS__.invoke(command, args).then(
        value => done({ ok: true, value }), error => done({ ok: false, error: String(error) })
      );
    }, command, args
  );
  if (!result.ok) throw new Error(result.error);
  return result.value as T;
}


const live = process.env.GNEAUX_QUERY_NATIVE === '1' ? describe : describe.skip;
const smoke = process.env.GNEAUX_QUERY_SMOKE === '1';
const budget = process.env.GNEAUX_INVENTORY_BUDGET === '1';
const contextMeasurement = process.env.GNEAUX_CONTEXT_NATIVE === '1';
const regression = process.env.GNEAUX_QUERY_REGRESSION === '1';
const baseline = process.env.GNEAUX_QUERY_BASELINE === '1';
const fixture = JSON.parse(readFileSync(resolve('e2e/fixtures/query-inventory.json'),'utf8')) as {
 notes:{title:string;body:string}[]; holdout:{id:string;question:string;expected:string;mode:string}[];
};
live('Shared queries and application-owned inventory', function() {
 this.timeout(360_000);
 const endpoint=process.env.GNEAUX_LIVE_ENDPOINT!;
 const model=process.env.GNEAUX_LIVE_MODEL!;
 const output=process.env.GNEAUX_LIVE_OUTPUT!;
 const results:Record<string,unknown>[]=[];
 const notes:Note[]=[];
 let excluded:Note;
 function persist() {mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify({endpoint,model,smoke,regression,baseline,notes,results},null,2));}
 async function save(title:string,markdown:string) {
  const note=await invoke<Note>('save_note',{title,markdown,currentPath:null});
  assert(note.path.includes('gneauxghts-native-e2e-'));
  await invoke('finalize_note_editing_window',{noteId:note.noteId});
  await invoke('e2e_flush_vault_watcher_path',{path:note.path}); return note;
 }
 before(async()=>{
  assert(endpoint&&model&&output);
  await $('[data-testid="note-title"]').waitForExist({timeout:30_000});
  const settings=await invoke<Record<string,unknown>>('chat_get_settings');
  await invoke('chat_set_settings',{settings:{...settings,provider:'local',model,localModel:model,localBaseUrl:endpoint,defaultAccess:'approved',webAccess:'off',reasoningEffort:'medium'}});
  await invoke('chat_set_local_model_capabilities',{model,capabilities:{tools:true,images:false,audio:false,video:false,reasoningEffort:'medium'}});
  const semantic=await invoke<Record<string,unknown>>('get_semantic_settings');
  await invoke('set_semantic_settings',{settings:{...semantic,semanticSearchEnabled:false}});
  for(const n of fixture.notes){const note=await save(n.title,n.body);notes.push(note);await invoke('chat_grant_note',{noteId:note.noteId});}
  if(budget) for(let i=0;i<5;i++) {
   const note=await save(`Additional inventory ${i}`, `Background context for note ${i}. ` .repeat(80));
   notes.push(note); await invoke('chat_grant_note',{noteId:note.noteId});
  }
  excluded=await save('Meridian excluded','CANARY_QUERY_729: a secret Meridian meeting happened September 10, 2025.');
  await invoke('chat_set_note_excluded',{noteId:excluded.noteId,title:excluded.title,excluded:true});
  await invoke('mark_note_opened',{noteId:notes[3].noteId});
  await browser.refresh();await $('[data-testid="note-title"]').waitForExist({timeout:30_000});persist();
 });
 const cases=contextMeasurement?[
  {id:'inventory_current',question:'Which notes did I edit today?',expected:'One model call, full assembled context diagnostics and persisted reload',mode:'normal'},
  {id:'dense_evidence',question:'Read the evidence and summarize the Meridian events, commitments, and export decision. Cite each source. Distinguish canceled and planned events from completed ones.',expected:'Search and read results appear in later measured model requests',mode:'normal'},
  {id:'empty_research_scope',question:'Call research_notes exactly once with note_ids: [] and question: "Which notes match this intentionally empty selection?". The empty list is intentional. Do not broaden the scope. Report that no evidence is available.',expected:'Empty scope returns without starting worker inference',mode:'normal'},
  {id:'research_measurement',question:'Use research_notes once to investigate across the Meridian notes: which commitments and proposed changes remain unresolved, and what evidence is missing? Cite the evidence and identify gaps.',expected:'Worker measurements remain distinct from parent calls without exposing worker prose',mode:'normal'}
 ]:budget?[
  {id:'inventory_current',question:'Which notes did I edit today?',expected:'All nine allowed notes once, complete, one model call',mode:'normal'},
  {id:'inventory_sources',question:'Which notes did I edit today?',expected:'All nine allowed notes once, complete, one model call',mode:'sources'}
 ]:regression?fixture.holdout.filter(c=>c.id.startsWith('inventory_')):baseline?fixture.holdout.filter(c=>!c.id.startsWith('inventory_')):smoke?[{id:'smoke',question:'Which notes did I edit today?',expected:'All allowed current fixture notes, app-owned result, one model call',mode:'sources'}]:fixture.holdout;
 const selectedCases=cases.filter(c=>!process.env.GNEAUX_QUERY_CASE||c.id===process.env.GNEAUX_QUERY_CASE);
 assert(selectedCases.length>0,'Scenario filter matched no cases');
 const repetitions=Number(process.env.GNEAUX_QUERY_REPETITIONS||(smoke||baseline||budget||contextMeasurement?'1':'2'));
 assert(Number.isInteger(repetitions)&&repetitions>=1&&repetitions<=3);
 for(let repetition=0;repetition<repetitions;repetition++)for(const scenario of selectedCases){
  it(`${scenario.id} repetition ${repetition+1}`,async()=>{
   const content=(scenario.mode==='sources'?'/sources ':'')+scenario.question;
   let conversation:Conversation;
   const start=Date.now();
   if(smoke || (scenario.id==='inventory_current' && repetition===0)){
    const open=await $('button[aria-label="Open thought partner in this pane"]');await open.waitForExist();await browser.execute((el:HTMLElement)=>el.click(),open);
    const composer=await $('[data-testid="workspace-pane"][data-pane-kind="chat"] textarea');await composer.waitForEnabled({timeout:30_000});await composer.setValue(content);await $('button[aria-label="Send message"]').click();
    let found:Conversation|undefined;
    await browser.waitUntil(async()=>{for(const s of await invoke<{id:string}[]>('chat_list_conversations')){const c=await invoke<Conversation>('chat_get_conversation',{conversationId:s.id});if(c.messages.some(m=>m.role==='user'&&m.content===content)){found=c;return true;}}return false;},{timeout:30_000,interval:500});assert(found);conversation=found;
   }else{
    conversation=await invoke<Conversation>('chat_create_conversation',{request:{title:`Query ${scenario.id}`,provider:'local',model,access:'approved',reasoningEffort:'medium'}});
    await invoke('chat_send_message',{request:{conversationId:conversation.id,content,activeNote:null,attachments:[],selectedContext:[],forceWebSearch:false}});
   }
   let answer:Message|undefined;
   await browser.waitUntil(async()=>{const c=await invoke<Conversation>('chat_get_conversation',{conversationId:conversation.id});answer=c.messages.find(m=>m.role==='assistant');if(scenario.mode==='sources'&&answer?.status==='streaming')assert.equal(answer.content,'');return Boolean(answer&&['complete','failed','cancelled'].includes(answer.status));},{timeout:300_000,interval:1000});assert(answer);
   const links=[...new Set([...answer.content.matchAll(/passage:([^\s)\]]+)/g)].map(m=>m[1]))];
   const resolutions:Record<string,unknown>[]=[];
   for(const evidenceId of links){try{const r=await invoke<{source:{title:string};selection:unknown}>('chat_resolve_passage',{conversationId:conversation.id,evidenceId});resolutions.push({evidenceId,status:'resolved',...r});}catch(error){resolutions.push({evidenceId,status:'failed',error:String(error)});}}
   const events=answer.agentEvents.map(e=>e.event);
   results.push({id:scenario.id,repetition,question:content,expected:scenario.expected,status:answer.status,error:answer.error,answer:answer.content,latencyMillis:Date.now()-start,events,sources:answer.sources,resolutions});persist();
   assert.equal(answer.status,'complete',answer.error);
   if(contextMeasurement) {
    const measurements=events.filter(e=>e.type==='contextMeasured').map(e=>e.details!);
    assert(measurements.length>=2);
    const requests=measurements.filter(m=>m.phase==='request');
    const usages=measurements.filter(m=>m.phase==='usage');
    const terminals=measurements.filter(m=>m.phase==='usage'||m.phase==='unreported');
    assert.equal(requests.length,terminals.length);
    for(const r of requests) assert.equal(terminals.filter(t=>t.runtimeInstance===r.runtimeInstance&&t.attempt===r.attempt).length,1);
    for(const m of usages) {
     assert(requests.some(r=>r.runtimeInstance===m.runtimeInstance&&r.attempt===m.attempt));
     assert.equal(m.enforcementEligible,false);
     assert((m.reportedUsage as {inputTokens:number}).inputTokens>0);
    }
    if(scenario.id==='research_measurement') {
     assert(measurements.some(m=>m.worker===true),'Research worker must be measured');
     const diagnostics=events.filter(e=>e.type==='researchCompleted').map(e=>e.details!);
     assert.equal(diagnostics.length,1);
     assert.equal(diagnostics[0].reason,'validated',JSON.stringify(diagnostics));
     assert(Number(diagnostics[0].deliveredPassages)>0,'Known-match fixture must receive research evidence');
    }
    if(scenario.id==='empty_research_scope') {
     const d=events.filter(e=>e.type==='researchCompleted').map(e=>e.details!);
     assert.equal(d.length,1); assert.equal(d[0].reason,'empty_scope');
     assert.equal(d[0].deliveredPassages,0); assert.equal(requests.filter(m=>m.worker===true).length,0);
    }
    if(scenario.id==='dense_evidence') assert(requests.some(m=>((m.componentBytes as Record<string,number>).toolResults||0)>0),'Measure returned tool evidence');
   }
   assert(!answer.content.includes('CANARY_QUERY_729'));
   assert(resolutions.every(r=>r.status==='resolved'));
   if(smoke || (scenario.id==='inventory_current' && repetition===0)){
    const evidenceId=links[0]; assert(evidenceId);
    const index=answer.sources.findIndex(s=>s.passage?.id===evidenceId);assert(index>=0);
    const source=answer.sources[index];const citationId=`${source.kind}:${source.noteId??source.url??source.title}:${source.anchor??index}`;
    const citation=await $(`[data-chat-note-citation-id=${JSON.stringify(citationId)}]`);await citation.waitForExist({timeout:15000});
    const resolved=await invoke<{markdown:string;selection:{anchor:number;head:number}}>('chat_resolve_passage',{conversationId:conversation.id,evidenceId});assert(resolved.selection);
    await browser.execute((el:HTMLElement)=>el.scrollIntoView({block:'center'}),citation);
    await browser.saveScreenshot(resolve(output+'.png'));
    await browser.execute((el:HTMLElement)=>el.click(),citation);
    await browser.waitUntil(async()=>browser.execute((noteId,selection)=>{
     const state=(window as typeof window & {__GNEAUXGHTS_NATIVE_E2E__?:{readEditorState:()=>{noteId?:string;editor?:{selection:{anchor:number;head:number}}}}}).__GNEAUXGHTS_NATIVE_E2E__?.readEditorState();
     return Boolean(state && state.noteId===noteId&&state.editor?.selection.anchor===selection.anchor&&state.editor?.selection.head===selection.head);
    },source.noteId,resolved.selection),{timeout:15000});
   }
   if(smoke||scenario.id.startsWith('inventory_')){
    assert(answer.content.startsWith('**Notes with recorded editing activity**'));
    assert.equal(events.filter(e=>e.type==='usageUpdated').length,1,'Inventory must not require a final model call');
    const trace=events.filter(e=>e.type==='queryResolved').at(-1)?.details as {resolved?:{intent:{subject?:string|null};periods:{after:number;before:number}[]};inventory?:{notesReturned:number}}|undefined;
    assert(trace?.resolved);assert(!trace.resolved.intent.subject);
    assert.equal(trace.inventory?.notesReturned,scenario.id==='inventory_prior'?0:budget?9:4);
    if(budget) {
     assert.equal(links.length,9);
     assert.equal((answer.content.match(/passage:/g)||[]).length,9,'One link per note');
     assert(!answer.content.includes('Coverage is partial'));
     assert.equal(answer.sources.filter(s=>s.passage).length,9);
     assert(resolutions.every(r=>r.selection));
    }
    if(scenario.id==='inventory_prior') {
     // Node and the native app share the host timezone. Calendar arithmetic
     // preserves local midnight across DST and keeps this regression date-independent.
     const thisMonday = new Date(start);
     thisMonday.setHours(0,0,0,0);
     thisMonday.setDate(thisMonday.getDate() - (thisMonday.getDay()+6)%7);
     const priorMonday = new Date(thisMonday);
     priorMonday.setDate(priorMonday.getDate()-7);
     assert.deepEqual([trace.resolved.periods[0].after,trace.resolved.periods[0].before],
      [priorMonday.getTime(),thisMonday.getTime()], 'Resolve the prior local calendar week');
    }
    await browser.refresh();await $('[data-testid="workspace-pane"]').waitForExist({timeout:30_000});
    const restored=await invoke<Conversation>('chat_get_conversation',{conversationId:conversation.id});assert.equal(restored.messages.find(m=>m.id===answer!.id)?.content,answer.content);
   }
  });
 }
});
