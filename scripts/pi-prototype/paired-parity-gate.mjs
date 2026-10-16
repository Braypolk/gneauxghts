// Prepared paired gate: no side effects on import. The exclusive native owner
// executes the CLI against pinned artifacts and fresh generated data roots.
import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,mkdirSync,openSync,closeSync,lstatSync,readdirSync,realpathSync } from 'node:fs';
import { resolve,join,relative,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebDriverRequest,waitUntil,listenerPids } from '../../e2e/support/nativeTransport.mjs';
import { parseArguments,cleanEnvironment,frontendSourceDigest } from './shared-resource-gate.mjs';
import { startParityFixture,PARITY_ANSWER,PARITY_EDIT } from './paired-parity-fixture.mjs';
import { parityBrowserAction, reviewedTitlePlan } from './paired-parity-browser.mjs';
import { proveClosedParityDuplicates,stopOwnedParityChild } from './paired-parity-lifecycle.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export const PARITY_LIMITS=[
  'Prepared fixture comparisons are unproven until this driver executes both pinned native lanes.',
  'Old baseline has no request_note_access tool and production permission requirements are empty; per-read Deny/Allow once dialogs cannot be compared. Persistent approved-note grant/revoke is compared through public ChatApi, not its UI.',
  'Both lanes edit the review body. Proposal title editing follows each normal UI capability: editable titles change, while read-only baseline titles remain original and are recorded per lane. No DOM override or API title bypass is used.',
  'Compatible and Responses are separate explicit runs. No live-provider, latency, memory, scale, iOS or adoption claims.',
  'Stop/source-free follow-up remain in shared-resource-gate; this gate checks portable shutdown and no-inference restoration only to establish closed canonical effect snapshots.',
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

export async function initializeParityWorkspace({execute,args,output,phase,wait=waitUntil}) {
  let attempt=0;
  return wait(async()=>{
    attempt++;
    try{return await execute('initialize',args);}
    catch(error){
      output.lastInitializeError={phase,attempt,error:String(error).slice(0,700)};
      return false;
    }
  },phase,45000);
}

