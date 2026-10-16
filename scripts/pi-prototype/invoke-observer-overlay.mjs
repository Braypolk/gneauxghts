// Opt-in measurement overlay. Importing this module starts no server or app.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const ORIGINAL_INVOKE=`async function invoke(cmd, args = {}, options) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}`;
export const OBSERVED_INVOKE=`async function invoke(cmd, args = {}, options) {
    const observer = globalThis.__piModuleInvokeObserver;
    let finish;
    try { finish = observer?.begin(cmd, args); }
    catch { try { observer.failures++; } catch {} }
    try {
        const result = await window.__TAURI_INTERNALS__.invoke(cmd, args, options);
        try { finish?.(result, false); } catch { try { observer.failures++; } catch {} }
        return result;
    } catch (error) {
        try { finish?.(undefined, true); } catch { try { observer.failures++; } catch {} }
        throw error;
    }
}`;
export const INVOKE_TRANSFORMATION_SHA256=hash(OBSERVED_INVOKE);

export function transformInvokeModule(code,expectedSha256) {
  assert.equal(hash(code),expectedSha256,'Pinned Tauri core module changed');
  assert.equal(code.split(ORIGINAL_INVOKE).length-1,1,'Exactly one original Tauri invoke function required');
  assert(!code.includes('__piModuleInvokeObserver'),'Already instrumented Tauri core module refused');
  const marker=JSON.stringify({originalCoreSha256:expectedSha256,transformationSha256:INVOKE_TRANSFORMATION_SHA256});
  const transformed=code.replace(ORIGINAL_INVOKE,`globalThis.__piInvokeOverlayLoaded = Object.freeze(${marker});\n${OBSERVED_INVOKE}`);
  return {code:transformed,originalCoreSha256:expectedSha256,transformedCoreSha256:hash(transformed),transformationSha256:INVOKE_TRANSFORMATION_SHA256};
}

/** Vite's pre-transform runs on the excluded package's actual core module,
 * including invoke uses internal to Channel and other Tauri API modules. */
export function invokeObserverPlugin({corePath,originalCoreSha256,transformedCoreSha256}) {
  return {name:'gneauxghts:measured-tauri-module-invoke',enforce:'pre',
    transform(code,id) {
      const path=id.split('?')[0];
      if(!path.endsWith('/@tauri-apps/api/core.js'))return null;
      assert.equal(realpathSync(path),corePath,'Unexpected second Tauri core module refused');
      const result=transformInvokeModule(code,originalCoreSha256);
      assert.equal(result.transformedCoreSha256,transformedCoreSha256,'Tauri transformation differs from receipt');
      return {code:result.code,map:null};
    }};
}

/** Generate a diagnostic config outside the measured source inputs. The same
 * plugin is used for both lanes; original application config is evaluated intact. */
export function createInvokeObserverConfig(source,outputRoot) {
  const outside=relative(source,outputRoot);
  assert(outside==='..'||outside.startsWith('../')||isAbsolute(outside),'Observer output must be outside source inputs');
  const baseConfig=join(source,'vite.config.js');
  assert(existsSync(baseConfig),'Original Vite JavaScript config required');
  const corePath=realpathSync(join(source,'node_modules/@tauri-apps/api/core.js'));
  const original=readFileSync(corePath,'utf8'),transformed=transformInvokeModule(original,hash(original));
  const overlayPath=fileURLToPath(import.meta.url),configurationPath=join(outputRoot,'invoke-observer.vite.config.mjs');
  const cacheDir=join(outputRoot,'invoke-observer-vite-cache');
  const contract={corePath,originalCoreSha256:transformed.originalCoreSha256,transformedCoreSha256:transformed.transformedCoreSha256};
  const configuration=`import base from ${JSON.stringify(baseConfig)};\nimport {invokeObserverPlugin} from ${JSON.stringify(overlayPath)};\nexport default async environment => {\n  const original = await (typeof base === 'function' ? base(environment) : base);\n  return {...original, cacheDir:${JSON.stringify(cacheDir)},\n    plugins:[invokeObserverPlugin(${JSON.stringify(contract)}),...(original.plugins??[])],\n    optimizeDeps:{...original.optimizeDeps,exclude:[...(original.optimizeDeps?.exclude??[]),'@tauri-apps/api']}};\n};\n`;
  writeFileSync(configurationPath,configuration,{flag:'wx',mode:0o600});
  return {...contract,transformationSha256:transformed.transformationSha256,configurationPath,cacheDir,overlayPath,
    originalConfigSha256:hash(readFileSync(baseConfig)),overlaySha256:hash(readFileSync(overlayPath)),configurationSha256:hash(configuration),
    boundary:'@tauri-apps/api/core module invoke after workspace setup',byteUnits:'UTF-8 JSON args/result proxies; actual native wire bytes unknown',
    limits:'Observer overhead applies to both lanes; direct injected bridge calls bypass this boundary; startup coverage unknown'};
}

/** Only sizes and command categories are retained; never argument/result prose. */
export function createModuleInvokeObserver(rows,now) {
  const size=value=>{try{return new TextEncoder().encode(JSON.stringify(value??null)).length;}catch{return null;}};
  const observer={failures:0,settingsProbeCalls:0,begin(command,args) {
    if(command==='chat_get_settings')observer.settingsProbeCalls++;
    const row={kind:'ipc',atMs:now(),category:command==='pi_sql'?'sqlite':command.startsWith('pi_provider')?'provider':'domain',requestBytes:size(args),responseBytes:null};
    rows().push(row);
    return(result,failed)=>{row.responseBytes=failed?null:size(result);};
  }};
  return observer;
}
