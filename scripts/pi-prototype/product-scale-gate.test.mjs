import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planProductScaleReply,productStorageSnapshot,parseProductScaleArguments} from './product-scale-gate.mjs';
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
