import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeParityWorkspace} from './paired-parity-gate.mjs';

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
