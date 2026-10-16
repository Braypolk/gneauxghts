import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeParityWorkspace} from './paired-parity-gate.mjs';
import {reviewedTitlePlan,parityBrowserAction,observePublicKeep,verifyDuplicateKeep,reviewKeepControl,discoverPreparedReview} from './paired-parity-browser.mjs';

test('review title admission preserves read-only baseline and skips unchanged Save titles',()=>{
  assert.deepEqual(reviewedTitlePlan('Original baseline','Requested title',false),{
    reviewedTitle:'Original baseline',draftTitleEditable:false,titleEditing:'readonly-baseline',changeTitle:false});
  assert.deepEqual(reviewedTitlePlan('Original Pi','Requested title',true),{
    reviewedTitle:'Requested title',draftTitleEditable:true,titleEditing:'editable',changeTitle:true});
  assert.equal(reviewedTitlePlan('Saved original','Saved original',true).changeTitle,false);
  assert.equal(reviewedTitlePlan('Saved original','Saved original',false).changeTitle,false);
  const script=`const reviewedTitlePlan=(${reviewedTitlePlan.toString()});const observePublicKeep=(${observePublicKeep.toString()});const verifyDuplicateKeep=(${verifyDuplicateKeep.toString()});const reviewKeepControl=(${reviewKeepControl.toString()});const discoverPreparedReview=(${discoverPreparedReview.toString()});return (${parityBrowserAction.toString()});`;
  assert.doesNotThrow(()=>new Function(script));
});

test('exact retained review chooses normal aggregate control, or enabled inline Keep without a strip',()=>{
  const review={reviewId:'native-review-id',hunks:[{status:'kept'},{status:'modified'},{status:'pending'}]};
  const aggregate={kind:'aggregate'},disabled={kind:'inline-disabled',disabled:true},inline={kind:'inline'};
  assert.equal(reviewKeepControl(review,'native-review-id',aggregate,[disabled,inline]),aggregate);
  assert.equal(reviewKeepControl(review,'native-review-id',undefined,[disabled,inline]),inline);
  assert.throws(()=>reviewKeepControl(review,'another-proposal-review',aggregate,[inline]),/identity changed/);
  assert.equal(reviewKeepControl({...review,hunks:[{status:'kept'},{status:'undone'}]},'native-review-id',aggregate,[inline]),undefined);
});
test('API-prepared append is discovered by normal conversation reload without changing its identity or draft',async()=>{
  const prepared={id:'exact-append',conversationId:'full',draft:{version:0,markdown:'Accepted body\nSecond selected occurrence.',title:'Details'}};
  const stored=[prepared],initial=structuredClone(prepared);let active='full',mountedPending=[];
  // Mounted controller lists are snapshots; a same-conversation selection may
  // be skipped by the UI, while selecting away/back reloads ordinary pending state.
  const select=async id=>{if(id===active)return;active=id;mountedPending=stored.filter(proposal=>proposal.conversationId===id);};
  await select('full');assert.deepEqual(mountedPending,[]);
  await discoverPreparedReview(select,'full','approved');
  assert.equal(active,'full');assert.equal(mountedPending[0],prepared);assert.deepEqual(prepared,initial);
  await assert.rejects(discoverPreparedReview(select,'full','full'),/Distinct normal conversation/);
});

test('multiple normal inline decisions reach one final checkpoint and publication through observed UI Keep',async()=>{
  const before={version:2,markdown:'Exactly edited Save body',title:'Details',path:'/generated/Details.md',decisions:[]};
  const review={reviewId:'save-native-review',hunks:[{id:'a',status:'modified'},{id:'b',status:'pending'}]};
  let commits=0,clicks=0,version=before.version;
  const api={
    async checkpointProposalDraft(id,draft){return {...draft,version:++version};},
    async commitAgentProposal(id,markdown,expectedVersion){assert.equal(expectedVersion,version);commits++;return {status:'committed',committedMarkdown:markdown,noteId:'saved-note'};}
  };
  const observed=await observePublicKeep(api,'save-proposal',before,async()=>{
    while(review.hunks.some(hunk=>['pending','modified'].includes(hunk.status))) {
      const hunk=review.hunks.find(hunk=>['pending','modified'].includes(hunk.status));
      const control={disabled:false,async click(){clicks++;hunk.status='kept';const final=await api.checkpointProposalDraft('save-proposal',{...before,decisions:structuredClone(review.hunks)});if(review.hunks.every(hunk=>hunk.status==='kept'))await api.commitAgentProposal('save-proposal',final.markdown,final.version);}};
      await reviewKeepControl(review,'save-native-review',undefined,[control]).click();
    }
  },async check=>check());
  assert.equal(clicks,2);assert.equal(commits,1);assert.equal(observed.draft.version,4);
  assert.deepEqual(observed.draft.decisions.map(hunk=>hunk.status),['kept','kept']);
  assert.equal(observed.receipt.committedMarkdown,before.markdown);
});

