// Root/native-lease execution only. Requires the explicitly integrated prebuilt
// normal-workspace iOS app; no builds or compatibility shortcuts occur here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, cpSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenerPids, waitUntil } from '../../e2e/support/nativeTransport.mjs';
import { startInteractiveFixture } from './interactive-fixture.mjs';
import { prepareIosFixture } from './ios-fixture-config.mjs';
import { sha256, assertRecoveredEffect } from './native-transcript-gate.mjs';

export function assertContainerChange(previous, next) {
  assert(previous && next && previous !== next, 'Reinstallation did not produce a distinct sandbox path; relocation remains unproved');
}
export function assertIosTranscriptReport(report, phase, launchId) {
  assert.equal(report?.gate, 'ios-native-transcript-fixture');
  assert.notEqual(report.status, 'failed', report.error); assert.equal(report.phase, phase);
  if (launchId) assert.notEqual(report.launchId, launchId, 'Relaunch did not create a new WKWebView probe');
  return report;
}
export async function runIosTranscriptGate() {
  const fixtureConfig = prepareIosFixture(process.env, listenerPids);
  assert(!process.env.PI_PROTOTYPE_DATA, 'Fresh generated simulator data only; unset PI_PROTOTYPE_DATA');
  const simulator=process.env.PI_PROTOTYPE_SIMULATOR, appPath=process.env.PI_PROTOTYPE_IOS_APP;
  assert(simulator && appPath, 'Set explicitly owned disposable simulator and prebuilt PI_PROTOTYPE_IOS_APP');
  const app=resolve(appPath), bundle='com.braypolkinghorne.gneauxghts.pi-prototype';
  const run=(command,args,extra={})=>{const value=spawnSync(command,args,{env:{...process.env,...extra},encoding:'utf8'});assert.equal(value.status,0,value.stderr||value.stdout);return value.stdout.trim();};
  const info=JSON.parse(run('plutil',['-convert','json','-o','-',join(app,'Info.plist')]));assert.equal(info.CFBundleIdentifier,bundle);
  const devices=JSON.parse(run('xcrun',['simctl','list','devices','--json'])).devices;
  const selected=Object.entries(devices).flatMap(([runtime,values])=>values.map(value=>({...value,runtime}))).find(value=>value.udid===simulator);
  assert(selected?.isAvailable&&selected.state==='Booted','Explicit simulator must already be available and booted');
  // Never uninstall a pre-existing evaluation app with unknown ownership.
  assert.notEqual(spawnSync('xcrun',['simctl','get_app_container',simulator,bundle,'data'],{encoding:'utf8'}).status,0,'Requires absent prototype bundle; preserve prior evaluation data before starting');
  const root=realpathSync(mkdtempSync(join(tmpdir(),'gneauxghts-pi-ios-transcript-'))), evidencePath=join(root,'ios-transcript-gate.json');
  const report={gate:'ios-native-transcript-relocation',status:'running',root,bundle,simulator:selected,app,fixtureUrl:fixtureConfig.url,executableSha256:sha256(readFileSync(join(app,info.CFBundleExecutable))),phases:[],screenshots:[],
    constraints:{xcode:run('xcodebuild',['-version']),sdk:run('xcrun',['--sdk','iphonesimulator','--show-sdk-version']),runtime:selected.runtime},
    limits:['Normal WKWebView controls receive programmatic events; touch gestures, physical device pressure and live providers remain unobserved.','Relocation transfers only generated app-owned roots between fresh installations of the same isolated bundle; standalone Settings-selected vault relocation is not established.']};
  let fixture,data,installed=false;
  const flush=()=>writeFileSync(evidencePath,JSON.stringify({...report,requests:fixture?.requests??[]},null,2));
  const roots=container=>({native:join(container,'Library/Application Support',bundle,'PROTOTYPE-wipe-me'),vault:join(container,'Documents/PROTOTYPE-wipe-me')});
  const install=()=>{run('xcrun',['simctl','install',simulator,app]);installed=true;data=realpathSync(run('xcrun',['simctl','get_app_container',simulator,bundle,'data']));return roots(data);};
  const launch=()=>run('xcrun',['simctl','launch',simulator,bundle],{...fixtureConfig.launchEnv,SIMCTL_CHILD_PI_PROTOTYPE_INTERACTIVE_GATE:'true',SIMCTL_CHILD_PI_PROTOTYPE_EXPANDED_GATE:'true'});
  const terminate=()=>{if(installed)spawnSync('xcrun',['simctl','terminate',simulator,bundle],{encoding:'utf8'});};
  const phase=async(name,previous)=>assertIosTranscriptReport(await waitUntil(()=>{
    try{const value=JSON.parse(readFileSync(join(roots(data).native,'ui-report.json'),'utf8'));if(value.gate==='ios-native-transcript-fixture'&&value.status==='failed')return value;return value.phase===name&&value.launchId!==previous&&value;}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return false;throw error;}
  },`actual iOS WKWebView ${name}`,180000),name,previous);
  const screenshot=name=>{const path=join(root,`${name}.png`);run('xcrun',['simctl','io',simulator,'screenshot',path]);report.screenshots.push(path);};
  const snapshot=(paths,name)=>{const value=JSON.parse(run('python3',['-B','scripts/pi-prototype/verify-ios-transcript-effects.py',paths.native,paths.vault]));writeFileSync(join(root,`${name}-native.json`),JSON.stringify(value,null,2));return value;};
  try{
    fixture=await startInteractiveFixture(fixtureConfig.port);const firstRoots=install();report.originalContainer=data;launch();
    const edit=await phase('awaiting-external-edit');report.phases.push(edit);flush();
    const transcript=edit.receipts['awaiting-external-edit'].projectionPath;
    await waitUntil(()=>{const bytes=readFileSync(transcript,'utf8');return bytes.includes(edit.receipts['awaiting-external-edit'].content)&&!bytes.includes('Thought partner · pending');},'committed native projection');
    const canonical=readFileSync(transcript,'utf8'),external=`${canonical}\n\nExternal synthetic iOS author edit preserved 11.\n`;
    const beforeConflict=fixture.requests.length;writeFileSync(transcript,external);
    const deletion=await phase('awaiting-external-delete');report.phases.push(deletion);
    assert.equal(readFileSync(transcript,'utf8'),canonical,'Conversion did not restore committed bytes');
    const copies=markdownFiles(firstRoots.vault).filter(path=>!relative(firstRoots.vault,path).startsWith(`Chats${sep}`)&&readFileSync(path,'utf8').includes('External synthetic iOS author edit preserved 11.'));
    assert.equal(copies.length,1,'Expected exactly one ordinary authored copy');assert(readFileSync(copies[0],'utf8').includes(edit.receipts['awaiting-external-edit'].content));
    assert.equal(fixture.requests.length,beforeConflict,'Convert dispatched inference');unlinkSync(transcript);
    const retained=await phase('awaiting-retained-conflict');report.phases.push(retained);
    const retainedPath=retained.receipts['awaiting-retained-conflict'].projectionPath;
    const trueConflict=`${readFileSync(retainedPath,'utf8')}\nExternal iOS conflict survives sandbox relocation 11.\n`;writeFileSync(retainedPath,trueConflict);
    const legacy=join(firstRoots.vault,'Chats/legacy-copied');mkdirSync(legacy,{recursive:true});writeFileSync(join(legacy,'Origin.md'),'# Copied legacy transcript\nNo Pi session or evidence authority is implied.\n');
    const ready=await phase('ready-to-relocate');report.phases.push(ready);assert(ready.receipts['ready-to-relocate'].close.ready&&ready.receipts['ready-to-relocate'].close.timelinePortable);
    screenshot('portable-before-relocation');terminate();
    const before=snapshot(firstRoots,'before');report.beforeNative=before;const requests=fixture.requests.length;
    // Closed app roots only; no settings or database string replacement.
    cpSync(firstRoots.native,join(root,'retained-native'),{recursive:true,errorOnExist:true,force:false});cpSync(firstRoots.vault,join(root,'retained-vault'),{recursive:true,errorOnExist:true,force:false});
    const originalContainer=data;run('xcrun',['simctl','uninstall',simulator,bundle]);installed=false;
    const secondRoots=install();report.relocatedContainer=data;assertContainerChange(originalContainer,data);
    mkdirSync(join(secondRoots.native,'..'),{recursive:true});mkdirSync(join(secondRoots.vault,'..'),{recursive:true});
    cpSync(join(root,'retained-native'),secondRoots.native,{recursive:true,errorOnExist:true,force:false});cpSync(join(root,'retained-vault'),secondRoots.vault,{recursive:true,errorOnExist:true,force:false});
    const newConflict=join(secondRoots.vault,relative(firstRoots.vault,retainedPath));assert.equal(readFileSync(newConflict,'utf8'),trueConflict);
    launch();const complete=await phase('complete',ready.launchId);report.phases.push(complete);assert.equal(complete.status,'passed',complete.error);
    assert.equal(fixture.requests.length,requests,'Relaunch, conflict resolution, Retry Keep or source navigation dispatched inference');
    screenshot('relocated-source-editor');terminate();const after=snapshot(secondRoots,'after');report.afterNative=after;
    const state=ready.receipts['ready-to-relocate'].state,key=`${state.uncertainId}:${state.uncertain.version}`;
    assertRecoveredEffect(before.effects.find(value=>value.id===key),after.effects.find(value=>value.id===key));assert.equal(before.vaultId,after.vaultId);assert.equal(before.owner,after.owner);assert.equal(after.locations.length,2);
    assert.equal(markdownFiles(secondRoots.vault).filter(path=>readFileSync(path,'utf8').includes('External synthetic iOS author edit preserved 11.')).length,1);
    assert(fixture.requests.some(value=>value.path==='/local/v1/chat/completions')&&fixture.requests.some(value=>value.path==='/openai/v1/responses'),'Both native protocols were not exercised');
    assert(!fixture.requests.some(value=>value.error),'Synthetic fixture contract failed');report.status='passed';
  }catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
  finally{terminate();flush();await fixture?.close();console.log(JSON.stringify({status:report.status,root,evidence:evidencePath,error:report.error}));}
  return report;
}
function markdownFiles(root){return readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()&&!entry.name.startsWith('.')?markdownFiles(join(root,entry.name)):entry.isFile()&&entry.name.endsWith('.md')?[join(root,entry.name)]:[]);}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runIosTranscriptGate();
