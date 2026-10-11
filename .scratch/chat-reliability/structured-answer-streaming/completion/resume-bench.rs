// THROWAWAY: explicitly authorized continuation; same 0.41 prompts, fixtures and adapter.
fn compact_answer_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["segments"],
        "properties":{"segments":{"type":"array","items":{"type":"object",
            "additionalProperties":false,"required":["text","sources"],"properties":{
                "text":{"type":"string"},"sources":{"type":"array","items":{"type":"string"}}}}}}})
}

#[test]
#[ignore = "explicit paid compact-format and streaming prototype"]
fn live_compact_streaming_prototype() {
    assert_eq!(std::env::var("GNEAUX_CITATION_LIVE").as_deref(), Ok("1"));
    let settings:Value=serde_json::from_str(&fs::read_to_string(std::env::var("GNEAUX_CITATION_SETTINGS").unwrap()).unwrap()).unwrap();
    assert_eq!(settings["provider"],"openai");
    let key=std::env::var("OPENAI_API_KEY").expect("in-memory credential");
    let corpus:Value=serde_json::from_str(&fs::read_to_string(std::env::var("GNEAUX_CITATION_CORPUS").unwrap()).unwrap()).unwrap();
    assert_eq!(corpus["cases"].as_array().unwrap().len(),4);
    let output=std::env::var("GNEAUX_LIVE_OUTPUT").unwrap();
    assert!(!std::path::Path::new(&output).exists());
    let baseline=fs::read_to_string(std::env::var("GNEAUX_CITATION_PREAMBLE").unwrap()).unwrap();
    let core=baseline.strip_suffix("Cite exact returned [S#] references; the app builds links.").unwrap();
    let verbose=core.to_string()+"Submit your answer through the final-result tool as {\"segments\":[{\"text\":\"answer text\",\"sources\":[\"S1\"]}]}. Each segment is a complete Markdown paragraph, list item, or table. Its sources apply to the claims in that segment. Use exact supplied S IDs without brackets in sources; do not write citation markers or source links in text. Use an empty sources array for text that needs no source.";
    let compact=core.to_string()+"Use final_result. Return Markdown segments; each sources list cites that segment's claims using exact S IDs. No citation markers in text; [] means unsourced.";
    let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let previous:Value=serde_json::from_str(&fs::read_to_string(std::env::var("GNEAUX_STREAM_PREVIOUS").unwrap()).unwrap()).unwrap();
    assert_eq!(previous["settings"],settings);assert_eq!(previous["corpusSnapshot"],corpus);
    let mut rows=Vec::new();
    let mut total_tokens=previous["results"].as_array().unwrap().iter().filter(|r|r["status"]=="complete").map(|r|r["usage"]["total_tokens"].as_u64().unwrap()).sum::<u64>();
    for(index,case)in corpus["cases"].as_array().unwrap().iter().enumerate(){
        let arms=if index%2==0{["verbose","compact"]}else{["compact","verbose"]};
        for arm in arms{
            assert!(total_tokens<25_000,"Observed pilot cap; no next request");
            let mut input=synthesis_input(case);let(references,sources)=production_references(&mut input);
            if let Some(done)=previous["results"].as_array().unwrap().iter().find(|r|r["status"]=="complete"&&r["caseId"]==case["id"]&&r["variant"]==arm){
                assert_eq!(done["input"],input);assert_eq!(done["citationSources"],json!(sources));
                println!("SKIP COMPLETE {} {arm}",case["id"]);continue;
            }
            let schema=if arm=="compact"{compact_answer_schema()}else{prototype_schema(&input)};
            let preamble=if arm=="compact"{&compact}else{&verbose};
            crate::agent_runtime::stream_prototype_begin(schema.clone());
            let started=Instant::now();
            let events=Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));let observed=events.clone();
            let calls=Arc::new(std::sync::atomic::AtomicUsize::new(0));let count=calls.clone();
            let cancelled=tokio_util::sync::CancellationToken::new();let cancel=cancelled.clone();
            println!("STREAM PROTOTYPE START {} {arm}",case["id"]);
            let result=runtime.block_on(AgentRuntime::run(AgentRuntimeRequest{
                provider:AgentProvider::Openai,model:settings["model"].as_str().unwrap().into(),api_key:Some(key.clone()),
                local_base_url:String::new(),output_schema:Some(schema.clone()),preamble:preamble.clone(),
                prompt:rig_core::completion::Message::user(input.to_string()),history:vec![],enable_web:false,require_web:false,
                flex:settings["service_tier"]=="flex",reasoning_effort:Some(settings["reasoning_effort"].as_str().unwrap().into()),
            },None,AgentRuntimeObserver{evidence_context:None,cancelled,permissions:None,on_event:Arc::new(move|event|{
                use crate::agent_runtime::AgentEvent;
                let kind=match event{
                    AgentEvent::TextDelta{..}=>"ordinaryTextDelta",
                    AgentEvent::StepUpdated{ref status,..}if status=="running"=>{if count.fetch_add(1,std::sync::atomic::Ordering::SeqCst)>=2{cancel.cancel();}"modelStarted"},
                    AgentEvent::UsageUpdated{..}=>"usageUpdated",AgentEvent::ModelTurnRetried{..}=>"modelTurnRetried",_=>"other"
                };observed.lock().unwrap().push(json!({"type":kind,"millis":started.elapsed().as_millis()}));
            })},AgentRunGuard::new(AgentRunLimits{max_elapsed:Duration::from_secs(90),max_aggregate_tokens:8000,max_tool_calls:2,..Default::default()})));
            let mut stream=crate::agent_runtime::stream_prototype_snapshot();
            let mut row=json!({"caseId":case["id"],"variant":arm,"input":input,"citationSources":sources,
                "schema":schema,"preamble":preamble,"latencyMillis":started.elapsed().as_millis(),"events":events.lock().unwrap().clone()});
            let failed=result.is_err();
            match result{
                Ok(answer)=>{
                    total_tokens+=answer.usage.total_tokens;
                    row["status"]=json!("complete");row["rawAnswer"]=json!(answer.output);row["usage"]=json!(answer.usage);row["modelCalls"]=json!(answer.stats.model_calls);
                    match prototype_render(&answer.output,&input,&references,&sources){
                        Ok((rendered,associations))=>{
                            let text=associations.as_array().unwrap().iter().map(|s|s["text"].as_str().unwrap()).collect::<Vec<_>>().join("\n\n");
                            let matches=stream["preview"]==text;
                            row["formatValid"]=json!(true);row["answer"]=json!(rendered);row["associations"]=associations;
                            row["streamMatchesFinal"]=json!(matches);
                            stream["terminal"]=json!({"type":if matches{"validatedFinal"}else{"replaceDraft"},"millis":started.elapsed().as_millis(),"text":text,"linksReleasedAfterValidation":true});
                        },
                        Err(error)=>{row["formatValid"]=json!(false);row["validationError"]=json!(error);stream["terminal"]=json!({"type":"rejectedFinal","text":"","links":[]});},
                    }
                },
                Err(error)=>{row["status"]=json!("failed");row["error"]=json!(error);stream["terminal"]=json!({"type":"failed","text":"","links":[]});},
            }
            row["stream"]=stream;println!("STREAM PROTOTYPE DONE {} {arm} {}",case["id"],row["status"]);
            rows.push(row);
            fs::write(&output,serde_json::to_string_pretty(&json!({"continuationOf":"../runtime.json","method":"Explicit continuation; seven unfinished answers only. Four fresh fixed-evidence pairs through actual runtime with temporary test-only observation of formatter argument deltas. Same inputs; verbose v1 vs shorter prompt/static schema v2. Decoded drafts are literal/provisional, no source links until final validation. Not native/E2E or provider-native strict schema.","settings":settings,"corpusSnapshot":corpus,"results":rows,"limits":{"answers":8,"observedPilotTokens":25000,"answerSeconds":90,"observedAnswerTokens":8000,"maxModelAttemptsPerAnswer":2,"note":"Observed limits and best-effort cancellation; stop after first provider failure, no tier fallback."}})).unwrap()).unwrap();
            assert!(!failed,"Stopped after first provider/runtime failure; artifacts retained");
        }
    }
}