test('normal UI Keep observes the final acknowledged version without reading a resolved baseline draft',async()=>{
  const before={version:3,markdown:'Human reviewed body',title:'Baseline title',path:'/generated/Plan.md',decisions:[]};
  let resolved=false,commits=0,checkpoints=0;
  const receipt={status:'committed',committedMarkdown:before.markdown,noteId:'canonical-id',applied:{path:before.path}};
  const api={
    async getProposalDraft(){assert(!resolved,'That review is already resolved.');return before;},
    async checkpointProposalDraft(id,draft){assert.equal(id,'review-1');checkpoints++;return {...draft,version:4};},
    async commitAgentProposal(id,markdown,version){assert.equal(id,'review-1');assert.equal(markdown,before.markdown);assert.equal(version,4);commits++;resolved=true;return receipt;}
  };
  const originalCheckpoint=api.checkpointProposalDraft,originalCommit=api.commitAgentProposal;
  const observed=await observePublicKeep(api,'review-1',before,async()=>{
    const final=await api.checkpointProposalDraft('review-1',{...before,decisions:[{status:'kept'}]});
    await api.commitAgentProposal('review-1',final.markdown,final.version);
  },async check=>{const result=check();assert(result);return result;});
  assert.equal(commits,1);assert.equal(checkpoints,1);assert.equal(observed.draft.version,4);
  assert.deepEqual(observed.draft.decisions,[{status:'kept'}]);assert.deepEqual(observed.receipt,receipt);
  await assert.rejects(api.getProposalDraft(),/already resolved/);
  assert.equal(api.checkpointProposalDraft,originalCheckpoint);assert.equal(api.commitAgentProposal,originalCommit);
});

test('Keep observation rejects mismatched commit version and restores prototype methods after failure',async()=>{
  const before={version:3,markdown:'Reviewed body',title:'Plan',path:'/generated/Plan.md'};
  const prototype={async checkpointProposalDraft(id,draft){return draft;},async commitAgentProposal(){return {status:'committed',committedMarkdown:before.markdown};}};
  const api=Object.create(prototype);
  await assert.rejects(observePublicKeep(api,'review-1',before,async()=>{await api.commitAgentProposal('review-1',before.markdown,2);},async check=>check()),/exact acknowledged draft/);
  assert.equal(Object.hasOwn(api,'checkpointProposalDraft'),false);assert.equal(Object.hasOwn(api,'commitAgentProposal'),false);
});

test('baseline stale duplicate preserves its existing receipt while Pi requires version rejection',async()=>{
  const draft={version:4,markdown:'Accepted body'},receipt={status:'committed',committedMarkdown:draft.markdown,noteId:'canonical-id'};
  const versions=[];
  const baseline={async commitAgentProposal(id,markdown,version){versions.push(version);return receipt;}};
  const old=await verifyDuplicateKeep(baseline,'review-1',draft,'old');
  assert.equal(old.staleDuplicate,'accepted-existing-receipt');assert.deepEqual(versions,[3,4,4]);
  await assert.rejects(verifyDuplicateKeep(baseline,'review-1',draft,'pi'),/Stale duplicate Keep accepted by Pi/);
  const pi={async commitAgentProposal(id,markdown,version){if(version!==draft.version)throw new Error('Stale');return receipt;}};
  assert.equal((await verifyDuplicateKeep(pi,'review-1',draft,'pi')).staleDuplicate,'rejected');
});

test('baseline capability handling cannot accept a changed stale or duplicate receipt',async()=>{
  const draft={version:4,markdown:'Accepted body'},receipt={status:'committed',committedMarkdown:draft.markdown,noteId:'canonical-id'};
  const changedStale={async commitAgentProposal(id,markdown,version){return version===3?{...receipt,noteId:'different-id'}:receipt;}};
  await assert.rejects(verifyDuplicateKeep(changedStale,'review-1',draft,'old'),/stale duplicate changed existing receipt/);
  let count=0;const changedDuplicate={async commitAgentProposal(){return ++count===3?{...receipt,noteId:'different-id'}:receipt;}};
  await assert.rejects(verifyDuplicateKeep(changedDuplicate,'review-1',draft,'old'),/Duplicate Keep changed receipt/);
  await assert.rejects(verifyDuplicateKeep(changedStale,'review-1',draft,undefined),/Explicit duplicate comparison lane/);
});

test('initialization timeout retains the latest bounded browser error and failed phase',async()=>{
  const output={lane:'old',checks:[]};let attempts=0;
  const wait=async(check,phase,timeout)=>{
    assert.equal(phase,'normal native workspace');assert.equal(timeout,45000);
    assert.equal(await check(),false);assert.equal(await check(),false);
    throw new Error('Timed out waiting for normal native workspace');
  };
  await assert.rejects(initializeParityWorkspace({output,phase:'normal native workspace',args:{protocol:'compatible'},wait,
    execute:async()=>{throw new Error(++attempts===1?'Actual native workspace required':`Initialization step failed ${'x'.repeat(1000)}`);}
  }),/Timed out waiting/);
  assert.equal(output.lastInitializeError.phase,'normal native workspace');
  assert.equal(output.lastInitializeError.attempt,2);
  assert.match(output.lastInitializeError.error,/Initialization step failed/);
  assert.equal(output.lastInitializeError.error.length,700);
  assert.deepEqual(output.checks,[]);
});

test('initialization retries preserve full captured state and never turn failure into success',async()=>{
  const output={},state={kept:[{id:'review-1',draft:{version:5}}]},args={protocol:'responses',state};
  const calls=[];
  const result=await initializeParityWorkspace({output,phase:'reloaded normal workspace',args,
    wait:async check=>{assert.equal(await check(),false);return check();},
    execute:async(action,input)=>{calls.push({action,input});if(calls.length===1)throw new Error('Module is not ready');return true;}
  });
  assert.equal(result,true);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.action,'initialize');assert.equal(call.input,args);assert.equal(call.input.state,state);}
  assert.deepEqual(output.lastInitializeError,{phase:'reloaded normal workspace',attempt:1,error:'Error: Module is not ready'});
});
