// Prepared paired gate: no side effects on import. The exclusive native owner
// executes the CLI against pinned artifacts and fresh generated data roots.
import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,mkdirSync,openSync,closeSync,lstatSync,readdirSync,realpathSync } from 'node:fs';
import { resolve,join,relative,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebDriverRequest,waitUntil,listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { parseArguments,cleanEnvironment,frontendSourceDigest } from './shared-resource-gate.mjs';
import { startParityFixture,PARITY_ANSWER,PARITY_EDIT } from './paired-parity-fixture.mjs';
import { parityBrowserAction } from './paired-parity-browser.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export const PARITY_LIMITS=[
  'Prepared fixture comparisons are unproven until this driver executes both pinned native lanes.',
  'Old baseline has no request_note_access tool and production permission requirements are empty; per-read Deny/Allow once dialogs cannot be compared. Persistent approved-note grant/revoke is compared through public ChatApi, not its UI.',
  'Compatible and Responses are separate explicit runs. No live-provider, latency, memory, scale, iOS or adoption claims.',
  'Stop/restart/source-free follow-up remain in shared-resource-gate; this gate does not repeat those comparisons.',
  'Canonical proof checks unique Note Identity, accepted bytes, exact duplicate receipt, unchanged files and NoteTimeline publication counts across duplicates. It does not compare internal chat/Pi storage layouts or infer performance.'
];

export function parseParityArguments(argv) {
  const index=argv.indexOf('--protocol'),protocol=index<0?'compatible':argv[index+1];
  assert(['compatible','responses'].includes(protocol),'Explicit compatible or responses protocol required');
  const rest=index<0?argv:[...argv.slice(0,index),...argv.slice(index+2)];
  const options={...parseArguments(rest),protocol};
  const outside=path=>path==='..'||path.startsWith('../')||isAbsolute(path);
  for(const key of ['old-source','pi-source']) {
    const inside=relative(options[key],options.root),contains=relative(options.root,options[key]);
    assert(outside(inside),'Generated output must be outside source trees');
    assert(outside(contains),'Generated output must not contain source trees');
  }
  if(protocol==='responses')assert(readFileSync(options['old-binary']).includes(Buffer.from('GNEAUXGHTS_OPENAI_FIXTURE_URL')),'Old artifact must contain the loopback Responses fixture override; never fall through to a real provider');
  return options;
}

export function canonicalSnapshot(paths,generatedRoot) {
  const root=realpathSync(generatedRoot),result={};
  for(const path of [...new Set(paths)].sort()) {
    assert(isAbsolute(path),'Canonical note path required');
    const stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink(),'Canonical note must be an ordinary file');
    const actual=realpathSync(path),rel=relative(root,actual);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Receipt escaped generated lane');
    const raw=readFileSync(path),text=raw.toString('utf8');
    const frontmatter=text.startsWith('---\n')?text.slice(4).split('\n---',1)[0]:'';
    const identity=frontmatter.match(/^  id: ([^\n]+)$/m)?.[1];assert(identity,'Managed Note Identity absent');
    result[actual]={sha256:sha(raw),identity,bytes:raw.length};
  }
  return result;
}

export function canonicalIdentityCounts(root,identities) {
  const counts=Object.fromEntries([...new Set(identities)].map(id=>[id,0]));
  const visit=path=>{
    const stat=lstatSync(path);assert(!stat.isSymbolicLink(),'Generated data symlink refused');
    if(stat.isDirectory())for(const name of readdirSync(path))visit(join(path,name));
    else if(stat.isFile()&&path.endsWith('.md')) {
      const text=readFileSync(path,'utf8'),frontmatter=text.startsWith('---\n')?text.slice(4).split('\n---',1)[0]:'';
      const identity=frontmatter.match(/^  id: ([^\n]+)$/m)?.[1];if(Object.hasOwn(counts,identity))counts[identity]++;
    }
  };visit(root);return counts;
}

