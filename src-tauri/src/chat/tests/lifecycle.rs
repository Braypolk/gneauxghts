use super::*;

fn request(conversation_id: &str) -> ChatRequest {
    ChatRequest::New {
        conversation_id: conversation_id.into(),
        content: "Question".into(),
        attachments: vec![ChatAttachmentInput {
            kind: "file".into(),
            name: "context.txt".into(),
            mime_type: "text/plain".into(),
            size_bytes: 1,
            data_base64: "eA==".into(),
        }],
        force_web_search: false,
        active_note: None,
        date_time_context: None,
        selected_context: vec![ChatRunContextItem {
            note_id: "note".into(),
            note_path: "Note.md".into(),
            title: "Note".into(),
            section_label: None,
            excerpt: "evidence".into(),
            content_hash: "hash".into(),
            reason: "explicit".into(),
            start_line: None,
            end_line: None,
            block_anchor: None,
        }],
    }
}

#[test]
fn acceptance_rolls_back_every_record_when_attachment_or_context_storage_fails() {
    let (_root, service) = service("chat-atomic-admission");
    let conversation = service.create_conversation(None, None).unwrap();
    for table in ["chat_message_attachments", "chat_agent_run_context"] {
        let connection = service.connection().unwrap();
        connection.execute_batch(&format!("CREATE TRIGGER reject_admission BEFORE INSERT ON {table} BEGIN SELECT RAISE(FAIL, 'injected admission failure'); END;")).unwrap();
        let result =
            service.admit_request(request(&conversation.summary.id), "test-request".into());
        assert!(result.err().unwrap().contains("injected admission failure"));
        for table in [
            "chat_messages",
            "chat_message_attachments",
            "chat_agent_runs",
            "chat_agent_run_context",
        ] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                        .get::<_, usize>(0))
                    .unwrap(),
                0,
                "{table}"
            );
        }
        assert_eq!(
            service
                .get_conversation(&conversation.summary.id)
                .unwrap()
                .summary
                .title,
            DEFAULT_CONVERSATION_TITLE
        );
        connection
            .execute_batch("DROP TRIGGER reject_admission")
            .unwrap();
    }
    let admission = service
        .admit_request(request(&conversation.summary.id), "accepted".into())
        .unwrap();
    let stored = service.get_conversation(&conversation.summary.id).unwrap();
    assert_eq!(stored.messages.len(), 2);
    assert_eq!(stored.messages[0].attachments.len(), 1);
    assert_eq!(stored.messages[0].attachments[0].name, "context.txt");
    assert_eq!(stored.messages[0].attachments[0].data_base64, "eA==");
    assert_eq!(
        service
            .retry_run_context(
                &conversation.summary.id,
                &admission.accepted.assistant_message_id
            )
            .unwrap()
            .selected_context
            .len(),
        1
    );
}

