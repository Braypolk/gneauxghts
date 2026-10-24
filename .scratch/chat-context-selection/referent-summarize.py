from pathlib import Path
import json, hashlib, re
root=Path(__file__).parent
correct={1:[1,0,0,1,1],2:[1,1,1,1],3:[1,1],4:[1,1,0,1,1],5:[1,1,1,1,1],6:[1,0,0,1,1],7:[1,1,1,1,1],8:[1,1,1,1,1]}
variants={1:'Fresh identities appended to old assistant messages',2:'Fresh app System reference context',3:'Unchanged confirmation of variant 2',4:'Fresh context plus explicit citation guidance; raw deltas captured',5:'Authored request placed after app metadata',6:'Unchanged confirmation of variant 5',7:'Editor hint moved to leading app System; reference groups linked to prior user request',8:'Same context layout plus admitted-only bindings and independent pre-inference validation'}
usage=[]; reviews=[]
for n in range(1,9):
 p=root/f'referent-native-{n}.json'
 if not p.exists():continue
 raw=p.read_bytes();d=json.loads(raw)
 if len(d['results'])!=len(correct[n]):continue
 sha=hashlib.sha256(raw).hexdigest();turnusage=[];turnreview=[]
 for i,r in enumerate(d['results']):
  a=r['answer'];events=[x['event'] for x in a['agentEvents']]
  aggregates=[e['aggregate'] for e in events if e['type']=='usageUpdated']
  # Each event is a cumulative per-answer snapshot, not an incremental usage record.
  aggregate=max(aggregates,key=lambda x:x['inputTokens']+x['outputTokens']) if aggregates else None
  req=[e['details'] for e in events if e['type']=='contextMeasured' and e['details']['phase']=='request']
  successful=[{'name':e['name'],'callId':e['call_id'],'title':e.get('title'),'output':e.get('output_summary')} for e in events if e['type']=='toolCallUpdated' and e['status']=='success']
  turnusage.append({'turn':i+1,'recordedAggregate':aggregate,'modelCalls':len(req),'initialComponentBytes':req[0]['componentBytes'] if req else None,'successfulTools':successful})
  links=re.findall(r'passage:([0-9a-f]+)',a['content'])
  cited=[{'id':s['passage']['id'],'noteId':s['noteId'],'title':s['title'],'excerpt':s['excerpt'],'location':s['passage']['location']} for s in a['sources'] if s.get('passage') and s['passage']['id'] in links]
  factual=bool(correct[n][i]); citation=bool(links)
  reason='Correct requested facts from the expected fresh note, with inline supporting passages.'
  if not factual:reason='Selected the rehearsal draft instead of the requested production note; AMBER-119 is a draft token. A valid draft citation does not satisfy the production follow-up.'
  elif not citation:reason='Requested facts match current acquired passages, but the delivered answer has no inline citation.'
  turnreview.append({'turn':i+1,'question':r['question'],'answer':a['content'],'requestedAnswerCorrect':factual,'inlineCitationPresent':citation,'fullySuccessful':factual and citation,'review':reason,'citedPassages':cited,'acquiredNoteTitles':sorted(set(s['title'] for s in a['sources'])),'rawStreamCaptured':bool(r.get('rawStream'))})
 totals={k:sum((t['recordedAggregate'] or {}).get(k,0) for t in turnusage) for k in ['inputTokens','outputTokens','cachedInputTokens','reasoningTokens']}
 usage.append({'trace':p.name,'sha256':sha,'variant':variants[n],'model':d['model'],'turns':turnusage,'recordedChatTotals':totals,'modelCalls':sum(t['modelCalls'] for t in turnusage)})
 diag=d['diagnostics'];before=diag.get('beforeChat',{}).get('metrics',{});after=diag.get('afterFirstAnswer',{}).get('metrics',{})
 metrics={k:after.get(k,0)-before.get(k,0) for k in ['embeddingRequestCount','embeddingRequestFailureCount','annQueryCount','annQueryCandidateTotal','annQueryRerankTotal']}
 reviews.append({'trace':p.name,'sha256':sha,'variant':variants[n],'turns':turnreview,'fullySuccessfulTurns':sum(t['fullySuccessful'] for t in turnreview),'executedTurns':len(turnreview),'nativeGates':{k:v for k,v in diag.items() if k.endswith('Supported') or k.endswith('Verified')},'firstChatSemanticMetricDeltas':metrics,'lexicalProbeHits':len(diag.get('lexicalProbe',[])),'semanticProbeMatches':[{k:h.get(k) for k in ['noteId','semanticScore','lexicalScore']} for h in diag.get('hybridProbe',[])],'structuralExecution':d['structuralExecution']})
summary={'method':'Final cumulative aggregate per recorded answer; never sum cumulative usage snapshots. Cache tokens are a subset of input. Context byte counts are pre-provider assembly measurements, not token counts.','limitations':['Recorded chat usage covers only the instrumented chat calls. This is not total provider spend.','Variants and stochastic runs differ; no general savings or reliability rate is inferred.','All unsuccessful paid attempts are retained. No dollar estimate is made.'],'attempts':usage,'recordedChatTotals':{k:sum(u['recordedChatTotals'][k] for u in usage) for k in ['inputTokens','outputTokens','cachedInputTokens','reasoningTokens']},'modelCalls':sum(u['modelCalls'] for u in usage)}
(root/'referent-usage-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
(root/'referent-manual-review.json').write_text(json.dumps({'reviewer':'Codex manual review against controlled synthetic notes and the explicit production-token mutation in the native spec','method':'Read every delivered answer and its supporting acquired/cited passage text. Separate requested-source correctness from citation presence and native structural gates. SHA256 binds judgments to retained traces.','limitations':['Small synthetic sample; no universal model guarantee.','Raw terminal model text was not captured in traces 1-3.','All included delivered answers and their acquired/cited passages were inspected; native structural gates are reported separately.'],'attempts':reviews},indent=2)+'\n')
print('attempts',len(usage),'turns',sum(len(u['turns']) for u in usage),'modelCalls',summary['modelCalls'],'recordedChatTotals',summary['recordedChatTotals'])
print('matrix',[(r['trace'],r['fullySuccessfulTurns'],r['executedTurns']) for r in reviews])