export async function runPairedParityGate(options) {
  for(const port of [1430,1442,1443,4445])assert.equal(listenerPids(port).length,0,'Required port belongs to another owner');
  mkdirSync(options.root,{mode:0o700});
  const preparedSources=['paired-parity-gate.mjs','paired-parity-fixture.mjs','paired-parity-browser.mjs','paired-parity-lifecycle.mjs','paired-parity-effects.py','closed_sqlite_read.py'];
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
        assert(session,'Fresh owned WebDriver session required');
        const result=await wd(`/session/${session.sessionId}/execute/async`,{script:`const done=arguments[arguments.length-1];const reviewedTitlePlan=(${reviewedTitlePlan.toString()});(${parityBrowserAction.toString()})(arguments[0],arguments[1]).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error).slice(0,700)}));`,args:[action,args]});
        assert(result.ok,`Owned ${lane} browser action ${action} failed: ${result.error??'unknown'}`);return result.value;
      };
      const stopNative=async()=>{
        const previous=session;session=undefined;
        if(previous)try{await wd(`/session/${previous.sessionId}`,undefined,'DELETE');}catch(error){(output.sessionCleanupWarnings??=[]).push(String(error).slice(0,500));}
        await stopOwnedParityChild(app);app=undefined;
        await waitUntil(()=>listenerPids(4445).length===0,'owned native driver port release',10000);
      };
      let launchCount=0;
      const launch=async state=>{
        assert(!app&&!session,'Previous owned native process/session must be closed before relaunch');
        assert.equal(listenerPids(4445).length,0,'Driver port was acquired by another owner');
        const fd=openSync(join(laneRoot,'native.log'),'a',0o600);
        app=spawn(binary,['--e2e-app-data-root',data,'--e2e-documents-root',data],{cwd:source,env,stdio:['ignore',fd,fd]});closeSync(fd);
        let failure;const launched=app;app.once('error',error=>{failure=error;});
        await waitUntil(async()=>{if(failure)throw failure;assert(launched.exitCode===null&&launched.signalCode===null,'Owned native process exited before driver readiness');try{return(await wd('/status',undefined,'GET')).ready}catch{return false;}},'owned native driver',30000);
        session=await wd('/session',{capabilities:{alwaysMatch:{browserName:'tauri'}}});await wd(`/session/${session.sessionId}/timeouts`,{script:60000});
        await initializeParityWorkspace({execute,args:{protocol:options.protocol,...(state?{state}:{})},output,phase:'normal native workspace'});
        if(state)assert.deepEqual(await execute('state'),state,'Relaunch did not restore full captured parity state');
        output.launches=++launchCount;
      };
      const cleanStop=async phase=>{
        const receipt=await execute('quiesce');
        assert(receipt?.ready===true&&receipt.timelinePortable===true,'Native prepare_restart did not establish portable closed state');
        try{writeFileSync(join(laneRoot,`${phase}.png`),Buffer.from(await wd(`/session/${session.sessionId}/screenshot`,undefined,'GET'),'base64'));}catch{}
        await stopNative();return receipt;
      };
      try {
        const fd=openSync(join(laneRoot,'frontend.log'),'a',0o600);server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:source,env,stdio:['ignore',fd,fd],detached:true});closeSync(fd);
        let frontendFailure;server.once('error',error=>{frontendFailure=error;});
        await waitUntil(async signal=>{if(frontendFailure)throw frontendFailure;assert(server.exitCode===null&&server.signalCode===null,'Owned frontend exited before readiness');return(await fetch(`http://127.0.0.1:${port}/`,{signal})).ok;},'owned frontend',30000);
        await launch();
        const seeded=await execute('seed');
        await wd(`/session/${session.sessionId}/execute/sync`,{script:'location.reload();return true',args:[]});
        await initializeParityWorkspace({execute,args:{protocol:options.protocol,state:seeded},output,phase:'reloaded normal workspace'});
        for(const action of ['evidence','grants','review','save']) {
          const before=fixture.requests.length;
          const proof=await execute(action,{answer:PARITY_ANSWER,edit:PARITY_EDIT});
          if(action==='review'){output.reviewedTitle=proof.reviewedTitle;output.draftTitleEditable=proof.draftTitleEditable;output.titleEditing=proof.titleEditing;}
          output.checks.push({scenario:action,status:'passed',proof,providerDispatches:fixture.requests.length-before});
        }
        const proof=await proveClosedParityDuplicates({execute,cleanStop,launch,requestCount:()=>fixture.requests.length,snapshot:state=>{
          assert(!app&&!session,'Closed SQLite proof requires exited owned native process');
          const paths=state.kept.map(value=>value.draft.path),canonicalFiles=canonicalSnapshot(paths,data),expected={};
          for(const path of paths){const identity=canonicalFiles[realpathSync(path)].identity;expected[identity]=(expected[identity]??0)+1;}
          const publicationEffectCounts=JSON.parse(execFileSync('python3',['-B',fileURLToPath(new URL('./paired-parity-effects.py',import.meta.url))],{input:JSON.stringify({root:data,expected}),encoding:'utf8',timeout:10000}));
          const identityCounts=canonicalIdentityCounts(data,Object.keys(expected));assert(Object.values(identityCounts).every(count=>count===1),'Duplicate canonical Note Identity');
          return {canonicalFiles,identityCounts,publicationEffectCounts};
        }});
        output.checks.push({scenario:'duplicates',status:'passed',...proof});
        assert(!fixture.requests.some(row=>row.lane===lane&&row.failed),'Fixture dialect refused');
        output.status='passed-prepared-subset';
      } catch(error) {output.status='failed';output.error=String(error).slice(0,1200);}
      finally {
        if(session)try{writeFileSync(join(laneRoot,'last.png'),Buffer.from(await wd(`/session/${session.sessionId}/screenshot`,undefined,'GET'),'base64'));}catch{}
        try{await stopNative();}catch(error){output.status='failed';output.cleanupError=String(error).slice(0,700);}
        if(server)try{await stopOwnedParityChild(server,{kill:signal=>{try{process.kill(-server.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}}});}catch(error){output.status='failed';output.frontendCleanupError=String(error).slice(0,700);}
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