#[test]
fn terminal_source_failure_rolls_back_run_and_message_and_remains_recoverable() {
    let (root, service) = service("chat-atomic-terminal");
    let conversation = service.create_conversation(None, None).unwrap();
    let admission = service
        .admit_request(request(&conversation.summary.id), "accepted".into())
        .unwrap();
    let message = &admission.accepted.assistant_message_id;
    service
        .streaming_checkpoint(message)
        .unwrap()
        .write("partial")
        .unwrap();
    let sources = web_sources_from_text("https://example.com/evidence");
    assert_eq!(sources.len(), 1);
    service.connection().unwrap().execute_batch("CREATE TRIGGER reject_source BEFORE INSERT ON chat_sources BEGIN SELECT RAISE(FAIL, 'injected source failure'); END;").unwrap();
    assert!(service
        .persist_terminal_outcome(
            message,
            &admission.run_id,
            "complete",
            "final",
            None,
            &sources,
            &(3, 2),
            &Default::default(),
            None
        )
        .is_err());
    let state: (String, String, String) = service.connection().unwrap().query_row(
        "SELECT m.status, m.content, r.status FROM chat_messages m JOIN chat_agent_runs r ON r.assistant_message_id=m.id WHERE m.id=?1",
        [message], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!(
        state,
        ("streaming".into(), "partial".into(), "running".into())
    );
    service
        .fail_terminal_outcome(
            message,
            &admission.run_id,
            "Final sources could not be saved",
        )
        .unwrap();
    let reopened = ChatService::new(root.path().into(), root.path().join(".gneauxghts")).unwrap();
    let restored = reopened.get_conversation(&conversation.summary.id).unwrap();
    assert_eq!(restored.messages[1].status, "error");
    assert_eq!(restored.messages[1].content, "partial");
    assert!(restored.messages[1].sources.is_empty());
    reopened
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_source")
        .unwrap();
    let retry = reopened
        .admit_request(
            ChatRequest::Retry {
                conversation_id: conversation.summary.id.clone(),
                user_message_id: admission.accepted.user_message_id,
                failed_assistant_message_id: message.clone(),
                date_time_context: None,
            },
            "retry".into(),
        )
        .unwrap();
    reopened
        .persist_terminal_outcome(
            &retry.accepted.assistant_message_id,
            &retry.run_id,
            "complete",
            "final",
            None,
            &sources,
            &(3, 2),
            &Default::default(),
            None,
        )
        .unwrap();
    let restored = reopened.get_conversation(&conversation.summary.id).unwrap();
    assert_eq!(restored.messages.len(), 3);
    assert_eq!(restored.messages[2].content, "final");
    assert_eq!(restored.messages[2].sources.len(), 1);
}

#[test]
fn accepted_request_survives_projection_failure_and_connections_enforce_foreign_keys() {
    struct FailingSink;
    impl ChatProjectionSink for FailingSink {
        fn publish(&self, _: &Path, _: &str) -> Result<bool, String> {
            Err("injected projection failure".into())
        }
    }
    let (_root, mut service) = service("chat-projection-admission");
    let conversation = service.create_conversation(None, None).unwrap();
    Arc::get_mut(&mut service.inner).unwrap().projection_sink = Arc::new(FailingSink);
    let admission = service
        .admit_request(request(&conversation.summary.id), "accepted".into())
        .unwrap();
    assert_eq!(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .messages[1]
            .id,
        admission.accepted.assistant_message_id
    );
    let connection = service.connection().unwrap();
    assert!(connection.execute("INSERT INTO chat_sources(message_id,kind,title,excerpt) VALUES ('missing','web','x','x')", []).is_err());
    connection
        .execute(
            "DELETE FROM chat_conversations WHERE id=?1",
            [&conversation.summary.id],
        )
        .unwrap();
    for table in [
        "chat_messages",
        "chat_message_attachments",
        "chat_agent_runs",
        "chat_agent_run_context",
    ] {
        assert_eq!(
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, usize>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn repeated_retry_keeps_original_user_and_context_after_newer_turns() {
    let (_root, service) = service("chat-repeated-retry-lineage");
    let conversation = service.create_conversation(None, None).unwrap();
    let first = service
        .admit_request(request(&conversation.summary.id), "first".into())
        .unwrap();
    service
        .fail_terminal_outcome(
            &first.accepted.assistant_message_id,
            &first.run_id,
            "first failure",
        )
        .unwrap();
    let mut newer_request = request(&conversation.summary.id);
    if let ChatRequest::New {
        content,
        selected_context,
        ..
    } = &mut newer_request
    {
        *content = "Newer question".into();
        selected_context[0].note_id = "newer-context".into();
    }
    let newer = service
        .admit_request(newer_request, "newer".into())
        .unwrap();
    service
        .persist_terminal_outcome(
            &newer.accepted.assistant_message_id,
            &newer.run_id,
            "complete",
            "Newer answer",
            None,
            &[],
            &(0, 0),
            &Default::default(),
            None,
        )
        .unwrap();
    let retry = |user: &str, assistant: &str| ChatRequest::Retry {
        conversation_id: conversation.summary.id.clone(),
        user_message_id: user.into(),
        failed_assistant_message_id: assistant.into(),
        date_time_context: None,
    };
    let first_retry = service
        .admit_request(
            retry(
                &first.accepted.user_message_id,
                &first.accepted.assistant_message_id,
            ),
            "first-retry".into(),
        )
        .unwrap();
    service
        .fail_terminal_outcome(
            &first_retry.accepted.assistant_message_id,
            &first_retry.run_id,
            "retry failure",
        )
        .unwrap();
    let before = service.get_conversation(&conversation.summary.id).unwrap();
    // This was the command's nearest-preceding-user selection for the retry.
    let nearest = before
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .unwrap();
    assert_eq!(nearest.id, newer.accepted.user_message_id);
    let mismatched = service.admit_request(
        retry(&nearest.id, &first_retry.accepted.assistant_message_id),
        "wrong-pair".into(),
    );
    assert!(
        mismatched.is_err(),
        "retry must reject a user from a different durable run"
    );
    assert_eq!(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .messages
            .len(),
        before.messages.len()
    );
    let original_user = service
        .retry_user_message_id(
            &conversation.summary.id,
            &first_retry.accepted.assistant_message_id,
        )
        .unwrap();
    assert_eq!(original_user, first.accepted.user_message_id);
    let next_retry = service
        .admit_request(
            retry(&original_user, &first_retry.accepted.assistant_message_id),
            "second-retry".into(),
        )
        .unwrap();
    assert_eq!(
        next_retry.accepted.user_message_id,
        first.accepted.user_message_id
    );
    assert_eq!(next_retry.selected_context[0].note_id, "note");
    service
        .persist_terminal_outcome(
            &next_retry.accepted.assistant_message_id,
            &next_retry.run_id,
            "complete",
            "Recovered first answer",
            None,
            &[],
            &(0, 0),
            &Default::default(),
            None,
        )
        .unwrap();
    let branch = service
        .branch_from_message(&next_retry.accepted.assistant_message_id)
        .unwrap();
    let failed_retry_ordinal = before
        .messages
        .iter()
        .find(|m| m.id == first_retry.accepted.assistant_message_id)
        .unwrap()
        .ordinal;
    let branched_failed_retry = branch
        .messages
        .iter()
        .find(|m| m.ordinal == failed_retry_ordinal)
        .unwrap();
    let original_user = service
        .retry_user_message_id(&branch.summary.id, &branched_failed_retry.id)
        .unwrap();
    assert_eq!(original_user, branch.messages[0].id);
    let branched_retry = service
        .admit_request(
            ChatRequest::Retry {
                conversation_id: branch.summary.id.clone(),
                user_message_id: original_user,
                failed_assistant_message_id: branched_failed_retry.id.clone(),
                date_time_context: None,
            },
            "branched-retry".into(),
        )
        .unwrap();
    assert_eq!(branched_retry.selected_context[0].note_id, "note");
}

#[test]
fn retry_without_a_durable_run_never_guesses_from_transcript_order() {
    let (_root, service) = service("chat-legacy-retry-lineage");
    let conversation = service.create_conversation(None, None).unwrap();
    let first = service
        .admit_request(request(&conversation.summary.id), "legacy".into())
        .unwrap();
    service
        .fail_terminal_outcome(
            &first.accepted.assistant_message_id,
            &first.run_id,
            "failed",
        )
        .unwrap();
    service
        .connection()
        .unwrap()
        .execute("DELETE FROM chat_agent_runs WHERE id=?1", [&first.run_id])
        .unwrap();
    assert!(service
        .retry_user_message_id(
            &conversation.summary.id,
            &first.accepted.assistant_message_id
        )
        .unwrap_err()
        .contains("original agent run context is missing"));
    assert!(service
        .admit_request(
            ChatRequest::Retry {
                conversation_id: conversation.summary.id.clone(),
                user_message_id: first.accepted.user_message_id,
                failed_assistant_message_id: first.accepted.assistant_message_id,
                date_time_context: None,
            },
            "legacy-retry".into()
        )
        .is_err());
    assert_eq!(
        service
            .get_conversation(&conversation.summary.id)
            .unwrap()
            .messages
            .len(),
        2
    );
}
