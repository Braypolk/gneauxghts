use super::*;
use crate::agent_tools::interface::{NoteChangeArgs, ReadNotesArgs};

async fn read(context: &AgentToolContext, args: Value) -> Value {
    ReadNotesTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value::<ReadNotesArgs>(args).unwrap(),
        )
        .await
        .unwrap()
}
async fn change(context: &AgentToolContext, args: Value) -> Value {
    ProposeNoteChangeTool(context.clone())
        .call(
            &mut ToolContext::new(),
            serde_json::from_value::<NoteChangeArgs>(args).unwrap(),
        )
        .await
        .unwrap()
}

#[test]
fn proposal_commit_repairs_retained_identity_but_preserves_later_external_changes() {
    for change_after_review in [false, true] {
        let (vault, context, id) = fixture();
        let (path, _, _) = context.resolve_note(&id).unwrap();
        let damaged = "Current content without managed metadata";
        fs::write(&path, damaged).unwrap();
        let now = crate::time::current_time_millis().unwrap();
        vault
            .state
            .note_timeline()
            .observe(
                crate::services::note_timeline::VaultObservation::external_edit(
                    path.clone(),
                    now,
                    Some(now),
                ),
            )
            .unwrap();
        vault
            .state
            .upsert_note_indexes(
                path.clone(),
                crate::index::build_indexed_note(&path, damaged, now),
            )
            .unwrap();
        assert_eq!(
            vault.state.indexed_note_identity(&path).unwrap().as_deref(),
            Some(id.as_str())
        );

        let current = tauri::async_runtime::block_on(read(
            &context,
            json!({
                "purpose":"edit", "note_id":id,
            }),
        ));
        let proposal = tauri::async_runtime::block_on(change(
            &context,
            json!({
                "operation":"replace", "note_id":id,
                "expected_content_hash":current["contentHash"], "markdown":"Reviewed replacement",
            }),
        ));
        assert_eq!(proposal["status"], "pending_review");
        if change_after_review {
            fs::write(&path, "Later external change").unwrap();
        }
        let result = crate::commands::proposal_commands::commit_agent_proposal_with_state(
            &vault.state,
            &context.service,
            proposal["proposalId"].as_str().unwrap().into(),
            None,
        )
        .unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        if change_after_review {
            assert_eq!(result.status, "conflict");
            assert_eq!(raw, "Later external change");
        } else {
            assert_eq!(result.status, "committed");
            assert_eq!(result.note_id.as_deref(), Some(id.as_str()));
            assert_eq!(
                result.committed_markdown.as_deref(),
                Some("Reviewed replacement")
            );
            assert_eq!(
                crate::note::parse_note(&raw)
                    .frontmatter
                    .managed
                    .unwrap()
                    .id,
                id
            );
        }
    }
}

fn registry(context: AgentToolContext) -> Vec<rig_core::completion::ToolDefinition> {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let model = MockCompletionModel::from_stream_turns([vec![
        MockStreamEvent::text("done"),
        MockStreamEvent::final_response(rig_core::completion::Usage::new()),
    ]]);
    tauri::async_runtime::block_on(crate::agent_runtime::measure_test_model(
        model.clone(),
        request(),
        Some(context),
        crate::agent_runtime::AgentRuntimeObserver {
            evidence_context: None,
            cancelled: tokio_util::sync::CancellationToken::new(),
            permissions: None,
            on_event: Arc::new(|_| {}),
        },
    ))
    .unwrap();
    model.requests()[0].tools.clone()
}

#[test]
fn model_registry_has_five_tools_and_worker_cannot_access_edit_branches() {
    let (_vault, context, id) = fixture();
    let mut names: Vec<_> = registry(context.clone())
        .into_iter()
        .map(|t| t.name)
        .collect();
    names.sort();
    assert_eq!(
        names,
        [
            "find_notes",
            "propose_note_change",
            "read_notes",
            "research_notes",
            "update_plan"
        ]
    );
    let mut worker = context.clone();
    worker.capabilities = context.capabilities.restricted_to(&[Capability::Evidence]);
    let tools = registry(worker.clone());
    assert_eq!(tools.len(), 2);
    let read_tool = tools.iter().find(|t| t.name == "read_notes").unwrap();
    assert!(!read_tool.parameters.to_string().contains("\"edit\""));
    assert!(!ReadNotesTool(worker.clone())
        .description()
        .contains("purpose=edit"));
    tauri::async_runtime::block_on(async {
        let rejected = ReadNotesTool(worker.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"purpose":"edit","note_id":id})).unwrap(),
            )
            .await;
        assert!(
            rejected.is_err(),
            "Even a forged read cannot restore edit authority"
        );
        let rejected = ProposeNoteChangeTool(worker)
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(
                    json!({"operation":"create","title":"Forbidden","markdown":"body"}),
                )
                .unwrap(),
            )
            .await;
        assert!(rejected.is_err());
    });
    assert!(serde_json::from_value::<ReadNotesArgs>(
        json!({"purpose":"answer","note_id":id,"start_line":1})
    )
    .is_err());
    assert!(serde_json::from_value::<ReadNotesArgs>(
        json!({"purpose":"edit","note_id":id,"include_provenance":true})
    )
    .is_err());
    assert!(serde_json::from_value::<NoteChangeArgs>(
        json!({"operation":"create","title":"New","markdown":"body","note_id":id})
    )
    .is_err());
}

