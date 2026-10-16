// Serialized into each lane's actual native webview by the paired driver.
// Uses that lane's public ChatApi, retained editor and normal workspace controls.
export function reviewedTitlePlan(currentTitle, requestedTitle, draftTitleEditable) {
  return { reviewedTitle: draftTitleEditable ? requestedTitle : currentTitle, draftTitleEditable,
    titleEditing: draftTitleEditable ? 'editable' : 'readonly-baseline',
    changeTitle: draftTitleEditable && currentTitle !== requestedTitle };
}
/** Observe the mounted review's real final checkpoint/Keep, without issuing an
 * effect or assuming resolved drafts remain readable in every baseline. */
export async function observePublicKeep(api,id,before,perform,wait) {
  const checkpoint=api.checkpointProposalDraft,commit=api.commitAgentProposal;
  const checkpointOwn=Object.getOwnPropertyDescriptor(api,'checkpointProposalDraft');
  const commitOwn=Object.getOwnPropertyDescriptor(api,'commitAgentProposal');
  let acknowledged=structuredClone(before),accepted;
  api.checkpointProposalDraft=async function(...args) {
    const result=await checkpoint.apply(this,args);
    if(args[0]===id)acknowledged=structuredClone(result);
    return result;
  };
  api.commitAgentProposal=async function(...args) {
    const result=await commit.apply(this,args);
    if(args[0]===id)accepted={draft:structuredClone(acknowledged),receipt:structuredClone(result),markdown:args[1],version:args[2]};
    return result;
  };
  try {
    await perform();
    const observed=await wait(()=>accepted,'observed normal UI Keep receipt');
    if(observed.receipt.status!=='committed'||observed.version!==observed.draft.version||observed.markdown!==observed.draft.markdown
      ||observed.receipt.committedMarkdown!==observed.draft.markdown)throw new Error('UI Keep did not commit its exact acknowledged draft');
    for(const key of ['markdown','title','path'])if(observed.draft[key]!==before[key])throw new Error('Keep altered reviewed bytes/destination');
    return {draft:observed.draft,receipt:observed.receipt};
  } finally {
    if(checkpointOwn)Object.defineProperty(api,'checkpointProposalDraft',checkpointOwn);else delete api.checkpointProposalDraft;
    if(commitOwn)Object.defineProperty(api,'commitAgentProposal',commitOwn);else delete api.commitAgentProposal;
  }
}
/** Pi must reject stale versions. The pinned old owner returns its existing
 * receipt before inspecting the duplicate's version; record that difference. */
