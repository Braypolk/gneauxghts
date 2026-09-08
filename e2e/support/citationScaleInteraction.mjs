import assert from 'node:assert/strict';

// Runs the real chat-pane citation binding and session after evidence delivery.
// The backend probe supplies immutable target IDs; there is no paging setup.
export async function citationPaint(client, record, citation, action) {
  await client.invoke('plugin:window|show', { label: 'main' });
  await client.invoke('plugin:window|set_focus', { label: 'main' });
  const result = await client.asyncExecute(`
    const [citation,action] = arguments, done=arguments[arguments.length-1];
    if(document.visibilityState!=='visible'||!document.hasFocus()) {done({error:'Native citation start is not visible/focused'});return;}
    let finished=false,observer;
    const finish=result=>{if(finished)return;finished=true;observer?.disconnect();clearTimeout(timeout);done(result);};
    const timeout=setTimeout(()=>finish({error:'Citation '+action+' stalled'}),20000);
    const before=[...document.querySelectorAll('[data-revision-id]')].map(b=>b.dataset.revisionId).join(',');
    const started=performance.now();
    observer=new MutationObserver(()=>{
      const timeline=document.querySelector('aside[aria-label="Note timeline"]');
      const ids=[...document.querySelectorAll('[data-revision-id]')].map(b=>b.dataset.revisionId);
      const selected=document.querySelector('[data-revision-id][aria-pressed="true"]');
      const ready=action==='entry'?selected?.dataset.revisionId===citation.revision.revisionId&&!selected.disabled:
        timeline?.getAttribute('aria-busy')==='false'&&ids.join(',')!==before;
      if(!ready)return;observer.disconnect();
      requestAnimationFrame(()=>requestAnimationFrame(()=>finish({elapsed:performance.now()-started,
        rows:Number(timeline.dataset.historyRecordCount),revisionIds:ids,
        visibility:document.visibilityState,focus:document.hasFocus(),
        diffLines:document.querySelectorAll('[data-diff-kind]').length})));
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
    if(action==='entry')window.__GNEAUXGHTS_NATIVE_E2E__.openRevisionCitation(citation).catch(error=>finish({error:String(error)}));
    else {
      const button=[...document.querySelectorAll('aside button')].find(b=>b.textContent.trim()==='Load '+action+' history');
      if(!button||button.disabled){finish({error:'Missing enabled '+action+' button'});return;}
      button.click();
    }
  `, [citation, action]);
  assert(!result.error, result.error);
  assert.equal(result.visibility, 'visible');
  assert.equal(result.focus, true);
  assert(result.rows <= 31);
  record('citation-paint', { action, revisionId: citation.revision.revisionId, ...result });
  return result;
}

export async function exerciseCitations(client, record, note, selections) {
  const samples=[];
  const workspace=await client.execute('return window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState();');
  const currentBody=workspace.editor.markdown;
  for(const selection of selections) {
    const historical=await client.invoke('get_note_history_revision',{noteId:note.noteId,revisionId:selection.revision_id});
    const excerpt=historical.body.split('\n').find(line=>line.length>20&&currentBody.includes(line));
    assert(excerpt,'The cited historical revision must carry retained current prose');
    const citation={id:'native-current-citation',kind:'note',noteId:note.noteId,notePath:'',label:note.title,sectionLabel:null,startLine:null,excerpt,
      revision:{noteId:note.noteId,revisionId:selection.revision_id,atMillis:selection.target_record.occurredAtMillis,source:selection.target_record.source,timeEvidence:selection.target_record.timeEvidence,currentExcerpt:excerpt}};
    for(let sample=0;sample<3;sample++) {
      const entry=await citationPaint(client,record,citation,'entry');
      samples.push({revisionIndex:selection.revision_index,sample,action:'entry',...entry});
      for(const direction of ['older','newer']) {
        const available=await client.execute('return [...document.querySelectorAll("aside button")].some(b=>b.textContent.trim()===arguments[0]);',['Load '+direction+' history']);
        if(available) samples.push({revisionIndex:selection.revision_index,sample,action:direction,...await citationPaint(client,record,citation,direction)});
      }
      await client.execute('document.querySelector("button[aria-label=\\"Back to workspace\\"]").click();return true;');
      const deadline=Date.now()+5000;
      while(await client.execute('return !!document.querySelector("[data-testid=history-mode]");')) {
        assert(Date.now()<deadline,'History exit timeout');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      const restored=await client.execute('return window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState();');
      for(const key of ['activePaneId','paneIds','paneKind','noteId'])assert.deepEqual(restored[key],workspace[key]);
      assert.equal(restored.editor.markdown,workspace.editor.markdown);
      assert.deepEqual(restored.editor.selection,workspace.editor.selection);
    }
  }
  return samples;
}
