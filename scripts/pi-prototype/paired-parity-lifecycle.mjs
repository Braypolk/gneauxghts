import assert from 'node:assert/strict';

/** Only the child's recorded exit, never kill() acknowledgement, permits reading. */
export async function stopOwnedParityChild(child,{timeoutMs=5000,kill=signal=>child.kill(signal)}={}) {
  if(!child)return;
  const exited=()=>child.exitCode!==null||child.signalCode!==null;
  if(exited())return;
  let resolveExit,resolveError;
  const exit=new Promise(resolve=>{resolveExit=resolve;});
  const error=new Promise(resolve=>{resolveError=resolve;});
  const onExit=()=>resolveExit('exit'),onError=value=>resolveError(value);
  child.once('exit',onExit);child.once('error',onError);
  const wait=async()=>{
    if(exited())return true;
    let timer;
    try {
      const value=await Promise.race([exit,error,new Promise(resolve=>{timer=setTimeout(()=>resolve('timeout'),timeoutMs);})]);
      if(value instanceof Error)throw value;
      return value==='exit'||exited();
    }finally{clearTimeout(timer);}
  };
  try {
    kill('SIGTERM');if(await wait())return;
    kill('SIGKILL');assert(await wait(),'Owned native process did not exit before closed SQLite proof');
  }finally{child.removeListener('exit',onExit);child.removeListener('error',onError);}
}

/** Both effect snapshots are behind acknowledged shutdown and process exit. */
export async function proveClosedParityDuplicates({execute,cleanStop,launch,snapshot,requestCount}) {
  const state=await execute('state'),requests=requestCount();
  const portable=async phase=>{
    const receipt=await cleanStop(phase);
    assert(receipt?.ready===true&&receipt.timelinePortable===true,'Portable native shutdown required before SQLite proof');
    return receipt;
  };
  const beforeShutdown=await portable('before-duplicates');
  const before=await snapshot(state);
  await launch(state);
  assert.equal(requestCount(),requests,'Relaunch or restored state dispatched inference');
  const receipts=await execute('duplicates');
  const afterShutdown=await portable('after-duplicates');
  assert.equal(requestCount(),requests,'Duplicate Keep or shutdown dispatched inference');
  const after=await snapshot(state);
  assert.deepEqual(after,before,'Duplicate Keep changed canonical files, identities or publication effects');
  return {state,receipts,before,after,noInference:true,shutdowns:[beforeShutdown,afterShutdown]};
}
