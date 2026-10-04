//! Atomic durable request acceptance. Tauri only supplies dispatch and events.
use super::*;

pub(super) struct ChatAdmission {
    pub(super) accepted: ChatRequestAccepted,
    pub(super) run_id: String,
    pub(super) force_web_search: bool,
    pub(super) active_note: Option<crate::agent_tools::ActiveNoteSnapshot>,
    pub(super) selected_context: Vec<ChatRunContextItem>,
    pub(super) date_time_context: Option<date_time::DateTimeContext>,
    pub(super) provider: String,
}

impl ChatService {
    pub(super) fn admit_request(
        &self,
        request: ChatRequest,
        request_id: String,
    ) -> Result<ChatAdmission, String> {
        let conversation_id = match &request {
            ChatRequest::New {
                conversation_id, ..
            }
            | ChatRequest::Retry {
                conversation_id, ..
            } => conversation_id.clone(),
        };
        let conversation = self.get_conversation(&conversation_id)?;
        let date_time_context = match &request {
            ChatRequest::New {
                date_time_context, ..
            }
            | ChatRequest::Retry {
                date_time_context, ..
            } => date_time_context.clone(),
        };
        if let Some(context) = &date_time_context {
            context.validate()?;
        }
        if conversation.summary.detached {
            return Err(
                "Resolve the externally edited transcript before continuing this chat".to_string(),
            );
        }
        if conversation.summary.status == "archived" {
            return Err("Restore this archived conversation before continuing".to_string());
        }
        let (content, attachments, force_web_search, active_note, selected_context, retry) =
            match request {
                ChatRequest::New {
                    content,
                    attachments,
                    force_web_search,
                    active_note,
                    selected_context,
                    ..
                } => {
                    let content = content.trim().to_string();
                    let attachments = validate_attachments(attachments)?;
                    if content.is_empty() && attachments.is_empty() {
                        return Err("A message or attachment is required".to_string());
                    }
                    (
                        content,
                        attachments,
                        force_web_search,
                        active_note,
                        selected_context,
                        None,
                    )
                }
                ChatRequest::Retry {
                    user_message_id,
                    failed_assistant_message_id,
                    ..
                } => {
                    let assistant = conversation
                        .messages
                        .iter()
                        .find(|message| {
                            message.id == failed_assistant_message_id && message.role == "assistant"
                        })
                        .ok_or_else(|| {
                            "Only failed or interrupted assistant messages can be retried"
                                .to_string()
                        })?;
                    if assistant.status != "error" && assistant.status != "cancelled" {
                        return Err(
                            "Only failed or interrupted assistant messages can be retried"
                                .to_string(),
                        );
                    }
                    let original_context =
                        self.retry_run_context(&conversation_id, &failed_assistant_message_id)?;
                    if user_message_id != original_context.user_message_id {
                        return Err(
                            "Retry user message does not match the original agent run".to_string()
                        );
                    }
                    let user = conversation
                        .messages
                        .iter()
                        .find(|message| {
                            message.id == user_message_id
                                && message.role == "user"
                                && message.ordinal < assistant.ordinal
                        })
                        .ok_or_else(|| "The original user message is missing".to_string())?;
                    (
                        user.content.clone(),
                        Vec::new(),
                        original_context.force_web_search,
                        original_context.active_note,
                        original_context.selected_context,
                        Some((user_message_id, failed_assistant_message_id)),
                    )
                }
            };
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let connection = &transaction;
        let part = choose_part(&connection, &conversation_id)?;
        let next_ordinal: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM chat_messages WHERE conversation_id = ?1",
                [&conversation_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let now = now_millis();
        let user_message_id = if let Some((existing_id, _)) = retry.as_ref() {
            connection
                .query_row(
                    "SELECT id FROM chat_messages
                     WHERE id = ?1 AND conversation_id = ?2 AND role = 'user'",
                    params![existing_id, conversation_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|_| "The original user message is missing".to_string())?
        } else {
            generate_id("msg")
        };
        let assistant_message_id = generate_id("msg");
        let assistant_ordinal = if retry.is_some() {
            next_ordinal
        } else {
            connection
                .execute(
                    "INSERT INTO chat_messages
                     (id, conversation_id, ordinal, role, status, content, part, created_at_millis)
                     VALUES (?1, ?2, ?3, 'user', 'complete', ?4, ?5, ?6)",
                    params![
                        user_message_id,
                        conversation_id,
                        next_ordinal,
                        content,
                        part,
                        to_i64(now)?
                    ],
                )
                .map_err(|error| error.to_string())?;
            for attachment in &attachments {
                connection
                    .execute(
                        "INSERT INTO chat_message_attachments
                         (id, message_id, kind, name, mime_type, size_bytes,
                          data_base64, created_at_millis)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            attachment.id,
                            user_message_id,
                            attachment.kind,
                            attachment.name,
                            attachment.mime_type,
                            to_i64(attachment.size_bytes as u64)?,
                            attachment.data_base64,
                            to_i64(now)?
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            next_ordinal + 1
        };
        let automatic_title_fallback = if retry.is_none()
            && conversation
                .summary
                .title
                .trim()
                .eq_ignore_ascii_case(DEFAULT_CONVERSATION_TITLE)
        {
            let attachment_names = attachments
                .iter()
                .map(|attachment| attachment.name.clone())
                .collect::<Vec<_>>();
            let title = automatic_conversation_title(&content, &attachment_names);
            connection
                .execute(
                    "UPDATE chat_conversations
                     SET title = ?2
                     WHERE id = ?1 AND LOWER(TRIM(title)) = 'new conversation'",
                    params![conversation_id, title],
                )
                .map_err(|error| error.to_string())?;
            Some(title)
        } else {
            None
        };
        connection
            .execute(
                "INSERT INTO chat_messages
                 (id, conversation_id, ordinal, role, status, content, part,
                  created_at_millis, provider, model)
                 VALUES (?1, ?2, ?3, 'assistant', 'streaming', '', ?4, ?5, ?6, ?7)",
                params![
                    assistant_message_id,
                    conversation_id,
                    assistant_ordinal,
                    part,
                    to_i64(now)?,
                    conversation.summary.provider,
                    conversation.summary.model
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "UPDATE chat_conversations SET current_part = ?2, updated_at_millis = ?3 WHERE id = ?1",
                params![conversation_id, part, to_i64(now)?],
            )
            .map_err(|error| error.to_string())?;

        let accepted = ChatRequestAccepted {
            request_id: request_id.clone(),
            conversation_id: conversation_id.clone(),
            user_message_id,
            assistant_message_id: assistant_message_id.clone(),
            automatic_title_fallback,
        };
        let run_id = Self::insert_agent_run_with_context(
            &transaction,
            &conversation_id,
            &accepted.user_message_id,
            &assistant_message_id,
            retry
                .as_ref()
                .map(|(_, assistant_id)| assistant_id.as_str()),
            &conversation.summary.provider,
            &conversation.summary.model,
            &conversation.summary.reasoning_effort,
            force_web_search,
            active_note.as_ref(),
            &selected_context,
        )?;
        transaction.commit().map_err(|e| e.to_string())?;
        // SQLite acceptance is authoritative. Projection failures cannot make a
        // committed send look rejected; publication retries on subsequent writes
        // and startup reconciliation.
        if let Err(error) = self.write_projection(&conversation_id, false) {
            eprintln!("accepted chat projection pending: {error}");
        }
        Ok(ChatAdmission {
            accepted,
            run_id,
            force_web_search,
            active_note,
            selected_context,
            date_time_context,
            provider: conversation.summary.provider,
        })
    }
}
