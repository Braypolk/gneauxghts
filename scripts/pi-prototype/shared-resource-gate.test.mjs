import test from 'node:test';
import assert from 'node:assert/strict';
import { planSharedReply, cleanEnvironment, DUMMY_AUTHORIZATION, initializeResourceWorkspace, browserSend, browserSelect, installInvokeObserver, observedIpcCoverage, LONG_OUTPUT, LONG_OUTPUT_LINES, SHARED_JOURNEYS, FIXTURE_BUDGET, captureStorageMetadata, storageGrowth, stopOwnedResourceProcess } from './shared-resource-gate.mjs';
import {parseArguments,OLD_SHA256} from './shared-resource-gate.mjs';
import {parseParityArguments} from './paired-parity-gate.mjs';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,rmSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const digest=value=>createHash('sha256').update(value).digest('hex');
function artifacts(check) {
  const folder=realpathSync(mkdtempSync(join(tmpdir(),'pi-artifact-parser-')));
  try {
    const old=Buffer.from('Synthetic old artifact GNEAUXGHTS_OPENAI_FIXTURE_URL'),pi=Buffer.from('Synthetic Pi artifact');
    mkdirSync(join(folder,'old-source'));mkdirSync(join(folder,'pi-source'));
    writeFileSync(join(folder,'old-binary'),old);writeFileSync(join(folder,'pi-binary'),pi);
    const argv=['--root',join(folder,'fresh'),'--old-source',join(folder,'old-source'),'--pi-source',join(folder,'pi-source'),
      '--old-binary',join(folder,'old-binary'),'--pi-binary',join(folder,'pi-binary'),'--pi-sha256',digest(pi)];
    return check({argv,oldHash:digest(old)});
  }finally{rmSync(folder,{recursive:true,force:true});}
}