// Free executable walkthrough, not a production test suite or paid request.
#[test]
#[ignore = "disposable offline stream-boundary walkthrough"]
fn offline_streaming_walkthrough(){
    let samples=[
        r#"{"segments":[{"sources":["S1"],"text":"Quotes: \"x\"; line\nslash\\; unicode \u00e9 and \ud83d\ude80."}]}"#,
        r#"{"segments":[{"text":"First","sources":["S1"]},{"sources":[],"text":"Second"}]}"#,
        r#"{"segments":[{"text":"Code: `sources` and a literal [S99].","sources":["S2"]}]}"#,
    ];
    for raw in samples{
        let value:Value=serde_json::from_str(raw).unwrap();
        let expected=value["segments"].as_array().unwrap().iter().map(|s|s["text"].as_str().unwrap()).collect::<Vec<_>>().join("\n\n");
        let mut last=String::new();
        for end in (0..=raw.len()).filter(|n|raw.is_char_boundary(*n)){
            let preview=crate::agent_runtime::prototype_partial_text(&raw[..end]).unwrap();
            assert!(expected.starts_with(&preview),"Prefix must decode only final answer text");
            assert!(preview.starts_with(&last),"No rewritten characters within one attempt");
            last=preview;
        }
        assert_eq!(last,expected);println!("Decoded every character boundary: {expected:?}");
    }
    let known=json!({"question":"Who?","context":{},"sources":[{"id":"one","title":"Approval","text":"Asha approved.","authority":"read","metadata":{}}]});
    let mut input=synthesis_input(&known);let(references,sources)=production_references(&mut input);
    for raw in [r#"{"segments":[{"text":"Asha approved.","sources":["S99"]}]}"#,r#"{"segments":[{"text":"Asha approved.","sources":["S1"]}],"extra":true}"#]{
        assert!(prototype_render(raw,&input,&references,&sources).is_err());println!("Final rejected with no links: {raw}");
    }
    let valid=r#"{"segments":[{"text":"Asha approved.","sources":["S1"]}]}"#;
    assert!(prototype_render(valid,&input,&references,&[]).is_err());
    assert!(crate::agent_runtime::prototype_partial_text(&(valid.to_string()+" garbage")).is_err());
    println!("Withdrawn source rejected; trailing garbage rejected. Draft text remains provisional until full validation.");
}
