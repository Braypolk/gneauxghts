import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {ORIGINAL_INVOKE,OBSERVED_INVOKE,transformInvokeModule,invokeObserverPlugin,createInvokeObserverConfig,createModuleInvokeObserver} from './invoke-observer-overlay.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const corePath=realpathSync(new URL('../../node_modules/@tauri-apps/api/core.js',import.meta.url).pathname);
const original=readFileSync(corePath,'utf8');

test('exact pinned Tauri module transform refuses changed source, duplicate function and wrong module',()=>{
  const result=transformInvokeModule(original,hash(original));
  assert.notEqual(result.transformedCoreSha256,result.originalCoreSha256);
  assert(result.code.includes(OBSERVED_INVOKE));assert(!result.code.includes(ORIGINAL_INVOKE));
  assert.throws(()=>transformInvokeModule(original+'\n',hash(original)),/Pinned Tauri core module changed/);
  for(const code of [original.replace(ORIGINAL_INVOKE,'function changed() {}'),original+'\n'+ORIGINAL_INVOKE])
    assert.throws(()=>transformInvokeModule(code,hash(code)),/Exactly one original/);
  const plugin=invokeObserverPlugin({corePath,originalCoreSha256:hash(original),transformedCoreSha256:result.transformedCoreSha256});
  assert.equal(plugin.transform('untouched','/source/application.ts'),null);
  assert.equal(plugin.transform(original,corePath+'?v=fixture').code,result.code);
});

test('actual transformed core module observes exported and internal invokes against the untouched locked native bridge',async()=>{
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const previousObserver=Object.getOwnPropertyDescriptor(globalThis,'__piModuleInvokeObserver');
  const previousMarker=Object.getOwnPropertyDescriptor(globalThis,'__piInvokeOverlayLoaded');
  const rows=[],calls=[],result={real:'native result'},failure=new Error('native rejection');
  let epochRows=rows;
  const native={};
  Object.defineProperty(native,'invoke',{value:async function(command,args,options){
    assert.equal(this,native);calls.push({command,args,options});if(command==='fail')throw failure;return result;
  }});
  try {
    globalThis.window={__TAURI_INTERNALS__:native};
    const transformed=transformInvokeModule(original,hash(original));
    // Use the actual published core module. Only its relative tslib import is
    // made absolute for Node's data-URL loader; no application API mirror exists.
    const source=transformed.code.replace("'./external/tslib/tslib.es6.js'",JSON.stringify(pathToFileURL(join(dirname(corePath),'external/tslib/tslib.es6.js')).href));
    const core=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.equal(globalThis.__piInvokeOverlayLoaded.originalCoreSha256,hash(original));
    const observer=createModuleInvokeObserver(()=>epochRows,()=>20);
    globalThis.__piModuleInvokeObserver=observer;
    const args={synthetic:'hello'},options={headers:{test:'fixture'}};
    assert.equal(await core.invoke('chat_get_settings',args,options),result);
    assert.equal(calls[0].args,args);assert.equal(calls[0].options,options);
    assert.equal(observer.settingsProbeCalls,1);assert.equal(rows.length,1);
    assert.equal(rows[0].requestBytes,Buffer.byteLength(JSON.stringify(args)));
    assert.equal(rows[0].responseBytes,Buffer.byteLength(JSON.stringify(result)));
    // Resource.close reaches the same lexical invoke inside core itself; an
    // application-level replacement would miss this internal API call.
    await new core.Resource(17).close();
    assert.equal(calls[1].command,'plugin:resources|close');assert.equal(rows.length,2);
    await assert.rejects(core.invoke('fail',{}),error=>error===failure);
    assert.equal(rows[2].responseBytes,null);
    assert.deepEqual(Object.keys(rows[0]).sort(),['atMs','category','kind','requestBytes','responseBytes']);
    assert.equal(Object.getOwnPropertyDescriptor(native,'invoke').writable,false);
    epochRows=[];await core.invoke('pi_sql',{operation:'fixture'});
    assert.equal(rows.length,3);assert.equal(epochRows.length,1);assert.equal(epochRows[0].category,'sqlite');
    assert.equal(observer.failures,0);
  } finally {
    for(const [key,descriptor] of [['window',previousWindow],['__piModuleInvokeObserver',previousObserver],['__piInvokeOverlayLoaded',previousMarker]])
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

test('observer failure cannot replace the real native result or rejection',async()=>{
  const failure=new Error('exact native failure'),observer={failures:0,begin(){throw new Error('observer failed');}};
  let calls=0;
  const native={async invoke(command){calls++;if(command==='fail')throw failure;return 42;}};
  const invoke=new Function('window','globalThis',OBSERVED_INVOKE+';return invoke;')({__TAURI_INTERNALS__:native},{__piModuleInvokeObserver:observer});
  assert.equal(await invoke('success'),42);
  await assert.rejects(invoke('fail'),error=>error===failure);
  assert.equal(calls,2);assert.equal(observer.failures,2);
});

test('generated external config retains original async config and plugins, excludes all Tauri API submodules, and pins provenance',async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'pi-invoke-overlay-test-'))),source=join(root,'source'),output=join(root,'diagnostic');
  try {
    mkdirSync(join(source,'node_modules/@tauri-apps/api'),{recursive:true});mkdirSync(output);
    writeFileSync(join(source,'node_modules/@tauri-apps/api/core.js'),original);
    writeFileSync(join(source,'vite.config.js'),`export default async env=>({plugins:[{name:'original-plugin'}],server:{port:1420,hmr:false},custom:env.mode,optimizeDeps:{exclude:['existing-package'],include:['other']}});`);
    writeFileSync(join(source,'package.json'),'{"type":"module"}');
    const before=readFileSync(join(source,'vite.config.js'));
    const receipt=createInvokeObserverConfig(source,output);
    const config=await (await import(pathToFileURL(receipt.configurationPath).href)).default({mode:'test'});
    assert.deepEqual(config.plugins.map(plugin=>plugin.name),['gneauxghts:measured-tauri-module-invoke','original-plugin']);
    assert.deepEqual(config.server,{port:1420,hmr:false});assert.equal(config.custom,'test');
    assert.deepEqual(config.optimizeDeps.exclude,['existing-package','@tauri-apps/api']);assert.deepEqual(config.optimizeDeps.include,['other']);
    assert.equal(config.cacheDir,join(output,'invoke-observer-vite-cache'));
    for(const [path,digest] of [[receipt.configurationPath,receipt.configurationSha256],[receipt.overlayPath,receipt.overlaySha256],[receipt.corePath,receipt.originalCoreSha256]])
      assert.equal(hash(readFileSync(path)),digest);
    assert.deepEqual(readFileSync(join(source,'vite.config.js')),before);
    const pinnedPlugin=invokeObserverPlugin({corePath,originalCoreSha256:hash(original),transformedCoreSha256:transformInvokeModule(original,hash(original)).transformedCoreSha256});
    assert.throws(()=>pinnedPlugin.transform(original,receipt.corePath),/Unexpected second Tauri core module/);
    assert.throws(()=>createInvokeObserverConfig(source,source),/outside source inputs/);
    assert.throws(()=>createInvokeObserverConfig(source,output),/EEXIST/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