export async function verifyDuplicateKeep(api,id,draft,lane) {
  if(!['old','pi'].includes(lane))throw new Error('Explicit duplicate comparison lane required');
  let stale,rejected=false;try{stale=await api.commitAgentProposal(id,draft.markdown,draft.version-1);}catch{rejected=true;}
  if(lane==='pi'&&!rejected)throw new Error('Stale duplicate Keep accepted by Pi');
  const first=await api.commitAgentProposal(id,draft.markdown,draft.version),second=await api.commitAgentProposal(id,draft.markdown,draft.version);
  if(first.status!=='committed'||JSON.stringify(first)!==JSON.stringify(second))throw new Error('Duplicate Keep changed receipt');
  if(!rejected&&JSON.stringify(stale)!==JSON.stringify(first))throw new Error('Baseline stale duplicate changed existing receipt');
  if(first.committedMarkdown!==draft.markdown)throw new Error('Receipt differs from accepted body');
  return {id,version:draft.version,...first,staleDuplicate:rejected?'rejected':'accepted-existing-receipt'};
}
export async function parityBrowserAction(action,args={}) {
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const pause=()=>new Promise(ok=>setTimeout(ok,60));
  const until=async(fn,label)=>{
    const end=Date.now()+40000;
    while(Date.now()<end) {
      let timer;const deadline=new Promise((_,fail)=>{timer=setTimeout(()=>fail(new Error(`Deadline: ${label}`)),Math.max(1,end-Date.now()));});
      let value;try{value=await Promise.race([Promise.resolve().then(fn),deadline]);}finally{clearTimeout(timer);}
      if(value)return value;await pause();
    }
    throw new Error(`Deadline: ${label}`);
  };
  const button=(label,root=document)=>Array.from(root.querySelectorAll('button')).find(node=>!node.disabled&&(node.getAttribute('aria-label')===label||node.textContent.trim()===label));
  const click=async(label,root=document)=>{(await until(()=>button(label,root),label)).click();await pause();};
  const input=(node,value)=>{node.focus();node.value=value;node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));};
  if(action==='initialize') {
    check(window.__TAURI_INTERNALS__&&document.querySelector('[data-testid="workspace-pane"]'),'Actual native workspace required');
    const {chatApi:api}=await import('/src/lib/features/chat/api.ts');
    // The old Vite lane serves the raw package with unresolved bare imports.
    // Use its native-E2E optimized module, shared by the mounted editor.
    const {EditorView}=await import('/node_modules/.vite-e2e-native/deps/@codemirror_view.js');
    window.__pairedParity={api,EditorView,state:args.state??{kept:[]},invoke:window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__)};
    const {atlasVisibility,...settings}=await api.getSettings();
    const provider=args.protocol==='responses'?'openai':'local';
    await api.setDefaults({...settings,provider,model:'pi-native-fixture',localModel:'pi-native-fixture',openaiModel:'pi-native-fixture',
      localBaseUrl:'http://127.0.0.1:1443/local/v1',reasoningEffort:'off',defaultVaultAccess:'full'});
    await api.setLocalModelCapabilities('pi-native-fixture',{tools:true,images:false,audio:false,video:false,reasoningEffort:'off'});
    check(['old','pi'].includes(args.lane),'Explicit paired runtime lane required');
    window.__pairedParity.provider=provider;window.__pairedParity.lane=args.lane;return true;
  }
  const {api,EditorView,invoke,state,provider,lane}=window.__pairedParity;
  if(action==='quiesce')return invoke('prepare_restart');
  const openChat=async()=>{
    if(!document.querySelector('[aria-label="Thought partner chat"]'))await click('Open thought partner');
    await until(()=>document.querySelector('[aria-label="Thought partner chat"]'),'normal chat');
  };
  const select=async id=>{
    await openChat();const chat=await api.getConversation(id);
    if(document.querySelector('[aria-label="Chat title"]')?.value!==chat.title) {
      await click('Conversations');
      (await until(()=>Array.from(document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent.trim()===chat.title),'normal conversation picker')).click();
    }
    await until(()=>document.querySelector('[aria-label="Chat title"]')?.value===chat.title,'selected conversation');
  };
  const send=async(id,prompt)=>{
    await select(id);const before=(await api.getConversation(id)).messages.length;
    const field=await until(()=>{const node=document.querySelector('textarea[aria-label="Message"]');return node&&!node.disabled&&node;},'composer');
    input(field,prompt);await click('Send message');
    const message=await until(async()=>{const chat=await api.getConversation(id);return chat.messages.length>before&&chat.messages.at(-1);},'admission');
    const terminal=await until(async()=>{const chat=await api.getConversation(id),value=chat.messages.find(item=>item.id===message.id);return value&&!['pending','streaming'].includes(value.status)&&!chat.activeRequestId&&value;},'terminal request');
    check(terminal.status==='completed',`Request failed: ${terminal.errorMessage??terminal.status}`);
    await until(()=>document.querySelector(`[data-chat-message-id="${terminal.id}"]`)?.textContent.includes(terminal.content.trim().slice(0,18)),'rendered answer');return terminal;
  };
  const currentReview=async id=>{
    const draft=await api.getProposalDraft(id);
    const editor=()=>{
      if(!Array.from(document.querySelectorAll('[data-testid="note-title"]')).some(node=>node.value===draft.title))return;
      return Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-editor')).map(node=>EditorView.findFromDOM(node)).find(view=>view?.state.doc.toString()===draft.markdown);
    };
    const ready=editor();if(ready)return ready;
    await openChat();let opened=false;
    return until(async()=>{
      const mounted=editor();if(mounted)return mounted;
      const card=document.querySelector(`section[data-proposal-id="${id}"]`);
      if(card&&!opened){opened=true;await click('Review in editor',card);}
      return editor();
    },'retained review editor');
  };
  const edit=async(id,markdown,title)=>{
    const view=await currentReview(id);view.dispatch({changes:{from:0,to:view.state.doc.length,insert:markdown},userEvent:'input.type'});
    const field=await until(()=>view.dom.closest('[data-pane-frame]')?.querySelector('[data-testid="note-title"]'),'corresponding review title');
    const capability=reviewedTitlePlan(field.value,title,!field.readOnly&&!field.disabled);
    if(capability.changeTitle){input(field,capability.reviewedTitle);await pause();field.blur();}
    const draft=await until(async()=>{const draft=await api.getProposalDraft(id);return draft.markdown===markdown&&draft.title===capability.reviewedTitle&&draft;},'acknowledged edit');
    return {draft,...capability};
  };
  const keep=async(id,conversationId)=>{
    await currentReview(id);await openChat();
    const before=await api.getProposalDraft(id);
    const observed=await observePublicKeep(api,id,before,async()=>{
      const strip=await until(()=>document.querySelector(`[data-proposal-strip="active"][data-proposal-id="${id}"]`),'review action strip');
      (await until(()=>button('Keep All',strip)??button('Keep Remaining',strip),'normal Keep')).click();
      await until(async()=>!(await api.listPendingProposals(conversationId)).some(value=>value.id===id),'native publication');
    },until);
    state.kept.push({id,...observed});return observed.draft;
  };
  if(action==='seed') {
    check(!(await api.listConversations()).length,'Fresh generated conversations required');
    const source=await invoke('save_note',{title:'Paired synthetic orchard',markdown:'The synthetic orchard once had six pear trees.',currentPath:null});
    await invoke('finalize_note_editing_window',{noteId:source.noteId});
    await invoke('save_note',{title:'Paired synthetic orchard',markdown:'The synthetic orchard has seven pear trees.',currentPath:source.path});
    await invoke('finalize_note_editing_window',{noteId:source.noteId});
    state.source=source;
    state.full=(await api.createConversation({title:'Paired full conversation',provider,model:'pi-native-fixture',reasoningEffort:'off',vaultAccess:'full'})).id;
    state.approved=(await api.createConversation({title:'Paired approved conversation',provider,model:'pi-native-fixture',reasoningEffort:'off',vaultAccess:'approved'})).id;
    return state;
  }
  if(action==='evidence') {
    const read=await send(state.full,`PARITY:READ:${state.source.noteId}`);
    check(read.citations.some(source=>source.kind==='note'&&!source.passage?.historical),'Current admitted citation absent');
    const message=await until(()=>document.querySelector(`[data-chat-message-id="${read.id}"]`),'current answer');
    (await until(()=>message.querySelector('button[data-slot="inline-citation"]'),'normal current citation')).click();
    await until(()=>Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-editor')).map(node=>EditorView.findFromDOM(node)).find(view=>view?.state.doc.toString().includes('seven pear trees')),'canonical note navigation');
    if(!document.querySelector('[aria-label="Thought partner chat"]')) {
      (await until(()=>button('Open split pane options'),'split options')).focus();await pause();await click('Split with thought partner');
    }
    await select(state.full);
    const view=await until(()=>Array.from(document.querySelectorAll('[data-testid="note-editor"] .cm-editor')).map(node=>EditorView.findFromDOM(node)).find(view=>view?.state.doc.toString().includes('seven pear trees')),'mounted adjacent editor');
    const at=view.state.doc.toString().indexOf('seven pear trees');view.dispatch({selection:{anchor:at,head:at+'seven pear trees'.length}});view.focus();
    const context=await send(state.full,'PARITY:CONTEXT');check(context.citations.length,'Selected context lacks admitted citation');
    view.dispatch({selection:{anchor:0}});
    const historical=await send(state.full,`PARITY:HISTORY:${state.source.noteId}`);
    check(historical.citations.some(source=>source.passage?.historical),'Retained admitted citation absent');
    const historicalRoot=await until(()=>document.querySelector(`[data-chat-message-id="${historical.id}"]`),'historical answer');
    (await until(()=>Array.from(historicalRoot.querySelectorAll('button[data-slot="inline-citation"]')).find(node=>node.textContent.includes('Historical change')),'normal historical citation')).click();
    await until(()=>document.querySelector('[data-testid="history-mode"]'),'retained History Mode');await click('Back to workspace');
    return{currentCitation:true,currentNavigation:true,selectedContext:true,historicalCitation:true,historicalNavigation:true};
  }
  if(action==='grants') {
    await api.revokeNote(state.source.noteId);
    const denied=await send(state.approved,`PARITY:DENIED:${state.source.noteId}`);check(!denied.citations.length,'Denied read gained authority');
    // Both lanes expose persistent approved-note grants. The old lane has no
    // request_note_access tool or per-read permission dialog to compare.
    await api.grantNote(state.source.noteId);check((await api.listGrants()).some(grant=>grant.noteId===state.source.noteId),'Public note grant absent');
    const allowed=await send(state.approved,`PARITY:READ:${state.source.noteId}`);check(allowed.citations.length,'Granted read lacks admitted evidence');
    await api.revokeNote(state.source.noteId);check(!(await api.listGrants()).some(grant=>grant.noteId===state.source.noteId),'Public revoke failed');
    return{deniedRead:true,publicGrant:true,grantedRead:true,publicRevoke:true,grantUi:'not-compared'};
  }
  if(action==='review') {
    const before=new Set((await api.listPendingProposals(state.full)).map(item=>item.id));await send(state.full,'PARITY:CREATE');
    const proposal=await until(async()=>(await api.listPendingProposals(state.full)).find(item=>!before.has(item.id)),'created pending review');
    const edited=await edit(proposal.id,args.edit,'Paired human-reviewed plan');const final=await keep(proposal.id,state.full);
    check(final.markdown===args.edit&&final.title===edited.reviewedTitle,'Edited review not preserved');return{created:true,edited:true,kept:true,reviewedTitle:edited.reviewedTitle,draftTitleEditable:edited.draftTitleEditable,titleEditing:edited.titleEditing};
  }
  if(action==='save') {
    const answer=await send(state.full,'PARITY:HELLO');check(answer.content===args.answer,'Source-free answer differs');
    const before=new Set((await api.listPendingProposals(state.full)).map(item=>item.id));
    const root=await until(()=>document.querySelector(`[data-chat-message-id="${answer.id}"]`),'answer Save');await click('Save to note',root);
    const proposal=await until(async()=>(await api.listPendingProposals(state.full)).find(item=>!before.has(item.id)),'whole-answer Save review');
    const original=await api.getProposalDraft(proposal.id);check(original.markdown.includes(answer.content)&&original.markdown.includes('Open in chat'),'Faithful whole answer/origin absent');
    const edited=await edit(proposal.id,`${original.markdown}\n\n## Selected addition\n`,original.title);const keptSave=await keep(proposal.id,state.full);
    check(keptSave.title===edited.reviewedTitle,'Save changed admitted review title');
    // Obtain the exact receipt through public duplicate Keep, preserving its
    // final hunk-decision version, so selection can name the native destination.
    const receipt=state.kept.find(item=>item.id===proposal.id).receipt;
    check(receipt.status==='committed'&&receipt.noteId,'Save lacks canonical identity');state.savedNoteId=receipt.noteId;
    const duplicate=await api.prepareNoteSave(state.full,answer.id);check(duplicate.id===proposal.id&&duplicate.status==='committed','Duplicate Save changed identity');
    const selected=await api.prepareNoteSave(state.full,answer.id,{markdown:'Echo phrase.',text:'Echo phrase.',occurrence:1},{targetNoteId:receipt.noteId,heading:'Selected addition'});
    const selectedDraft=await api.getProposalDraft(selected.id);check(selectedDraft.markdown.includes('Selected addition'),'Explicit append heading absent');
    await keep(selected.id,state.full);return{faithfulWholeSave:true,originLink:true,duplicateSave:true,selectionOccurrence:1,explicitAppend:true,reviewedTitle:edited.reviewedTitle,draftTitleEditable:edited.draftTitleEditable,titleEditing:edited.titleEditing};
  }
  if(action==='duplicates') {
    const receipts=[];
    for(const {id,draft} of state.kept)receipts.push(await verifyDuplicateKeep(api,id,draft,lane));
    const append=receipts.at(-1);check(append.noteId===state.savedNoteId,'Append changed canonical identity');
    check((append.committedMarkdown.match(/Echo phrase\./g)??[]).length===3,'Selection append changed repeated-text occurrence count');
    return receipts;
  }
  if(action==='state')return state;
  throw new Error('Unknown paired browser action');
}
