import { invoke } from '@tauri-apps/api/core';
import { Harness, defineDoc, createRegistry, watchEvents, defineExtension } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openNativeSqlite } from './nativeSqlite';
import { nativeModels, nativeTransportStats } from './nativeProvider';
import { Evidence, notesExtension, evidenceSources, AdmittedAnswer } from './notesExtension';
import { fixtureProviderAdmissions, fixtureAdmissionProbe, restoreProviderSwitchProbe, rememberProviderSwitchProbe } from './providerProbe';
import { ReviewTask } from './reviews';

const Probe = defineDoc({ kind: 'gneauxghts.prototype.probe', version: 1, scope: 'session',
  initial: () => ({ runs: 0, submission: 0 }) });
const UiProbe = defineDoc({kind:'gneauxghts.prototype.ui-probe',version:1,scope:'session',initial:()=>({conversationId:'',keepId:'',discardId:'',phase:'new',uiBody:'',uiTitle:'',uiCheckpointVersion:0})});
function probeRegistry(){const registry=createRegistry();registry.install(defineExtension({name:'gneauxghts.review-task',tasks:[ReviewTask]}));return registry;}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

// Runs inside the real webview, including its real structuredClone implementation.
export async function nativeProbe() {
  const report: Record<string, unknown> = { pin: '1.3.0', userAgent: navigator.userAgent, checks: [] };
  const checks = report.checks as string[];
  const mark = async (name: string) => { checks.push(name); await invoke('pi_probe_report', { report }); };
  let harness: Harness | undefined;
  try {
    let db = await openNativeSqlite();
    await db.exec('CREATE TABLE IF NOT EXISTS prototype_facade (id INTEGER PRIMARY KEY, value TEXT)');
    await db.run('DELETE FROM prototype_facade');
    const expected = new Error('intentional rollback');
    try {
      await db.transaction(async tx => {
        await tx.run('INSERT INTO prototype_facade VALUES (?, ?)', 1, 'must rollback');
        throw expected;
      });
    } catch (error) { assert(error === expected, 'callback error lost or rollback failed'); }
    assert(!(await db.get('SELECT * FROM prototype_facade')), 'rollback leaked row');
    await mark('native callback rollback');
    let escaped: import('@earendil-works/pi-durable/storage/sqlite').SqliteExecutor | undefined;
    const order: string[] = [];
    const write = db.transaction(async tx => {
      escaped = tx;
      await tx.run('INSERT INTO prototype_facade VALUES (?, ?)', 1, 'committed');
      order.push('transaction');
    });
    const read = db.get<{value: string}>('SELECT value FROM prototype_facade').then(row => {
      assert(row?.value === 'committed', 'competing query saw uncommitted state'); order.push('read');
    });
    await Promise.all([write, read]);
    assert(order.join(',') === 'transaction,read', 'unrelated work did not queue');
    let staleRejected = false;
    try { await escaped!.run('DELETE FROM prototype_facade'); } catch { staleRejected = true; }
    assert(staleRejected, 'closed transaction handle accepted');
    await mark('serialized competing access and stale handle rejection');
    await db.close();

    const models = createModels();
    const faux = fauxProvider(); models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage('Synthetic Pi native reply.')]);
    db = await openNativeSqlite();
    harness = await Harness.open(await SqliteStorage.open(db), { models, registry: probeRegistry() }, context);
    const previous = await harness.snapshot(Probe, context);
    if (previous?.submission) {
      const restored = await harness.submission(previous.submission as never, context);
      assert(restored && (await restored.wait(context)).status === 'done', 'process relaunch receipt missing');
      await mark('prior process submission receipt restored');
    }
    const root = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
    const submission = await root.submit({ type: 'input', content: 'Synthetic native Pi turn.' }, context);
    const receipt = await submission.wait(context);
    assert(receipt.status === 'done', 'Pi turn did not complete');
    await harness.commit(async tx => {
      const state = await tx.doc(Probe); state.runs++; state.submission = submission.id;
    }, context);
    const entries = (await root.context(context)).entries;
    assert(entries.some(entry => entry.kind === 'pi.assistant'), 'committed assistant entry missing');
    report.entryKinds = entries.map(entry => entry.kind); report.submissionId = submission.id;
    await mark('Pi submission and committed assistant through native SQLite');
    await harness.close(context); harness = undefined;
    harness = await Harness.open(await SqliteStorage.open(await openNativeSqlite()), { models, registry: probeRegistry() }, context);
    const restored = await harness.submission(submission.id, context);
    assert(restored && (await restored.wait(context)).status === 'done', 'reopen receipt missing');
    assert((await harness.snapshot(Probe, context))?.submission === submission.id, 'reopen document missing');
    await mark('Pi close/reopen document and receipt');
    await harness.close(context); harness = undefined;
    const config=await invoke<{fixture:boolean;uiGate:boolean}>('pi_probe_config');
    if (config.fixture) {
      const note = await invoke<{noteId: string}>('save_note', { title: 'Pi synthetic source', markdown: '# Pi synthetic source\n\nThe synthetic orchard has seven pear trees.', currentPath: null });
      const permitted = new Set<number>();
      const policies = new Map();
      const registry = probeRegistry(); registry.install(notesExtension(permitted,policies));
      const providerAdmissions=fixtureProviderAdmissions(policies);registry.install(providerAdmissions.extension);
      await fixtureAdmissionProbe(mark);
      const providerModels=nativeModels(policies, async (policy,answer) => {
        await harness!.commit(async tx => {const doc = await tx.doc(AdmittedAnswer,String(policy.taskId),'');doc.text=answer.text;doc.sourcesJson=JSON.stringify(answer.sources);},context);
      });
      for(const provider of ['local','openai'] as const)providerModels.registerModel(provider,'pi-native-fixture-b');
      harness = await Harness.open(await SqliteStorage.open(await openNativeSqlite()), { models: providerModels, registry,
        settings: { progress: { partialIntervalMs: 10, outputIntervalMs: 10 }, retry: { enabled: false, maxRetries: 0 } } }, context);
      await restoreProviderSwitchProbe(harness,mark);
      for (const provider of ['local', 'openai'] as const) {
        const conversation = await harness.createConversation({ ownership: {kind: 'ownerless'},
          agent: { model: {provider, modelId: 'pi-native-fixture'} } }, context);
        permitted.add(conversation.id);
        await harness.commit(async tx => { (await tx.doc(Evidence, conversation.id)).access = 'full'; }, context);
        const chunksBefore = nativeTransportStats.chunks;
        let updates = 0, tools = 0;
        const events = await watchEvents(harness, conversation.id, context);
        events.start(async batch => { for (const event of batch) {
          if (event.type === 'message_update') updates++;
          if (event.type === 'tool_execution_end') tools++;
        } });
        await providerAdmissions.admit(harness,conversation.id,provider);
        const submitted = await conversation.submit({type:'input',content:`READ_NOTE:${note.noteId}`},context);
        const receipt = await submitted.wait(context);
        assert(receipt.status === 'done', `${provider} native turn failed: ${JSON.stringify(receipt)}`);
        assert(tools === 1, `${provider} tool invocation/arguments missing`);
        const binding = await harness.snapshot(Evidence, conversation.id, context);
        assert(binding && evidenceSources(binding).some(source => source.excerpt.includes('seven pear trees')), 'Canonical read/citation binding absent');
        assert(updates > 0 && nativeTransportStats.chunks > chunksBefore + 1, `${provider} native streaming/progress absent`);
        await harness.commit(async tx => { (await tx.doc(Evidence, conversation.id)).sourcesJson = '[]'; }, context);
        await conversation.configure({model:{provider,modelId:'pi-native-fixture-b'}},context);
        await providerAdmissions.admit(harness,conversation.id,provider,'pi-native-fixture-b');
        const followup = await conversation.submit({type:'input',content:'Followup'},context);
        assert((await followup.wait(context)).status === 'done', `${provider} followup failed`);
        await mark(`${provider}: native streamed turn, scoped read/citation, follow-up and model switch`);
        await rememberProviderSwitchProbe(harness,provider,conversation.id);
        await providerAdmissions.admit(harness,conversation.id,provider,'pi-native-fixture-b');
        const slow = await conversation.submit({type:'input',content:'SLOW_CANCEL'},context);
        await new Promise(resolve => setTimeout(resolve,200));
        await conversation.abort(context);
        assert((await slow.wait(context)).status !== 'done', `${provider} cancellation announced success`);
        await mark(`${provider}: native inference cancellation`);
        await providerAdmissions.admit(harness,conversation.id,provider,'pi-native-fixture-b');
        const partial = await conversation.submit({type:'input',content:'PARTIAL_FAILURE'},context);
        assert((await partial.wait(context)).status !== 'done', `${provider} partial stream announced success`);
        await mark(`${provider}: partial stream fails terminally`);
        await providerAdmissions.release(conversation.id);
        await events.stop();
      }
      const previousUi=await harness.snapshot(UiProbe,context);
      await harness.close(context);harness=undefined;
      const {createPiChatApi}=await import('./chatApi');const {TauriChatApi}=await import('$lib/features/chat/api');
      const api=createPiChatApi(new TauriChatApi());
      if(!previousUi || previousUi.phase==='new'){const {domainProbe}=await import('./domainProbe');await domainProbe(api,mark);}
      const until=async<T>(read:()=>Promise<T|false>):Promise<T>=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await read();if(value!==false)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('UI adapter probe deadline');};
      if(previousUi?.phase==='pending') {
        const draft=await api.getProposalDraft!(previousUi.keepId);
        assert(previousUi.uiBody ? draft.markdown===previousUi.uiBody && draft.title===previousUi.uiTitle && draft.version>=previousUi.uiCheckpointVersion
          : draft.markdown.includes('Edited checkpoint') && draft.title==='Edited Pi title' && draft.decisions[0]?.status==='modified','Edited checkpoint/title/hunks lost at process restart');
        await mark('Pi review checkpoint/title/hunks restored after process relaunch');
        if(config.uiGate) {report.ui={...previousUi,relaunch:true};}
        else {
        const result=await api.commitAgentProposal(previousUi.keepId,draft.markdown,draft.version);
        assert(result.status==='committed' && result.committedMarkdown.includes('Edited checkpoint'),'Restored Keep did not publish edited bytes');
        const duplicate=await api.commitAgentProposal(previousUi.keepId,draft.markdown,draft.version);
        assert(duplicate.status==='committed' && duplicate.noteId===result.noteId,'Duplicate Keep published another note');
        const discarded=await api.dismissAgentProposal(previousUi.discardId);assert(discarded.status==='dismissed','Restored Discard failed');
        report.ui={...previousUi,phase:'settled',keepNoteId:result.noteId,keepPath:result.applied?.path};
        await apiProbeMetadata(api,report.ui);
        await mark('restored Keep native receipt, duplicate Keep, restored Discard');
        }
      } else {
        const conversation=await api.createConversation({title:'Pi UI gate',vaultAccess:'full'});
        const receipt=await api.sendMessage({conversationId:conversation.id,content:'Synthetic UI answer'});
        const completed=await until(async()=>{const loaded=await api.getConversation(conversation.id);const answer=loaded.messages.find(m=>m.id===receipt.assistantMessage?.id);return answer?.status==='completed'?answer:false;});
        const proposal=await api.prepareNoteSave!(conversation.id,completed.id);
        const duplicate=await api.prepareNoteSave!(conversation.id,completed.id);assert(duplicate.id===proposal.id,'Direct Save origin duplicated');
        const draft=await api.getProposalDraft!(proposal.id);const markdown='Edited checkpoint retained through restart.';
        const decisions=[{id:'edited-hunk',baseFrom:0,baseTo:0,proposedFrom:0,proposedTo:markdown.length,oldText:'',newText:markdown,from:0,to:markdown.length,status:'modified' as const}];
        const saved=await api.checkpointProposalDraft!(proposal.id,{...draft,markdown,title:'Edited Pi title',decisions});
        assert(saved.version===draft.version+1,'Checkpoint not acknowledged');
        let stale=false;try{await api.checkpointProposalDraft!(proposal.id,draft);}catch{stale=true;}assert(stale,'Stale checkpoint accepted');
        const discard=await api.prepareNoteSave!(conversation.id,completed.id,{markdown:'Discard me',text:'Discard Pi draft'});
        report.ui={conversationId:conversation.id,keepId:proposal.id,discardId:discard.id,phase:'pending',uiBody:'',uiTitle:'',uiCheckpointVersion:0};
        await mark('existing ChatApi projection, direct Save without model, edited durable review and stale checkpoint rejection');
        // The API owns this open harness; persist probe metadata through its own
        // command surface below, without opening a second SQLite facade.
        await apiProbeMetadata(api,report.ui);
      }
      await (api as unknown as {prototypeClose:()=>Promise<void>}).prototypeClose();
    }
    report.status = 'passed';
    if(config.uiGate) setTimeout(()=>{location.href=`/?piUiTest=${(report.ui as {relaunch?:boolean})?.relaunch?'relaunch':'first'}`;},500);
  } catch (error) {
    report.status = 'failed'; report.error = String(error); report.stack = error instanceof Error ? error.stack : '';
  } finally {
    if (harness) await harness.close(context).catch(error => { report.closeError = String(error); });
    await invoke('pi_probe_report', { report });
  }
  return report;
}

// Used only by the disposable acceptance driver; implemented by the Pi adapter.
async function apiProbeMetadata(api:unknown, value:unknown) {
  await (api as {prototypeCheckpoint:(value:unknown)=>Promise<void>}).prototypeCheckpoint(value);
}
export { UiProbe };