test('fixture accepts only absent or exact dummy authorization without credentials', () => {
  for (const authorization of [undefined, DUMMY_AUTHORIZATION]) {
    assert.equal(planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_HELLO' }] }, authorization).case, 'short');
  }
  assert.throws(() => planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_HELLO' }] }, 'Bearer actual-secret'));
});
test('follow-up requires earlier actual source-free assistant history', () => {
  assert.throws(() => planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_FOLLOWUP' }] }));
  assert.equal(planSharedReply({ messages: [{ role: 'assistant', content: 'Shared synthetic answer.' }, { role: 'user', content: 'RESOURCE_FOLLOWUP' }] }).case, 'followup');
});
test('stop fixture streams a partial and unknown prompts cannot pass', () => {
  assert.equal(planSharedReply({ messages: [{ role: 'user', content: 'RESOURCE_STOP' }] }).pause, true);
  assert.throws(() => planSharedReply({ messages: [{ role: 'user', content: 'Unknown' }] }));
});
test('source-free fixture uses the actual offered final formatter and keeps cancellation paused',()=>{
  const tools=[{type:'function',function:{name:'final_result_1',parameters:{type:'object',properties:{segments:{type:'array'}}}}}];
  for(const prompt of ['RESOURCE_HELLO','RESOURCE_FOLLOWUP','RESOURCE_LONG','RESOURCE_STOP']) {
    const messages=[{role:'assistant',content:'Shared synthetic answer.'},{role:'user',content:prompt}];
    const reply=planSharedReply({messages,tools});
    assert.equal(reply.tool.name,'final_result_1');
    assert.deepEqual(JSON.parse(reply.tool.arguments),{segments:[{text:reply.text,sources:[]}]});
    assert.equal(reply.pause,prompt==='RESOURCE_STOP');
    assert.equal(planSharedReply({messages,tools:[]}).tool,undefined);
  }
  assert.throws(()=>planSharedReply({messages:[{role:'user',content:'RESOURCE_FOLLOWUP'}],tools}),/omitted prior source-free answer/);
});
test('long fixture is exact bounded output through both actual offered response shapes',()=>{
  assert.equal(LONG_OUTPUT_LINES,256);assert.equal(LONG_OUTPUT.split('\n').length,256);
  assert.equal(LONG_OUTPUT.split('\n')[0],'Synthetic output line 001: bounded.');
  assert.equal(LONG_OUTPUT.split('\n').at(-1),'Synthetic output line 256: bounded.');
  assert(Buffer.byteLength(LONG_OUTPUT)>Buffer.byteLength('Shared synthetic answer.')*100);
  assert(Buffer.byteLength(LONG_OUTPUT)<=FIXTURE_BUDGET.outputBytes);
  const messages=[{role:'user',content:'RESOURCE_LONG'}];
  const plain=planSharedReply({messages});
  const structured=planSharedReply({messages,tools:[{type:'function',function:{name:'actual_baseline_formatter',parameters:{properties:{segments:{type:'array'}}}}}]});
  assert.equal(plain.case,'long-output');assert.equal(plain.text,LONG_OUTPUT);assert.equal(plain.pause,false);assert.equal(plain.tool,undefined);
  assert.equal(structured.tool.name,'actual_baseline_formatter');
  assert.deepEqual(JSON.parse(structured.tool.arguments),{segments:[{text:LONG_OUTPUT,sources:[]}]});
  assert.deepEqual(SHARED_JOURNEYS.map(row=>row.scenario),['short','followup','long-output','cancel']);
  assert.equal(SHARED_JOURNEYS.length*2,8);assert.equal(FIXTURE_BUDGET.requestsPerJourney,1);
});
async function runLongBrowserSend(terminalContent) {
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  let sent=false;const observer={failures:0};
  const api={async getConversation(){return {messages:sent?[{id:'user',role:'user',content:'RESOURCE_LONG'},
    {id:'answer',role:'assistant',status:'completed',content:terminalContent}]:[]};}};
  const field={disabled:false,focus(){},dispatchEvent(){assert.equal(this.value,'RESOURCE_LONG');}};
  const send={disabled:false,textContent:'',getAttribute(){return 'Send message';},click(){sent=true;}};
  const browserDocument={querySelector(selector){return selector.startsWith('textarea')?field:{textContent:LONG_OUTPUT};},querySelectorAll(){return [send];}};
  const browserWindow={__resourceApi:api,__resourceIpc:[],__resourceObserver:observer,__resourceObserverMetadata:{installed:true,verified:true}};
  const run=new AsyncFunction('browserWindow','browserDocument','BrowserInputEvent','expected',
    `const window=browserWindow,document=browserDocument,InputEvent=BrowserInputEvent,globalThis={__piModuleInvokeObserver:window.__resourceObserver};
     const requestAnimationFrame=callback=>callback();return(async function(){${browserSend}}).apply(null,['conversation','RESOURCE_LONG',false,expected]);`);
  return run(browserWindow,browserDocument,class {},LONG_OUTPUT);
}
test('actual normal Send script validates all long terminal bytes, not only a visible prefix',async()=>{
  const result=await runLongBrowserSend(LONG_OUTPUT);
  assert.equal(result.exactTerminalContent,true);assert.equal(result.terminalContentBytes,Buffer.byteLength(LONG_OUTPUT));
  assert.equal(result.messageCount,2);assert.deepEqual(result.events.map(row=>row.kind),['send','first_visible','terminal']);
  await assert.rejects(runLongBrowserSend(LONG_OUTPUT.split('\n').slice(0,-1).join('\n')),/Terminal answer differs/);
  await assert.rejects(runLongBrowserSend(LONG_OUTPUT+'\nUnexpected extra output'),/Terminal answer differs/);
  await assert.rejects(runLongBrowserSend(LONG_OUTPUT.replace('line 128','line 999')),/Terminal answer differs/);
});
test('storage snapshots count only generated-root file metadata and retain unknown allocation/checkpoint state',()=>{
  const folder=realpathSync(mkdtempSync(join(tmpdir(),'pi-storage-metadata-'))),root=join(folder,'data');mkdirSync(root);
  try {
    writeFileSync(join(folder,'native.log'),'outside log'.repeat(100));writeFileSync(join(folder,'observer-config.mjs'),'outside overlay');
    const before=captureStorageMetadata(root,{writerAbsent:true});assert.equal(before.logicalBytes,0);assert.equal(before.fileCount,0);
    mkdirSync(join(root,'vault'));mkdirSync(join(root,'vault','.gneauxghts'));
    for(const [name,value] of [['state.sqlite','not an SQLite database'],['history.sqlite3','123'],['other.db','12345'],['state.sqlite-wal','1234567'],['state.sqlite-shm','123456789']])
      writeFileSync(join(root,'vault','.gneauxghts',name),value);
    writeFileSync(join(root,'vault','Conversation.md'),'synthetic markdown');writeFileSync(join(root,'settings.json'),'{}');
    const after=captureStorageMetadata(root,{writerAbsent:true}),growth=storageGrowth(before,after);
    assert.equal(after.fileCount,7);assert.equal(after.bytesByKind.sqlite,Buffer.byteLength('not an SQLite database')+8);
    assert.equal(after.bytesByKind.wal,7);assert.equal(after.bytesByKind.shm,9);
    assert.equal(after.bytesByKind.markdown,Buffer.byteLength('synthetic markdown'));assert.equal(after.bytesByKind.other,2);
    assert.equal(after.logicalBytes,Object.values(after.bytesByKind).reduce((a,b)=>a+b,0));
    assert.deepEqual(growth.bytesByKind,after.bytesByKind);assert.equal(growth.logicalBytes,after.logicalBytes);
    assert.equal(after.allocatedBytes,null);assert.equal(after.checkpointPerformed,false);assert.equal(after.checkpointState,'unknown');assert.equal(after.contentRead,false);
    assert(!after.files.some(file=>file.path.includes('native.log')||file.path.includes('observer-config')));
    unlinkSync(join(root,'vault','.gneauxghts','state.sqlite-wal'));
    const closed=captureStorageMetadata(root,{writerAbsent:true});assert.equal(closed.bytesByKind.wal,0);
    assert.equal(storageGrowth(after,closed).bytesByKind.wal,-7);
    assert.throws(()=>captureStorageMetadata(root),/absent owned writer/);
    symlinkSync(join(folder,'native.log'),join(root,'linked-log'));
    assert.throws(()=>captureStorageMetadata(root,{writerAbsent:true}),/Storage symlink refused/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
test('owned closure recognizes signal exits and awaits forced termination before storage may be captured',async()=>{
  const killed=[],child={exitCode:null,signalCode:null,kill(signal){killed.push(signal);}};
  const phases=[];
  const result=await stopOwnedResourceProcess(child,'SIGTERM',{wait:async(check,phase,timeout)=>{
    phases.push(phase);assert.equal(timeout,5000);assert.equal(check(),false);
    if(phases.length===1)throw new Error('closure deadline');child.signalCode='SIGKILL';assert.equal(check(),true);return true;
  }});
  assert.deepEqual(result,{closed:true,forced:true});assert.deepEqual(killed,['SIGTERM','SIGKILL']);
  assert.deepEqual(phases,['owned app process closure','forced owned app process closure']);
  assert.deepEqual(await stopOwnedResourceProcess(child,'SIGTERM'),{closed:true,forced:false});assert.equal(killed.length,2);
  const stuck={exitCode:null,signalCode:null,kill(){}};
  await assert.rejects(stopOwnedResourceProcess(stuck,'SIGTERM',{wait:async()=>{throw new Error('still live');}}),/still live/);
  await assert.rejects(stopOwnedResourceProcess(stuck,'SIGTERM',{wait:async()=>true}),/still running/);
});
test('real browser Send reports terminal provider failure before waiting out visible-answer deadline',async()=>{
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(browserSelect));
  let sent=false;
  const api={async getConversation(){return {messages:sent?[{id:'failed-answer',role:'assistant',status:'failed',errorMessage:'Provider refused final formatter'}]:[]};}};
  const field={disabled:false,focus(){},dispatchEvent(){}};
  const send={disabled:false,textContent:'',getAttribute(){return 'Send message';},click(){sent=true;}};
  const browserDocument={querySelector(selector){return selector.startsWith('textarea')?field:undefined;},querySelectorAll(){return [send];}};
  const run=new AsyncFunction('browserWindow','browserDocument','BrowserInputEvent',`const window=browserWindow,document=browserDocument,InputEvent=BrowserInputEvent;return (async function(){${browserSend}}).apply(null,['conversation','RESOURCE_HELLO',false]);`);
  await assert.rejects(run({__resourceApi:api,__resourceIpc:[]},browserDocument,class {}),/Before first visible answer: failed: Provider refused final formatter/);
  assert.equal(sent,true);
});
test('child environment is an allowlist with dummy overrides in both lanes', () => {
  for (const lane of ['old', 'pi']) {
    const env=cleanEnvironment('/synthetic/bin', lane);
    assert.equal(env.GNEAUXGHTS_LOCAL_API_KEY, 'gneauxghts-resource-fixture-dummy');
    assert.equal(env.OPENAI_API_KEY, 'gneauxghts-resource-fixture-dummy');
    assert.equal(env.PATH, '/synthetic/bin');
    assert(!Object.hasOwn(env, 'HOME'));
    assert(!Object.hasOwn(env, 'GNEAUXGHTS_E2E_FOREGROUND'));
    assert.equal(Object.hasOwn(env, 'PI_PROTOTYPE_HTTP_FIXTURE'), lane === 'pi');
  }
});
test('actual Tauri-style locked invoke descriptor never claims installation or zero complete IPC',async()=>{
  let observed=0,calls=0;const native={};
  Object.defineProperty(native,'invoke',{value:async()=>{calls++;return 'real result';}});
  const observer=installInvokeObserver(native,()=>{observed++;return()=>{};});
  assert.equal(observer.installed,false);assert.equal(observer.verified,false);
  assert.deepEqual(observer.descriptor,{writable:false,configurable:false,enumerable:false,accessor:false});
  assert.equal(await native.invoke('get_settings'),'real result');assert.equal(calls,1);assert.equal(observed,0);
  assert.equal(observedIpcCoverage(observer,[]),'unknown');
  assert.equal(observedIpcCoverage({installed:true,verified:true},[]),'unknown');
});
test('replaceable real invoke observer preserves receiver, arguments, result and rejection',async()=>{
  const failure=new Error('native failure'),records=[];
  const native={marker:'receiver',async invoke(command,args,options){assert.equal(this.marker,'receiver');assert.deepEqual(args,{value:1});assert.deepEqual(options,{raw:true});if(command==='fail')throw failure;return {accepted:true};}};
  const observer=installInvokeObserver(native,(command,args)=>{const row={command,args};records.push(row);return(result,failed)=>Object.assign(row,{result,failed});});
  assert.equal(observer.installed,true);assert.equal(native.invoke,observer.wrapper);
  assert.deepEqual(await native.invoke('get_settings',{value:1},{raw:true}),{accepted:true});
  await assert.rejects(native.invoke('fail',{value:1},{raw:true}),error=>error===failure);
  assert.deepEqual(records.map(row=>row.failed),[false,true]);
  const rows=[{requestBytes:2,responseBytes:4}];
  assert.equal(observedIpcCoverage({...observer,verified:false},rows),'unknown');
  assert.equal(observedIpcCoverage({...observer,verified:true},rows),'complete');
  assert.equal(observedIpcCoverage({...observer,verified:true},[{requestBytes:2,responseBytes:null}]),'complete');
  assert.equal(observedIpcCoverage({...observer,verified:true,failures:1},rows),'unknown');
});
test('initial browser setup retries transient navigation using the same real idempotent setup',async()=>{
  const output={journeys:[{scenario:'startup'}]},scripts=[];
  const result=await initializeResourceWorkspace({output,phase:'initial browser setup',
    execute:async script=>{scripts.push(script);if(scripts.length===1)throw new Error('Completion handler for function call is no longer reachable');return true;},
    wait:async(check,phase,timeout)=>{assert.equal(phase,'initial browser setup');assert.equal(timeout,45000);assert.equal(await check(),false);return check();}
  });
  assert.equal(result,true);assert.equal(scripts.length,2);assert.equal(scripts[0],scripts[1]);
  assert.match(scripts[0],/Native workspace required/);assert.match(scripts[0],/createModuleInvokeObserver/);
  assert.match(scripts[0],/await api\.setDefaults/);
  assert.deepEqual(output.lastInitializeError,{phase:'initial browser setup',attempt:1,error:'Error: Completion handler for function call is no longer reachable'});
  assert.deepEqual(output.journeys,[{scenario:'startup'}]);
});
test('repeated setup failure stays failed with bounded latest error and exact phase',async()=>{
  const output={journeys:[]};let attempts=0;
  await assert.rejects(initializeResourceWorkspace({output,phase:'normal reloaded workspace',timeoutMs:30000,
    execute:async()=>{throw new Error(++attempts===1?'Native workspace required':`Real setup failed ${'x'.repeat(1000)}`);},
    wait:async(check,phase,timeout)=>{assert.equal(phase,'normal reloaded workspace');assert.equal(timeout,30000);assert.equal(await check(),false);assert.equal(await check(),false);throw new Error('Timed out waiting for normal reloaded workspace');}
  }),/Timed out waiting/);
  assert.equal(output.lastInitializeError.phase,'normal reloaded workspace');assert.equal(output.lastInitializeError.attempt,2);
  assert.match(output.lastInitializeError.error,/Real setup failed/);assert.equal(output.lastInitializeError.error.length,700);
  assert.deepEqual(output.journeys,[]);
});
test('setup cannot turn a missing readiness acknowledgement into success',async()=>{
  const output={};
  await assert.rejects(initializeResourceWorkspace({output,phase:'restart browser setup',execute:async()=>undefined,
    wait:async check=>{assert.equal(await check(),false);throw new Error('Setup deadline');}
  }),/Setup deadline/);
  assert.equal(output.lastInitializeError.phase,'restart browser setup');
  assert.match(output.lastInitializeError.error,/did not acknowledge readiness/);
});
test('reload setup refuses the previous live document before importing or admitting its API',async()=>{
  const output={};let attempts=0;
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const result=await initializeResourceWorkspace({output,phase:'normal reloaded workspace',afterTimeOrigin:100,
    execute:async(script,args)=>{
      assert.deepEqual(args,[100,undefined]);attempts++;
      if(attempts===1)return new AsyncFunction(`const performance={timeOrigin:100};${script}`)(...args);
      // The second owned document can now complete ordinary setup; the first
      // must fail at its actual epoch guard, before even attempting the import.
      return true;
    },
    wait:async check=>{assert.equal(await check(),false);return check();}
  });
  assert.equal(result,true);assert.equal(attempts,2);
  assert.match(output.lastInitializeError.error,/Previous document still mounted after reload/);
  assert.equal(output.lastInitializeError.phase,'normal reloaded workspace');
  let dispatched=false;
  await assert.rejects(initializeResourceWorkspace({output,phase:'normal reloaded workspace',afterTimeOrigin:NaN,
    execute:async()=>{dispatched=true;return true;}
  }),/Actual prior document/);
  assert.equal(dispatched,false);
});
test('omitting old digest preserves the original artifact pin',()=>artifacts(({argv})=>{
  assert.equal(OLD_SHA256,'435669a2fe3bd7b3d8baf32bff164c399a3fe68961660291a477ca6a03ce36f3');
  assert.throws(()=>parseArguments(argv),/Pinned old artifact differs/);
}));
test('explicit old digest requires exact actual artifact bytes in shared and both paired protocols',()=>artifacts(({argv,oldHash})=>{
  const pinned=[...argv,'--old-sha256',oldHash];
  assert.equal(parseArguments(pinned)['old-sha256'],oldHash);
  for(const protocol of ['compatible','responses']) {
    const options=parseParityArguments([...pinned,'--protocol',protocol]);
    assert.equal(options['old-sha256'],oldHash);assert.equal(options.protocol,protocol);
  }
  assert.throws(()=>parseArguments([...argv,'--old-sha256','0'.repeat(64)]),/Pinned old artifact differs/);
  assert.throws(()=>parseParityArguments([...argv,'--old-sha256','0'.repeat(64),'--protocol','responses']),/Pinned old artifact differs/);
}));
test('old digest override is bounded lowercase hexadecimal and cannot be repeated',()=>artifacts(({argv,oldHash})=>{
  for(const malformed of [oldHash.toUpperCase(),'a'.repeat(63),'a'.repeat(65),'g'.repeat(64),'../artifact'])
    assert.throws(()=>parseArguments([...argv,'--old-sha256',malformed]),/Invalid old binary digest/);
  assert.throws(()=>parseArguments([...argv,'--old-sha256']),/Invalid gate arguments/);
  assert.throws(()=>parseArguments([...argv,'--old-sha256',oldHash,'--old-sha256',oldHash]),/Invalid gate arguments/);
}));
