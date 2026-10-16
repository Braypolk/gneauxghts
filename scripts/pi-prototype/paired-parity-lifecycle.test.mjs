import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {proveClosedParityDuplicates,stopOwnedParityChild} from './paired-parity-lifecycle.mjs';
import {parityBrowserAction} from './paired-parity-browser.mjs';

function scenario() {
  const state={kept:[{id:'review1',draft:{markdown:'accepted',version:5,path:'/generated/Plan.md'}}],savedNoteId:'saved',source:{noteId:'source'},full:'full',approved:'approved'};
  const steps=[];let alive=true,requests=4;
  const input={
    execute:async action=>{steps.push(action);assert(alive);return action==='state'?structuredClone(state):[{noteId:'saved'}];},
    cleanStop:async phase=>{steps.push(phase);alive=false;return {ready:true,timelinePortable:true};},
    snapshot:async restored=>{steps.push('snapshot');assert.equal(alive,false,'Never copy/read live SQLite');assert.deepEqual(restored,state);return {files:{sha:'unchanged'},effects:{saved:2}};},
    launch:async restored=>{steps.push('launch');assert.equal(alive,false);assert.deepEqual(restored,state);alive=true;},
    requestCount:()=>requests
  };
  return {input,steps,state,dispatch:()=>requests++};
}
test('portable stops precede both proofs; fresh session receives the complete captured state',async()=>{
  const {input,steps,state}=scenario();const proof=await proveClosedParityDuplicates(input);
  assert.deepEqual(steps,['state','before-duplicates','snapshot','launch','duplicates','after-duplicates','snapshot']);
  assert.deepEqual(proof.state,state);assert.equal(proof.noInference,true);assert.deepEqual(proof.before,proof.after);
});
test('failed portability cannot produce a snapshot or relaunch',async()=>{
  const {input,steps}=scenario();input.cleanStop=async()=>({ready:true,timelinePortable:false});
  await assert.rejects(proveClosedParityDuplicates(input),/Portable native shutdown/);
  assert.deepEqual(steps,['state']);
});
test('restoration inference refuses duplicate actions; duplicate inference cannot pass',async()=>{
  const first=scenario(),launch=first.input.launch;
  first.input.launch=async state=>{await launch(state);first.dispatch();};
  await assert.rejects(proveClosedParityDuplicates(first.input),/restored state dispatched inference/);
  assert(!first.steps.includes('duplicates'));
  const second=scenario(),execute=second.input.execute;
  second.input.execute=async action=>{const result=await execute(action);if(action==='duplicates')second.dispatch();return result;};
  await assert.rejects(proveClosedParityDuplicates(second.input),/Duplicate Keep or shutdown dispatched inference/);
  assert.equal(second.steps.filter(step=>step==='snapshot').length,1);
});
function child() {
  const value=new EventEmitter();value.exitCode=null;value.signalCode=null;value.signals=[];
  value.kill=signal=>{value.signals.push(signal);return true;};return value;
}
test('soft kill acknowledgement does not count as exit; forced owned exit is bounded',async()=>{
  const process=child();process.kill=signal=>{process.signals.push(signal);if(signal==='SIGKILL'){process.signalCode=signal;process.emit('exit',null,signal);}return true;};
  await stopOwnedParityChild(process,{timeoutMs:5});assert.deepEqual(process.signals,['SIGTERM','SIGKILL']);
  assert.equal(process.listenerCount('exit'),0);
});
test('unexited process fails closed, while already signalled exit is accepted without another kill',async()=>{
  const process=child();await assert.rejects(stopOwnedParityChild(process,{timeoutMs:5}),/did not exit/);
  assert.equal(process.listenerCount('exit'),0);
  process.signalCode='SIGTERM';await stopOwnedParityChild(process);assert.deepEqual(process.signals,['SIGTERM','SIGKILL']);
});
test('serialized browser shutdown invokes the retained native preparation command',async()=>{
  const previous=globalThis.window,calls=[],receipt={ready:true,timelinePortable:true};
  globalThis.window={__pairedParity:{state:{kept:[]},invoke:async command=>{calls.push(command);return receipt;}}};
  try{assert.deepEqual(await parityBrowserAction('quiesce'),receipt);assert.deepEqual(calls,['prepare_restart']);}
  finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
