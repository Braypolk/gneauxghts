import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import { startFixture } from './fixture.mjs';
import { waitUntil } from '../../e2e/support/nativeTransport.mjs';

const root = process.env.PI_PROTOTYPE_DATA ?? mkdtempSync(join(tmpdir(),'gneauxghts-pi-ios-gate-'));
const simulator = process.env.PI_PROTOTYPE_SIMULATOR ?? 'FBAC4D90-9149-4B49-B40D-EA5B90B7069C';
const bundle = 'com.braypolkinghorne.gneauxghts.pi-prototype';
const run = (command,args,env = {}) => {
  const result = spawnSync(command,args,{env:{...process.env,...env},encoding:'utf8'});
  if(result.status !== 0) throw new Error(`${command} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
};
if (!process.env.PI_PROTOTYPE_IOS_APP) {
  const result = spawnSync(process.execPath,['scripts/pi-prototype/run.mjs','ios'],{env:{...process.env,PI_PROTOTYPE_DATA:root},stdio:'inherit'});
  if(result.status !== 0) process.exit(result.status ?? 1);
}
const app = process.env.PI_PROTOTYPE_IOS_APP ?? join(root,'xcode/Build/Products/debug-iphonesimulator/Gneauxghts Pi Prototype.app');
const fixture = await startFixture();
let data;
try {
  // Only our separate bundle on our disposable simulator; fresh first pass.
  spawnSync('xcrun',['simctl','terminate',simulator,bundle]);
  spawnSync('xcrun',['simctl','uninstall',simulator,bundle]);
  run('xcrun',['simctl','install',simulator,app]);
  data = run('xcrun',['simctl','get_app_container',simulator,bundle,'data']);
  const path = join(data,'Library/Application Support',bundle,'PROTOTYPE-wipe-me/probe.json');
  const uiGate=!!process.env.PI_PROTOTYPE_UI_GATE;
  const uiResult=phase=>waitUntil(()=>{try{const value=JSON.parse(readFileSync(join(data,'Library/Application Support',bundle,'PROTOTYPE-wipe-me/ui-report.json'),'utf8'));return value.phase===phase && value.status && value;}catch{return false;}},`actual WKWebView UI ${phase}`,120000);
  const result = () => waitUntil(() => {
    if(!existsSync(path)) return false;
    try {const value = JSON.parse(readFileSync(path,'utf8')); return value.status && value;} catch{return false;}
  },'simulator WKWebView diagnostic',60_000);
  const launch = () => run('xcrun',['simctl','launch',simulator,bundle],{SIMCTL_CHILD_PI_PROTOTYPE_HTTP_FIXTURE:'http://127.0.0.1:1443',...(uiGate?{SIMCTL_CHILD_PI_PROTOTYPE_UI_GATE:'true'}:{})});
  launch();
  const first = await result(); assert.equal(first.status,'passed',JSON.stringify(first));
  const firstUi=uiGate?await uiResult('first'):undefined;if(firstUi)assert.equal(firstUi.status,'passed',JSON.stringify(firstUi));
  run('xcrun',['simctl','io',simulator,'screenshot',join(root,'ios-first.png')]);
  run('xcrun',['simctl','launch',simulator,'com.apple.Preferences']);await delay(750);
  const foreground=launch();await delay(750);const foregroundReport=await result();assert.equal(foregroundReport.submissionId,first.submissionId,'Foreground unexpectedly restarted diagnostic/network work');
  run('xcrun',['simctl','terminate',simulator,bundle]);
  // New submission ID proves diagnostic freshness without deleting persisted state.
  launch();
  const second = await waitUntil(async () => {
    const value = await result(); return value.submissionId !== first.submissionId && value;
  },'simulator relaunched receipt',60_000);
  assert.equal(second.status,'passed',JSON.stringify(second));
  assert(second.checks.includes('prior process submission receipt restored'));
  const secondUi=uiGate?await uiResult('relaunch'):undefined;if(secondUi)assert.equal(secondUi.status,'passed',JSON.stringify(secondUi));
  run('xcrun',['simctl','io',simulator,'screenshot',join(root,'ios-relaunch.png')]);
  writeFileSync(join(root,'ios-gate.json'),JSON.stringify({simulator,bundle,app,data,lifecycle:{backgroundApp:'com.apple.Preferences',foreground,sameSubmission:true},first,second,firstUi,secondUi,requests:fixture.requests},null,2));
  console.log(JSON.stringify({status:'passed',root,evidence:join(root,'ios-gate.json')}));
} finally {
  spawnSync('xcrun',['simctl','terminate',simulator,bundle]);
  await fixture.close();
}
