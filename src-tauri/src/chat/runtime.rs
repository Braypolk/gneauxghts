//! Runtime orchestration and UI delivery, after durable request admission.
use super::*;
impl ChatService {
    pub(super) async fn run_request(&self, run: ActiveChatRun) {
        let event = |name: &str, payload: ChatStreamEvent| {
            let _ = run.app.emit(name, payload);
        };
        let mut started_payload = stream_payload(
            &run.request_id,
            &run.conversation_id,
            &run.assistant_message_id,
        );
        started_payload.conversation = self
            .get_conversation(&run.conversation_id)
            .ok()
            .map(|conversation| conversation.summary);
        event("chat://started", started_payload);

        let result = self.run_agent_response(&run).await;
        // Run-scoped grants and any unresolved waiters are strictly ephemeral.
        // Resolve them before terminal UI events so no control remains actionable.
        self.inner.permission_broker.finish_run(&run.run_id);
        let (status, content, error, sources, usage, stats, reason) = match result {
            Ok(success) => {
                let cancelled = run.cancelled.is_cancelled();
                (
                    if cancelled { "cancelled" } else { "complete" },
                    success.content,
                    None,
                    success.sources,
                    (success.usage.input_tokens, success.usage.output_tokens),
                    success.stats,
                    cancelled.then_some("userCancelled"),
                )
            }
            Err(failure) => {
                let content = failure.partial.unwrap_or_else(|| {
                    self.connection()
                        .and_then(|connection| {
                            connection
                                .query_row(
                                    "SELECT content FROM chat_messages WHERE id = ?1",
                                    [&run.assistant_message_id],
                                    |row| row.get::<_, String>(0),
                                )
                                .map_err(|e| e.to_string())
                        })
                        .unwrap_or_default()
                });
                let mut sources = failure.sources;
                sources.extend(web_sources_from_text(&content));
                let cancelled = run.cancelled.is_cancelled();
                let reason = if cancelled {
                    "userCancelled"
                } else {
                    terminal_reason_from_error(&failure.error)
                };
                (
                    if cancelled { "cancelled" } else { "error" },
                    content,
                    Some(failure.error),
                    sources,
                    (0, 0),
                    failure.stats,
                    Some(reason),
                )
            }
        };
        let mut payload = stream_payload(
            &run.request_id,
            &run.conversation_id,
            &run.assistant_message_id,
        );
        if let Err(error) = self.persist_terminal_outcome(
            &run.assistant_message_id,
            &run.run_id,
            status,
            &content,
            error.as_deref(),
            &sources,
            &usage,
            &stats,
            reason,
        ) {
            // Never acknowledge an undurable success or emit its sources.
            let failure = format!("Could not save the final chat response: {error}");
            if let Err(recovery) =
                self.fail_terminal_outcome(&run.assistant_message_id, &run.run_id, &failure)
            {
                // A wholly unavailable database is still reconciled on startup.
                eprintln!("Chat terminal recovery pending: {recovery}");
            }
            payload.error = Some(failure);
            event("chat://failed", payload);
            return;
        }
        let completed = status == "complete";
        if completed {
            let _ = self.refresh_continuation_summary(&run.conversation_id);
        }
        let _ = self.write_projection(&run.conversation_id, false);
        for source in sources {
            let mut source_payload = stream_payload(
                &run.request_id,
                &run.conversation_id,
                &run.assistant_message_id,
            );
            source_payload.source = Some(source);
            event("chat://source", source_payload);
        }
        payload.content = Some(content);
        payload.error = error;
        payload.conversation = self
            .get_conversation(&run.conversation_id)
            .ok()
            .map(|c| c.summary);
        event(
            match status {
                "complete" => "chat://completed",
                "cancelled" => "chat://cancelled",
                _ => "chat://failed",
            },
            payload,
        );
        if completed {
            if let Some(fallback) = run.automatic_title_fallback.clone() {
                let service = self.clone();
                let title_app = run.app.clone();
                let title_conversation_id = run.conversation_id.clone();
                let title_user_message_id = run.user_message_id.clone();
                let title_cancelled = run.cancelled.clone();
                let title_id = format!("title:{}", run.request_id);
                if let Ok(title_work) = service.inner.work.admit(title_id, title_cancelled.clone())
                {
                    tauri::async_runtime::spawn(async move {
                        let _title_work = title_work;
                        let _ = service
                            .generate_model_conversation_title(
                                &title_app,
                                &title_conversation_id,
                                &title_user_message_id,
                                &fallback,
                                title_cancelled,
                            )
                            .await;
                    });
                }
            }
        }
    }