#[test]
fn unified_reads_and_changes_preserve_canonical_pending_hash_and_full_read_boundaries() {
    let (vault, context, id) = fixture();
    let (path, _, _) = context.resolve_note(&id).unwrap();
    let original = fs::read_to_string(&path).unwrap();
    tauri::async_runtime::block_on(async {
        let working = read(&context, json!({"purpose":"edit","note_id":id})).await;
        let proposal = change(&context, json!({"operation":"edit","note_id":id,"expected_content_hash":working["contentHash"],"edits":[{"kind":"replace","oldText":"first line","newText":"pending first line"}]})).await;
        assert_eq!(proposal["status"], "pending_review");
        let canonical = read(&context, json!({"purpose":"answer","note_id":id})).await;
        assert!(!canonical.to_string().contains("pending first line"));
        assert!(canonical["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["excerpt"]
                .as_str()
                .is_some_and(|s| s.contains("first line"))));
        let partial = read(
            &context,
            json!({"purpose":"edit","note_id":id,"max_chars":20}),
        )
        .await;
        assert_eq!(partial["pendingChanges"], true);
        assert_eq!(partial["hasMore"], true);
        assert!(partial["content"]
            .as_str()
            .unwrap()
            .contains("pending first line"));
        let rejected = change(&context, json!({"operation":"replace","note_id":id,"expected_content_hash":partial["contentHash"],"markdown":"complete replacement"})).await;
        assert_eq!(rejected["code"], "note_not_fully_read");
        let full = read(
            &context,
            json!({"purpose":"edit","note_id":id,"max_chars":6000}),
        )
        .await;
        let stale = change(&context, json!({"operation":"replace","note_id":id,"expected_content_hash":working["contentHash"],"markdown":"stale replacement"})).await;
        assert_eq!(stale["status"], "error");
        let proposal = change(&context, json!({"operation":"replace","note_id":id,"expected_content_hash":full["contentHash"],"markdown":"complete replacement"})).await;
        assert_eq!(proposal["status"], "pending_review");
        let stored = context
            .service
            .pending_agent_proposal_for_note(&id)
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.preview["proposedEditorMarkdown"],
            "complete replacement"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        context
            .service
            .set_note_excluded(&id, "Tool note", true)
            .unwrap();
        let excluded = ReadNotesTool(context.clone())
            .call(
                &mut ToolContext::new(),
                serde_json::from_value(json!({"purpose":"answer","note_id":id})).unwrap(),
            )
            .await;
        assert!(excluded.is_err());
    });
    assert!(vault.notes.path().exists());
}

#[test]
fn unified_creation_stages_review_without_creating_a_file() {
    let (vault, context, _) = fixture();
    let before = fs::read_dir(vault.notes.path()).unwrap().count();
    let result = tauri::async_runtime::block_on(change(
        &context,
        json!({"operation":"create","title":"A new note","markdown":"Keep this body."}),
    ));
    assert_eq!(result["status"], "pending_review");
    assert_eq!(fs::read_dir(vault.notes.path()).unwrap().count(), before);
}

#[test]
fn unified_find_retains_activity_presentation_in_cursor_only_continuations() {
    let (vault, context, _) = fixture();
    for title in ["Alpha activity", "Beta activity", "Gamma activity"] {
        crate::test_support::save_and_finalize(
            &vault.state,
            title.into(),
            format!("Recorded {title} progress."),
            None,
        )
        .unwrap();
    }
    vault
        .state
        .lexical
        .sync_with_notes_index(&vault.state.notes_index.lock().unwrap().entries)
        .unwrap();
    tauri::async_runtime::block_on(async {
        let find = FindNotesTool(context.clone());
        let mut call = ToolContext::new();
        let missing = find
            .call(
                &mut call,
                serde_json::from_value(json!({"result":"notes"})).unwrap(),
            )
            .await;
        assert!(missing.is_err());
        let first = find.call(&mut call, serde_json::from_value(json!({"result":"notes","activity_range":{"start":"2020-01-01","end":"2100-01-01"},"limit":1})).unwrap()).await.unwrap();
        assert_eq!(first["notesReturned"], 1);
        let cursor = first["nextCursor"]
            .as_str()
            .expect("Multiple changed notes need a continuation");
        let second = find
            .call(
                &mut call,
                serde_json::from_value(json!({"cursor":cursor})).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second["notesReturned"], 1);
        assert_ne!(first["items"][0]["noteId"], second["items"][0]["noteId"]);
        let mixed = find
            .call(
                &mut call,
                serde_json::from_value(json!({"cursor":cursor,"result":"passages"})).unwrap(),
            )
            .await;
        assert!(mixed.is_err());
    });
}