export async function runPairedParityGate(options) {
  for(const port of [1430,1442,1443,4445])assert.equal(listenerPids(port).length,0,'Required port belongs to another owner');
  mkdirSync(options.root,{mode:0o700});
  const preparedSources=['paired-parity-gate.mjs','paired-parity-fixture.mjs','paired-parity-browser.mjs','paired-parity-effects.py'];
  const fixture=await startParityFixture(),report={schema:'gneauxghts-paired-parity-v1',status:'running',protocol:options.protocol,lanes:[],limits:PARITY_LIMITS,verdict:'unproven',
    driverSources:Object.fromEntries(preparedSources.map(name=>[name,sha(readFileSync(fileURLToPath(new URL(name,import.meta.url))))]))};
  try {
    for(const lane of(options.first==='pi'?['pi','old']:['old','pi'])) {
      const source=options[`${lane}-source`],binary=options[`${lane}-binary`],laneRoot=join(options.root,lane),data=join(laneRoot,'data');
      mkdirSync(laneRoot,{mode:0o700});mkdirSync(data,{mode:0o700});fixture.setLane(lane);
      const env={...cleanEnvironment(process.env.PATH,lane),GNEAUXGHTS_OPENAI_FIXTURE_URL:'http://127.0.0.1:1443/openai/v1'};
      const port=lane==='old'?1430:1442;
      const output={lane,status:'running',binarySha256:sha(readFileSync(binary)),frontendSourceSha256:frontendSourceDigest(source),lockfileSha256:sha(readFileSync(join(source,'pnpm-lock.yaml'))),checks:[]};report.lanes.push(output);
      const wd=createWebDriverRequest(4445,60000);let server,app,session;
      const execute=async(action,args={})=>{
        const result=await wd(`/session/${session.sessionId}/execute/async`,{script:`const done=arguments[arguments.length-1];(${parityBrowserAction.toString()})(arguments[0],arguments[1]).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error).slice(0,700)}));`,args:[action,args]});
        assert(result.ok,`Owned ${lane} browser action ${action} failed: ${result.error??'unknown'}`);return result.value;
      };
      try {
        let fd=openSync(join(laneRoot,'frontend.log'),'a',0o600);server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:source,env,stdio:['ignore',fd,fd],detached:true});closeSync(fd);
        await waitUntil(async signal=>(await fetch(`http://127.0.0.1:${port}/`,{signal})).ok,'owned frontend',30000);
        fd=openSync(join(laneRoot,'native.log'),'a',0o600);app=spawn(binary,['--e2e-app-data-root',data,'--e2e-documents-root',data],{cwd:source,env,stdio:['ignore',fd,fd]});closeSync(fd);
        await waitUntil(async()=>{try{return(await wd('/status',undefined,'GET')).ready}catch{return false;}},'owned native driver',30000);
        session=await wd('/session',{capabilities:{alwaysMatch:{browserName:'tauri'}}});await wd(`/session/${session.sessionId}/timeouts`,{script:60000});
        await waitUntil(async()=>{try{return await execute('initialize',{protocol:options.protocol})}catch{return false;}},'normal native workspace',45000);
        const seeded=await execute('seed');
        await wd(`/session/${session.sessionId}/execute/sync`,{script:'location.reload();return true',args:[]});
        await waitUntil(async()=>{try{return await execute('initialize',{protocol:options.protocol,state:seeded})}catch{return false;}},'reloaded normal workspace',45000);
        for(const action of ['evidence','grants','review','save']) {
          const before=fixture.requests.length;
          const proof=await execute(action,{answer:PARITY_ANSWER,edit:PARITY_EDIT});
          output.checks.push({scenario:action,status:'passed',proof,providerDispatches:fixture.requests.length-before});
        }
        const state=await execute('state'),paths=state.kept.map(value=>value.draft.path),before=canonicalSnapshot(paths,data),beforeRequests=fixture.requests.length;
        const expected={};for(const path of paths){const identity=before[realpathSync(path)].identity;expected[identity]=(expected[identity]??0)+1;}
        const effects=()=>JSON.parse(execFileSync('python3',['-B',fileURLToPath(new URL('./paired-parity-effects.py',import.meta.url))],{input:JSON.stringify({root:data,expected}),encoding:'utf8',timeout:10000}));
        const beforeEffects=effects();
        const receipts=await execute('duplicates'),after=canonicalSnapshot(paths,data);
        assert.deepEqual(after,before,'Duplicate Keep changed canonical files');assert.equal(fixture.requests.length,beforeRequests,'Keep dispatched inference');
        const afterEffects=effects();assert.deepEqual(afterEffects,beforeEffects,'Duplicate Keep published another canonical effect');
        const counts=canonicalIdentityCounts(data,receipts.map(value=>value.noteId));assert(Object.values(counts).every(count=>count===1),'Duplicate canonical Note Identity');
        output.checks.push({scenario:'duplicates',status:'passed',receipts,canonicalFiles:after,identityCounts:counts,noInference:true,publicationEffectCounts:afterEffects});
        assert(!fixture.requests.some(row=>row.lane===lane&&row.failed),'Fixture dialect refused');
        output.status='passed-prepared-subset';
      } catch(error) {output.status='failed';output.error=String(error).slice(0,1200);}
      finally {
        if(session){try{writeFileSync(join(laneRoot,'last.png'),Buffer.from(await wd(`/session/${session.sessionId}/screenshot`,undefined,'GET'),'base64'));}catch{}try{await wd(`/session/${session.sessionId}`,undefined,'DELETE');}catch{}}
        if(app&&app.exitCode===null){app.kill('SIGTERM');await Promise.race([new Promise(ok=>app.once('exit',ok)),delay(5000)]);if(app.exitCode===null){app.kill('SIGKILL');await Promise.race([new Promise(ok=>app.once('exit',ok)),delay(5000)]);}}
        if(server){try{process.kill(-server.pid,'SIGTERM');}catch{}await Promise.race([new Promise(ok=>server.once('exit',ok)),delay(5000)]);if(server.exitCode===null){try{process.kill(-server.pid,'SIGKILL');}catch{}}}
      }
      assert.equal(sha(readFileSync(binary)),output.binarySha256,'Native artifact changed');assert.equal(frontendSourceDigest(source),output.frontendSourceSha256,'Frontend changed during parity run');
    }
    report.status=report.lanes.length===2&&report.lanes.every(lane=>lane.status==='passed-prepared-subset')?'passed-prepared-subset':'failed';
    report.verdict=report.status==='passed-prepared-subset'?'shared-observable-subset-passed':'unproven';
  } catch(error) {report.status='failed';report.error=String(error).slice(0,1200);}
  finally {report.providerRequests=fixture.requests;await fixture.close();writeFileSync(join(options.root,'paired-parity-gate.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const report=await runPairedParityGate(parseParityArguments(process.argv.slice(2)));console.log(JSON.stringify({status:report.status,verdict:report.verdict}));if(report.status==='failed')process.exitCode=1;}
  catch(error){console.error(`Paired parity gate refused: ${String(error).slice(0,700)}`);process.exitCode=1;}
}
