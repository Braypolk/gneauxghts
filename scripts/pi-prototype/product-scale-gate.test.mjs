import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planProductScaleReply,productStorageSnapshot,parseProductScaleArguments,stopProductScaleChild,initializeProductScaleWorkspace,reloadProductScaleWorkspace,executeProductScaleBrowser} from './product-scale-gate.mjs';
import {DUMMY_AUTHORIZATION} from './shared-resource-gate.mjs';

test('exact dummy or absent auth only; unknown and out-of-budget inputs refused',()=>{
  for(const auth of [undefined,DUMMY_AUTHORIZATION])assert.deepEqual(planProductScaleReply({messages:[{role:'user',content:'PRODUCT_SCALE_INPUT_0.'}]},auth),{index:0,text:'Synthetic product scale reply 0.'});
  assert.throws(()=>planProductScaleReply({messages:[{role:'user',content:'PRODUCT_SCALE_INPUT_0.'}]},'Bearer forbidden-placeholder'));
  for(const content of ['unrecognized','PRODUCT_SCALE_INPUT_1100.','PRODUCT_SCALE_INPUT_0. PRODUCT_SCALE_INPUT_1.'])assert.throws(()=>planProductScaleReply({messages:[{role:'user',content}]}));
});
test('a later answer requires the actual previous assistant text in request history',()=>{
  assert.throws(()=>planProductScaleReply({messages:[{role:'user',content:'PRODUCT_SCALE_INPUT_1004.'}]}));
  assert.equal(planProductScaleReply({messages:[{role:'assistant',content:[{type:'text',text:'Synthetic product scale reply 1003.'}]},{role:'user',content:[{type:'text',text:'PRODUCT_SCALE_INPUT_1004.'}]}]}).index,1004);
});
test('storage metadata measures WAL and projections without reading contents; refuses symlink escape',()=>{
  const root=mkdtempSync(join(tmpdir(),'product-scale-pure-'));
  try{mkdirSync(join(root,'nested'));for(const [name,size] of [['pi.sqlite',9],['pi.sqlite-wal',13],['pi.sqlite-shm',3],['nested/transcript.md',17],['other',5]])writeFileSync(join(root,name),Buffer.alloc(size));
    assert.deepEqual(productStorageSnapshot(root),{files:5,bytes:47,sqliteBytes:9,walBytes:13,shmBytes:3,markdownFiles:1,markdownBytes:17,otherBytes:5,allocatedBytes:null,checkpointPerformed:false});
    symlinkSync('/private/tmp',join(root,'escape'));assert.throws(()=>productStorageSnapshot(root));
  }finally{rmSync(root,{recursive:true,force:true})}
});
test('CLI refuses incomplete arguments before performing native work',()=>{
  assert.throws(()=>parseProductScaleArguments([]));assert.throws(()=>parseProductScaleArguments(['--root','relative']));
});

