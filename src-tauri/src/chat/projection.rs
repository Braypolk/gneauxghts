//! Managed Markdown publication and conflict observation under one publication lock.
use super::*;
impl ChatService {
    pub(super) fn changed_projection_path(
        &self,
        conversation_id: &str,
    ) -> Result<Option<PathBuf>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT path, content_hash FROM chat_projection_files WHERE conversation_id = ?1",
            )
            .map_err(|error| error.to_string())?;
        let mut rows = statement
            .query([conversation_id])
            .map_err(|error| error.to_string())?;
        while let Some(row) = rows.next().map_err(|error| error.to_string())? {
            let path = PathBuf::from(row.get::<_, String>(0).map_err(|error| error.to_string())?);
            let expected: String = row.get(1).map_err(|error| error.to_string())?;
            if !path.exists() {
                return Ok(Some(path));
            }
            let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            if content_hash(&content) != expected {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    pub(crate) fn projection_conflict_conversion(
        &self,
        conversation_id: &str,
    ) -> Result<ProjectionConflictConversion, String> {
        let _publication = self
            .inner
            .projection_publication
            .lock()
            .map_err(|_| "Chat projection publication unavailable")?;
        let source = self
            .changed_projection_path(conversation_id)?
            .ok_or_else(|| "No externally changed projection was found".to_string())?;
        if !source.exists() {
            return Err(
                "The changed projection was deleted; restore the transcript instead".to_string(),
            );
        }
        let content = fs::read_to_string(&source).map_err(|error| error.to_string())?;
        let markdown = crate::note::strip_frontmatter(&content);
        Ok(ProjectionConflictConversion {
            title: converted_note_title(&markdown),
            markdown,
        })
    }

    pub(crate) fn restore_projection_after_conflict(
        &self,
        conversation_id: &str,
    ) -> Result<(), String> {
        let _publication = self
            .inner
            .projection_publication
            .lock()
            .map_err(|_| "Chat projection publication unavailable")?;
        self.connection()?
            .execute(
                "UPDATE chat_conversations SET detached = 0 WHERE id = ?1",
                [conversation_id],
            )
            .map_err(|error| error.to_string())?;
        self.write_projection_locked(conversation_id, true)?;
        Ok(())
    }

    pub(crate) fn mark_projection_detached_if_needed(
        &self,
        conversation_id: &str,
    ) -> Result<bool, String> {
        let _publication = self
            .inner
            .projection_publication
            .lock()
            .map_err(|_| "Chat projection publication unavailable")?;
        self.mark_projection_detached_if_needed_locked(conversation_id)
    }

    pub(super) fn mark_projection_detached_if_needed_locked(
        &self,
        conversation_id: &str,
    ) -> Result<bool, String> {
        let conflict = self.changed_projection_path(conversation_id)?.is_some();
        if conflict {
            self.connection()?
                .execute(
                    "UPDATE chat_conversations SET detached = 1 WHERE id = ?1",
                    [conversation_id],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(conflict)
    }

    pub(crate) fn projection_owner_for_path(&self, path: &Path) -> Result<Option<String>, String> {
        self.connection()?
            .query_row(
                "SELECT conversation_id FROM chat_projection_files WHERE path = ?1 LIMIT 1",
                [path.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn recall_document(
        &self,
        conversation_id: &str,
    ) -> Result<ChatRecallDocument, String> {
        let conversation = self.get_conversation(conversation_id)?;
        let directory = conversation_directory(&self.inner.notes_root, &conversation.summary);
        let excerpts = conversation
            .excerpts
            .iter()
            .filter(|excerpt| excerpt.remembered)
            .map(|excerpt| crate::semantic::indexer::ChatRecallExcerpt {
                anchor: excerpt.anchor.clone(),
                quote: excerpt.quote.clone(),
            })
            .collect();
        Ok(ChatRecallDocument {
            path: directory.join("Conversation.md"),
            title: conversation.summary.title,
            modified_millis: conversation.summary.updated_at_millis,
            excerpts,
        })
    }

    pub(crate) fn reconcile_semantic_recall(
        &self,
        semantic: &crate::semantic::SemanticState,
    ) -> Result<(), String> {
        let mut known_paths = HashSet::new();
        for summary in self.list_conversations()? {
            if summary.status == "archived" {
                continue;
            }
            let recall = self.recall_document(&summary.id)?;
            known_paths.insert(recall.path.clone());
            semantic.queue_chat_recall_for_startup(
                &recall.path,
                recall.title,
                recall.excerpts,
                recall.modified_millis,
            )?;
        }
        semantic.queue_orphaned_chat_recall_deletes_for_startup(&known_paths)
    }

    pub(super) fn write_projection(
        &self,
        conversation_id: &str,
        force: bool,
    ) -> Result<(), String> {
        // Filesystem bytes and their durable receipt publish as one observed boundary.
        let _publication = self
            .inner
            .projection_publication
            .lock()
            .map_err(|_| "Chat projection publication unavailable")?;
        self.write_projection_locked(conversation_id, force)
    }

    pub(super) fn write_projection_locked(
        &self,
        conversation_id: &str,
        force: bool,
    ) -> Result<(), String> {
        if !force && self.mark_projection_detached_if_needed_locked(conversation_id)? {
            return Err("Chat transcript was edited outside Gneauxghts".to_string());
        }
        let conversation = self.get_conversation(conversation_id)?;
        let directory = conversation_directory(&self.inner.notes_root, &conversation.summary);
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

        let index_path = directory.join("Conversation.md");
        let remembered = conversation
            .excerpts
            .iter()
            .filter(|excerpt| excerpt.remembered)
            .map(|excerpt| {
                format!(
                    "> {}\n> — [[{}#^{}|source]]\n^{}",
                    excerpt.quote.replace('\n', "\n> "),
                    part_link(
                        &directory,
                        message_part(&conversation.messages, &excerpt.message_id)
                    ),
                    excerpt.anchor,
                    excerpt.anchor
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let parts = conversation
            .messages
            .iter()
            .map(|message| message.part)
            .collect::<HashSet<_>>();
        let mut sorted_parts = parts.into_iter().collect::<Vec<_>>();
        sorted_parts.sort_unstable();
        let part_links = sorted_parts
            .iter()
            .map(|part| format!("- [[Part {part:03}]]"))
            .collect::<Vec<_>>()
            .join("\n");
        let index_body = format!(
            "{}\n\n# {}\n\n{}\n\n## Remembered passages\n\n{}\n",
            projection_frontmatter(
                "chatIndex",
                conversation_id,
                None,
                "PENDING",
                conversation.summary.created_at_millis,
            ),
            conversation.summary.title,
            part_links,
            if remembered.is_empty() {
                "_Nothing remembered yet._"
            } else {
                &remembered
            }
        );
        write_projected_file(
            &self.connection()?,
            self.inner.projection_sink.as_ref(),
            conversation_id,
            &index_path,
            &index_body,
        )?;

        for part in sorted_parts {
            let mut body = format!(
                "{}\n\n# {} · Part {part:03}\n",
                projection_frontmatter(
                    "chatTranscript",
                    conversation_id,
                    Some(part),
                    "PENDING",
                    conversation.summary.created_at_millis,
                ),
                conversation.summary.title
            );
            for message in conversation
                .messages
                .iter()
                .filter(|message| message.part == part)
            {
                let role = if message.role == "user" {
                    "You"
                } else {
                    "Thought partner"
                };
                let suffix = match message.status.as_str() {
                    "cancelled" => " · interrupted",
                    "error" => " · failed",
                    "streaming" => " · responding",
                    _ => "",
                };
                body.push_str(&format!(
                    "\n## {role}{suffix}\n\n{}\n\n^msg_{}\n",
                    message.content, message.id
                ));
                if !message.attachments.is_empty() {
                    body.push_str("\nAttachments:\n");
                    for attachment in &message.attachments {
                        body.push_str(&format!(
                            "- {} ({})\n",
                            attachment.name, attachment.mime_type
                        ));
                    }
                }
                for excerpt in conversation
                    .excerpts
                    .iter()
                    .filter(|excerpt| excerpt.message_id == message.id)
                {
                    body.push_str(&format!("\n^{}\n", excerpt.anchor));
                }
                if !message.sources.is_empty() {
                    body.push_str("\nSources:\n");
                    for source in &message.sources {
                        let target = source
                            .url
                            .clone()
                            .or_else(|| source.note_path.clone())
                            .unwrap_or_default();
                        body.push_str(&format!("- [{}]({})\n", source.title, target));
                    }
                }
            }
            let path = directory.join(format!("Part {part:03}.md"));
            write_projected_file(
                &self.connection()?,
                self.inner.projection_sink.as_ref(),
                conversation_id,
                &path,
                &body,
            )?;
        }
        Ok(())
    }
}