    pub(super) async fn run_agent_response(
        &self,
        run: &ActiveChatRun,
    ) -> Result<AgentResponseSuccess, AgentResponseFailure> {
        if run.cancelled.is_cancelled() {
            return Err("Request cancelled".to_string().into());
        }
        let conversation = self.get_conversation(&run.conversation_id)?;
        let provider = crate::agent_runtime::AgentProvider::parse(&conversation.summary.provider)?;
        let settings = self.get_settings()?;
        let local_capabilities = if provider == crate::agent_runtime::AgentProvider::Local {
            Some(self.local_model_capabilities(&conversation.summary.model)?)
        } else {
            None
        };
        let tools_enabled = local_capabilities
            .as_ref()
            .map(|capabilities| capabilities.tools)
            .unwrap_or(true);
        if provider == crate::agent_runtime::AgentProvider::Local && run.force_web_search {
            return Err("Web search is unavailable with local models"
                .to_string()
                .into());
        }
        let latest_user = conversation
            .messages
            .iter()
            .find(|message| message.id == run.user_message_id && message.role == "user")
            .ok_or_else(|| "The user message is missing".to_string())?;
        let compaction = self.context_compaction(&run.conversation_id)?;
        let history =
            normalized_rig_history(&conversation.messages, &latest_user.id, compaction.as_ref())?;
        let tools = crate::agent_tools::AgentToolContext::new(
            run.app.clone(),
            self.clone(),
            run.request_id.clone(),
            run.run_id.clone(),
            run.conversation_id.clone(),
            run.assistant_message_id.clone(),
            conversation.summary.access.clone(),
            run.active_note.clone(),
            run.selected_context
                .iter()
                .map(|item| item.note_id.clone())
                .collect(),
            provider == crate::agent_runtime::AgentProvider::Local,
            run.date_time_context.clone(),
        );
        let previous_query = conversation
            .messages
            .iter()
            .take_while(|m| m.id != latest_user.id)
            .filter(|m| m.role == "assistant")
            .flat_map(|m| m.agent_events.iter())
            .filter_map(|e| match &e.event {
                crate::agent_runtime::AgentEvent::QueryResolved { details }
                    if details["primary"] == true
                        && details["worker"] != true
                        && !details["resolved"].is_null() =>
                {
                    crate::services::evidence::query::previous_context(details)
                }
                _ => None,
            })
            .last();
        let active_context = tools.active_note_context()?;
        let explicit_context = tools.explicit_wikilink_context(&latest_user.content)?;
        let selected_context = tools.selected_context_prompt(&run.selected_context);
        let mut prompt = latest_user.content.clone();
        {
            prompt.push_str(&format!(
                "\n\nQuery reference instant, local timezone and editor date/time conventions: {}",
                tools.query_anchor_label()
            ));
        }
        if let Some(details) = &previous_query {
            prompt.push_str("\n\nPrevious interpreted query (user-request context only, not evidence; retrieve fresh notes):\n");
            prompt.push_str(&serde_json::to_string(details).unwrap_or_default());
        }
        if !active_context.is_empty() {
            prompt.push_str("\n\n");
            prompt.push_str(&active_context);
        }
        if !explicit_context.is_empty() {
            prompt.push_str("\n\nAllowed notes explicitly linked by the user:\n");
            prompt.push_str(&explicit_context);
        }
        if !selected_context.is_empty() {
            prompt.push_str("\n\nNotes explicitly included for this turn:\n");
            prompt.push_str(&selected_context);
        }
        let streamed_content = Arc::new(Mutex::new(String::new()));
        let streamed_content_for_event = Arc::clone(&streamed_content);
        let stream_service = self.clone();
        let stream_app = run.app.clone();
        let stream_request_id = run.request_id.clone();
        let stream_conversation_id = run.conversation_id.clone();
        let stream_message_id = run.assistant_message_id.clone();
        let stream_run_id = run.run_id.clone();
        let sequence = Arc::new(AtomicU64::new(1));
        let checkpoint = Mutex::new(self.streaming_checkpoint(&run.assistant_message_id)?);
        let event_sink: crate::agent_runtime::AgentEventSink = Arc::new(move |event| {
            let event_sequence = sequence.fetch_add(1, Ordering::Relaxed);
            if let crate::agent_runtime::AgentEvent::TextDelta { delta } = &event {
                if let Ok(mut content) = streamed_content_for_event.lock() {
                    content.push_str(delta);
                    if let Ok(checkpoint) = checkpoint.lock() {
                        let _ = checkpoint.write(&content);
                    }
                } else {
                    return;
                }
                let mut payload = stream_payload(
                    &stream_request_id,
                    &stream_conversation_id,
                    &stream_message_id,
                );
                payload.delta = Some(delta.clone());
                let _ = stream_app.emit("chat://text-delta", payload);
            }
            let envelope = ChatAgentEventEnvelope {
                schema_version: 2,
                request_id: stream_request_id.clone(),
                conversation_id: stream_conversation_id.clone(),
                message_id: stream_message_id.clone(),
                run_id: stream_run_id.clone(),
                sequence: event_sequence,
                created_at_millis: now_millis(),
                event,
            };
            if envelope.event.is_durable() {
                let _ = stream_service.append_agent_event(&envelope);
            }
            let _ = stream_app.emit("chat://agent-event", envelope);
        });
        tools.set_event_sink(Arc::clone(&event_sink));
        if compaction.is_some() || !run.selected_context.is_empty() {
            event_sink(crate::agent_runtime::AgentEvent::ContextUpdated {
                compacted: compaction.is_some(),
                selected_note_titles: run
                    .selected_context
                    .iter()
                    .map(|item| item.title.clone())
                    .collect(),
            });
        }
        let observer = crate::agent_runtime::AgentRuntimeObserver {
            cancelled: run.cancelled.clone(),
            on_event: event_sink,
            permissions: Some(crate::agent_permissions::AgentPermissionBoundary::for_run(
                self.inner.permission_broker.clone(),
                crate::agent_permissions::AgentPermissionRunContext {
                    request_id: run.request_id.clone(),
                    conversation_id: run.conversation_id.clone(),
                    message_id: run.assistant_message_id.clone(),
                    run_id: run.run_id.clone(),
                },
            )),
        };
        let prompt = rig_user_message(prompt, &latest_user.attachments)?;
        let response = match crate::agent_run_coordinator::AgentRunCoordinator::execute(
            crate::agent_runtime::AgentRuntimeRequest {
                provider: provider.clone(),
                model: conversation.summary.model.clone(),
                api_key: secrets::read_provider_api_key(&run.app, &conversation.summary.provider)?,
                local_base_url: settings.local_base_url,
                output_schema: None,
                preamble: format!(
                    "{}\n\n{}",
                    agent_preamble(&provider, tools_enabled),
                    crate::agent_tools::capability_instructions()
                ),
                prompt,
                history,
                enable_web: provider == crate::agent_runtime::AgentProvider::Openai
                    && (run.force_web_search || settings.web_access == WebAccess::Auto),
                require_web: run.force_web_search,
                flex: provider == crate::agent_runtime::AgentProvider::Openai
                    && settings.service_tier == ChatServiceTier::Flex,
                reasoning_effort: crate::agent_runtime::supported_reasoning_effort(
                    &provider,
                    &conversation.summary.model,
                    &conversation.summary.reasoning_effort,
                ),
            },
            tools_enabled.then_some(tools.clone()),
            observer,
        )
        .await
        {
            Ok(response) => response,
            Err(error) => {
                return Err(AgentResponseFailure {
                    partial: streamed_content
                        .lock()
                        .ok()
                        .and_then(|text| tools.render_passage_references(&text).ok()),
                    error: error.error,
                    sources: tools.sources(),
                    stats: error.stats,
                });
            }
        };
        tools
            .validate_context()
            .map_err(AgentResponseFailure::from)?;
        let mut sources = tools.sources();
        sources.extend(web_sources_from_text(&response.output));
        let content = tools
            .render_passage_references(&response.output)
            .map_err(|error| AgentResponseFailure {
                partial: None,
                error,
                sources: sources.clone(),
                stats: response.stats.clone(),
            })?;
        Ok(AgentResponseSuccess {
            content,
            sources,
            usage: response.usage,
            stats: response.stats,
        })
    }