function ownedChild(onKill){
  const child=new EventEmitter();Object.assign(child,{exitCode:null,signalCode:null,signals:[]});
  child.kill=signal=>{child.signals.push(signal);onKill?.(child,signal);return true};return child;
}
test('signal exit is observed before kill and repeated cleanup never waits for a second exit',async()=>{
  const child=ownedChild((value,signal)=>{assert.equal(value.listenerCount('exit'),1);value.signalCode=signal;value.emit('exit',null,signal)});
  await stopProductScaleChild(child,'SIGTERM',{timeoutMs:5});
  assert.equal(child.exitCode,null);assert.equal(child.signalCode,'SIGTERM');
  await stopProductScaleChild(child,'SIGTERM',{timeoutMs:5});
  assert.deepEqual(child.signals,['SIGTERM']);assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
});
test('quiesced restart retains explicit SIGKILL and failed shutdown remains bounded',async()=>{
  const child=ownedChild((value,signal)=>{value.signalCode=signal;value.emit('exit',null,signal)});
  await stopProductScaleChild(child,'SIGKILL',{timeoutMs:5});assert.deepEqual(child.signals,['SIGKILL']);
  const stalled=ownedChild();await assert.rejects(stopProductScaleChild(stalled,'SIGTERM',{timeoutMs:5}),/did not exit/);
  assert.deepEqual(stalled.signals,['SIGTERM','SIGKILL']);assert.equal(stalled.listenerCount('exit'),0);assert.equal(stalled.listenerCount('error'),0);
});
test('navigation-invalidated setup retries the same idempotent script before admitting work',async()=>{
  const output={},scripts=[];
  await initializeProductScaleWorkspace({output,phase:'initial product browser setup',execute:async script=>{
    scripts.push(script);if(scripts.length===1)throw new Error('Completion handler for function call is no longer reachable');return true;
  },wait:async(check,phase,timeout)=>{assert.equal(phase,'initial product browser setup');assert.equal(timeout,60000);assert.equal(await check(),false);return check()}});
  assert.equal(scripts.length,2);assert.equal(scripts[0],scripts[1]);assert.match(scripts[0],/if\(!window\.__productInvoke\)/);
  assert.match(scripts[0],/Native workspace required/);assert.match(scripts[0],/await api\.setDefaults/);assert.doesNotMatch(scripts[0],/seedProductScale\(/);
  assert.deepEqual(output.lastInitializeError,{phase:'initial product browser setup',attempt:1,error:'Error: Completion handler for function call is no longer reachable'});
});
test('real readiness deadline fails closed and retains the actual setup error',async()=>{
  const output={};await assert.rejects(initializeProductScaleWorkspace({output,phase:'reloaded product browser setup',timeoutMs:15,
    execute:async()=>{throw new Error(`Native workspace required ${'x'.repeat(2500)}`)}}),/Timed out waiting for reloaded product browser setup/);
  assert.equal(output.lastInitializeError.phase,'reloaded product browser setup');assert(output.lastInitializeError.attempt>=1);
  assert.match(output.lastInitializeError.error,/Native workspace required/);assert.equal(output.lastInitializeError.error.length,2000);
  await assert.rejects(initializeProductScaleWorkspace({output,phase:'missing acknowledgement',timeoutMs:15,execute:async()=>undefined}),/Timed out waiting/);
  assert.match(output.lastInitializeError.error,/did not acknowledge readiness/);
});
test('setup retry after instrumentation installation counts each actual IPC call once',async()=>{
  let rawCalls=0,attempts=0,firstWrapper;const window={__TAURI_INTERNALS__:{invoke:async()=>{rawCalls++;return true}}};
  const api={getSettings:async()=>{await window.__TAURI_INTERNALS__.invoke('get_settings');return {}},
    setDefaults:async()=>{await window.__TAURI_INTERNALS__.invoke('set_defaults');if(++attempts===1){firstWrapper=window.__TAURI_INTERNALS__.invoke;throw new Error('Completion handler unreachable')}}};
  const load=async path=>path.endsWith('productScaleProbe.ts')?{nativeProductScaleApi:async()=>api}:{nativeTransportStats:{}};
  const execute=script=>new Function('window','document','load',`return (async()=>{${script.replaceAll('import(', 'load(')}})()`)(window,{querySelector:()=>({})},load);
  await initializeProductScaleWorkspace({execute,output:{},phase:'synthetic retry',wait:async check=>{assert.equal(await check(),false);return check()}});
  assert.equal(window.__TAURI_INTERNALS__.invoke,firstWrapper);
  await window.__TAURI_INTERNALS__.invoke('synthetic_read');
  assert.equal(rawCalls,5);assert.equal(window.__productIpc.calls,3);assert.equal(window.__productIpc.failed,0);
});
test('browser wrapper retains thrown browser error and never turns missing acknowledgement into success',async()=>{
  const wd=async(path,body)=>{assert.equal(path,'/session/synthetic-session/execute/async');return new Promise(done=>new Function(body.script).apply(null,[...body.args,done]))};
  await assert.rejects(executeProductScaleBrowser({wd,sessionId:'synthetic-session',script:'throw new Error("Native setup failed at import");'}),/Native setup failed at import/);
  assert.equal(await executeProductScaleBrowser({wd,sessionId:'synthetic-session',script:'return arguments[0];',args:[17]}),17);
  await assert.rejects(executeProductScaleBrowser({wd:async()=>undefined,sessionId:'synthetic-session',script:'return true;'}),/missing acknowledgement/);
});
test('reload cannot set up the still-mounted old document or an unmounted new document',async()=>{
  const output={},state={timeOrigin:100,mounted:true};let setups=0,navigations=0;
  const execute=async script=>new Function('performance','document',script)({timeOrigin:state.timeOrigin},{querySelector:()=>state.mounted?{}:null});
  await reloadProductScaleWorkspace({execute,output,phase:'fresh owner',navigate:async()=>{navigations++},
    setup:async()=>{assert.equal(state.timeOrigin,200);assert.equal(state.mounted,true);setups++;return true},
    wait:async(check,phase,timeout)=>{
      assert.equal(phase,'fresh owner new mounted document');assert.equal(timeout,60000);
      assert.equal(await check(),false,'Old mounted document cannot acknowledge reload');assert.equal(setups,0);
      state.timeOrigin=200;state.mounted=false;assert.equal(await check(),false,'A changed epoch alone cannot acknowledge readiness');assert.equal(setups,0);
      state.mounted=true;return check();
    }});
  assert.equal(navigations,1);assert.equal(setups,1);
  assert.deepEqual(output.reloads,[{phase:'fresh owner',fromTimeOrigin:100,toTimeOrigin:200,attempts:3}]);
});
test('missing document transition has a real bounded deadline and never runs setup',async()=>{
  const output={};let setups=0;
  await assert.rejects(reloadProductScaleWorkspace({output,phase:'unchanged document',timeoutMs:15,
    execute:async()=>({timeOrigin:100,workspaceReady:true}),navigate:async()=>{},setup:async()=>{setups++}}),/Timed out waiting for unchanged document new mounted document/);
  assert.equal(setups,0);assert.equal(output.lastReloadObservation.timeOrigin,100);assert.equal(output.reloads,undefined);
});
test('invalidated reload completion still requires a new mounted document',async()=>{
  const output={};let epoch=100,setups=0;
  await reloadProductScaleWorkspace({output,phase:'completion lost',execute:async()=>({timeOrigin:epoch,workspaceReady:true}),
    navigate:async()=>{epoch=200;throw new Error('Completion handler for function call is no longer reachable')},setup:async()=>{setups++},
    wait:async check=>check()});
  assert.equal(setups,1);assert.match(output.lastReloadCommandError.error,/Completion handler/);assert.equal(output.reloads[0].toTimeOrigin,200);
});