    pub(super) async fn generate_model_conversation_title(
        &self,
        app: &AppHandle,
        conversation_id: &str,
        user_message_id: &str,
        fallback: &str,
        cancelled: CancellationToken,
    ) -> Result<(), String> {
        let conversation = self.get_conversation(conversation_id)?;
        let provider = crate::agent_runtime::AgentProvider::parse(&conversation.summary.provider)?;
        let settings = self.get_settings()?;
        let opening_message = conversation
            .messages
            .iter()
            .find(|message| message.id == user_message_id && message.role == "user")
            .map(|message| compact_text(&message.content, 1_000))
            .unwrap_or_default();
        if opening_message.is_empty() {
            return Ok(());
        }
        let model = conversation.summary.model;
        let response = crate::agent_run_coordinator::AgentRunCoordinator::execute(
            crate::agent_runtime::AgentRuntimeRequest {
                provider: provider.clone(),
                model: model.clone(),
                api_key: secrets::read_provider_api_key(app, &conversation.summary.provider)?,
                local_base_url: settings.local_base_url,
                output_schema: None,
                preamble: "Create concise, descriptive conversation titles. Return only the title, without quotes, Markdown, or ending punctuation.".to_string(),
                prompt: rig_core::completion::Message::user(format!(
                    "Name this conversation in 3 to 7 words:\n\n{opening_message}"
                )),
                history: Vec::new(),
                enable_web: false,
                require_web: false,
                flex: provider == crate::agent_runtime::AgentProvider::Openai
                    && settings.service_tier == ChatServiceTier::Flex,
                reasoning_effort: crate::agent_runtime::supported_reasoning_effort(
                    &provider,
                    &model,
                    "low",
                ),
            },
            None,
            crate::agent_runtime::AgentRuntimeObserver {
                cancelled,
                on_event: Arc::new(|_| {}),
                permissions: None,
            },
        )
        .await
        .map_err(|failure| failure.error)?;
        let Some(title) = normalize_generated_conversation_title(&response.output) else {
            return Ok(());
        };
        if title.eq_ignore_ascii_case(fallback) {
            return Ok(());
        }
        let updated = self
            .connection()?
            .execute(
                "UPDATE chat_conversations SET title = ?3
                 WHERE id = ?1 AND title = ?2",
                params![conversation_id, fallback, title],
            )
            .map_err(|error| error.to_string())?;
        if updated == 0 {
            return Ok(());
        }
        let conversation = self.get_conversation(conversation_id)?.summary;
        let _ = app.emit(
            "chat://title-updated",
            ChatTitleUpdatedEvent {
                conversation_id: conversation_id.to_string(),
                conversation,
            },
        );
        Ok(())
    }
}
