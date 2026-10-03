//! Markdown recovery is a fallback for absent conversations, never a replacement
//! for the live database. It imports only app-shaped transcripts and publishes no
//! files. Missing permissions and historical evidence are not reconstructed.
use super::*;
use crate::note::{parse_note, DocumentKind};
use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};

struct RecoveredMessage {
    id: String,
    role: &'static str,
    status: &'static str,
    content: String,
    part: i64,
    footer: String,
}

struct RecoveredConversation {
    id: String,
    title: String,
    created: u64,
    messages: Vec<RecoveredMessage>,
    files: Vec<(PathBuf, String)>,
    index_body: String,
}

impl ChatService {
    pub(super) fn recover_transcript_conversations(&self) -> Result<(), String> {
        let root = self.inner.notes_root.join("Chats");
        if !fs::symlink_metadata(&root)
            .map(|metadata| metadata.file_type().is_dir())
            .unwrap_or(false)
        {
            return Ok(());
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) => {
                eprintln!(
                    "Chat transcript recovery unavailable at {}: {error}",
                    root.display()
                );
                return Ok(());
            }
        };
        let mut candidates: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for entry in entries {
            let Ok(entry) = entry else { continue };
            // Never follow a folder symlink out of the Running Vault.
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let index_path = entry.path().join("Conversation.md");
            if fs::symlink_metadata(&index_path)
                .map(|metadata| !metadata.file_type().is_file())
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(markdown) = fs::read_to_string(&index_path) else {
                continue;
            };
            let Some(metadata) = parse_note(&markdown).frontmatter.managed else {
                continue;
            };
            if metadata.kind == DocumentKind::ChatIndex {
                if let Some(id) = metadata.chat_id.filter(|id| valid_id(id)) {
                    candidates.entry(id).or_default().push(entry.path());
                }
            }
        }
        let settings = self.get_settings()?;
        for (id, directories) in candidates {
            let mut connection = self.connection()?;
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM chat_conversations WHERE id = ?1)",
                    [&id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if exists || directories.len() != 1 {
                continue;
            }
            let recovered = match read_conversation(&directories[0], &id) {
                Ok(recovered) => recovered,
                Err(error) => {
                    eprintln!(
                        "Chat transcript recovery skipped {}: {error}",
                        directories[0].display()
                    );
                    continue;
                }
            };
            // All rows and hash receipts commit together. A bad/colliding message
            // ID cannot leave a partially recovered conversation behind.
            if let Err(error) = import_conversation(
                &mut connection,
                &recovered,
                &settings,
                &self.inner.notes_root,
                &directories[0],
            ) {
                eprintln!(
                    "Chat transcript recovery skipped {}: {error}",
                    directories[0].display()
                );
            }
        }
        Ok(())
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'_' | b'-'))
}

fn read_file(path: &Path) -> Result<String, String> {
    if !fs::symlink_metadata(path)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_file()
    {
        return Err("Expected a regular transcript file".into());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

fn read_conversation(directory: &Path, id: &str) -> Result<RecoveredConversation, String> {
    let index_path = directory.join("Conversation.md");
    let index = read_file(&index_path)?;
    let parsed = parse_note(&index);
    let metadata = parsed.frontmatter.managed.ok_or("Missing chat metadata")?;
    if metadata.kind != DocumentKind::ChatIndex || metadata.chat_id.as_deref() != Some(id) {
        return Err("Mismatched conversation identity".into());
    }
    let created = metadata
        .created_at
        .parse::<u64>()
        .ok()
        .or_else(|| {
            chrono::DateTime::parse_from_rfc3339(&metadata.created_at)
                .ok()
                .and_then(|date| u64::try_from(date.timestamp_millis()).ok())
        })
        .ok_or("Missing conversation creation time")?;
    let title = parsed
        .body
        .lines()
        .find_map(|line| line.strip_prefix("# "))
        .filter(|title| !title.is_empty())
        .ok_or("Missing conversation title")?
        .to_string();
    let part_pattern = regex::Regex::new(r"(?m)^- \[\[Part ([0-9]+)\]\]$").unwrap();
    let parts = part_pattern
        .captures_iter(&parsed.body)
        .map(|capture| capture[1].parse::<i64>().map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    if parts
        .iter()
        .enumerate()
        .any(|(offset, part)| *part != offset as i64 + 1)
    {
        return Err("Transcript parts must be complete and ordered".into());
    }
    let expected_parts = parts
        .iter()
        .map(|part| format!("Part {part:03}.md"))
        .collect::<HashSet<_>>();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("Part ") && name.ends_with(".md") && !expected_parts.contains(&name) {
            return Err("Conversation index does not include every transcript part".into());
        }
    }
    let mut recovered = RecoveredConversation {
        id: id.into(),
        title,
        created,
        messages: Vec::new(),
        files: vec![(index_path, index)],
        index_body: parsed.body,
    };
    let mut message_ids = HashSet::new();
    for part in parts {
        let path = directory.join(format!("Part {part:03}.md"));
        let markdown = read_file(&path)?;
        let parsed = parse_note(&markdown);
        let metadata = parsed
            .frontmatter
            .managed
            .ok_or("Missing transcript metadata")?;
        if metadata.kind != DocumentKind::ChatTranscript
            || metadata.chat_id.as_deref() != Some(id)
            || metadata.part.map(i64::from) != Some(part)
        {
            return Err("Mismatched transcript identity or part".into());
        }
        let messages = read_messages(&parsed.body, part)?;
        if messages.is_empty()
            || messages
                .iter()
                .any(|message| !message_ids.insert(message.id.clone()))
        {
            return Err("Missing or duplicate message identities".into());
        }
        recovered.messages.extend(messages);
        recovered.files.push((path, markdown));
    }
    Ok(recovered)
}

/// Inspect top-level Markdown blocks so code samples and quotations containing
/// role headings or message anchors remain literal message content.
fn read_messages(body: &str, part: i64) -> Result<Vec<RecoveredMessage>, String> {
    let mut depth = 0usize;
    let mut heading = None;
    let mut cursor = 0;
    let mut messages: Vec<RecoveredMessage> = Vec::new();
    for (event, range) in Parser::new(body).into_offset_iter() {
        match event {
            Event::Start(tag) => {
                if depth == 0 {
                    match tag {
                        Tag::Heading {
                            level: HeadingLevel::H2,
                            ..
                        } if heading.is_none() => {
                            let text = body[range.clone()]
                                .trim_end()
                                .strip_prefix("## ")
                                .unwrap_or("");
                            let role_status = match text {
                                "You" => Some(("user", "complete")),
                                "Thought partner" => Some(("assistant", "complete")),
                                "Thought partner · interrupted"
                                | "Thought partner · responding" => {
                                    Some(("assistant", "cancelled"))
                                }
                                "Thought partner · failed" => Some(("assistant", "error")),
                                _ => None,
                            };
                            if let Some((role, status)) = role_status {
                                if let Some(previous) = messages.last_mut() {
                                    previous.footer = body[cursor..range.start].trim().to_string();
                                }
                                heading = Some((role, status, range.end));
                            }
                        }
                        Tag::Paragraph => {
                            let text = body[range.clone()].trim_end();
                            if let Some(id) = text.strip_prefix("^msg_").filter(|id| valid_id(id)) {
                                let (role, status, start) = heading
                                    .take()
                                    .ok_or("Message anchor without a role heading")?;
                                // Remove only the separators generated by write_projection.
                                let content = body[start..range.start]
                                    .strip_prefix('\n')
                                    .unwrap_or(&body[start..range.start]);
                                let content =
                                    content.strip_suffix("\n\n").unwrap_or(content).to_string();
                                messages.push(RecoveredMessage {
                                    id: id.into(),
                                    role,
                                    status,
                                    content,
                                    part,
                                    footer: String::new(),
                                });
                                cursor = range.end;
                            }
                        }
                        _ => {}
                    }
                }
                depth += 1;
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    if heading.is_some() {
        return Err("Message is missing its stable anchor".into());
    }
    if let Some(previous) = messages.last_mut() {
        previous.footer = body[cursor..].trim().to_string();
    }
    Ok(messages)
}

fn import_conversation(
    connection: &mut Connection,
    chat: &RecoveredConversation,
    settings: &ChatSettings,
    notes_root: &Path,
    directory: &Path,
) -> Result<(), String> {
    let expected_folder = format!(
        "{}-{}",
        civil_date_from_days((chat.created / 86_400_000) as i64),
        short_id(&chat.id)
    );
    let detached = directory != notes_root.join("Chats").join(expected_folder);
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO chat_conversations (id, title, mode, access, provider, model, reasoning_effort, created_at_millis, updated_at_millis, current_part, detached) VALUES (?1, ?2, 'auto', 'none', ?3, ?4, ?5, ?6, ?6, ?7, ?8)",
        params![chat.id, chat.title, settings.provider, settings.model, settings.reasoning_effort, to_i64(chat.created)?, chat.messages.last().map(|message| message.part).unwrap_or(1), detached],
    ).map_err(|error| error.to_string())?;
    for (offset, message) in chat.messages.iter().enumerate() {
        // Attachment bytes are absent from legacy Markdown. Keep their visible
        // inventory as text rather than manufacturing sendable attachments.
        let attachment_inventory = message
            .footer
            .strip_prefix("Attachments:\n")
            .map(|inventory| {
                inventory
                    .lines()
                    .take_while(|line| line.starts_with("- "))
                    .collect::<Vec<_>>()
                    .join("\n")
            });
        let content = if let Some(inventory) = attachment_inventory {
            format!(
                "{}\n\nAttachments:\n{}\n\n_Attachment contents unavailable after transcript recovery._",
                message.content,
                inventory
            )
        } else {
            message.content.clone()
        };
        transaction.execute(
            "INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis, has_revision_evidence) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![message.id, chat.id, offset as i64 + 1, message.role, message.status, content, message.part, to_i64(chat.created)?, message.role == "assistant"],
        ).map_err(|error| error.to_string())?;
        if let Some((_, sources)) = message.footer.split_once("Sources:\n") {
            let mut target = None;
            let mut title = String::new();
            for event in Parser::new(sources) {
                match event {
                    Event::Start(Tag::Link { dest_url, .. }) => {
                        target = Some(dest_url.to_string());
                        title.clear();
                    }
                    Event::Text(text) if target.is_some() => title.push_str(&text),
                    Event::End(TagEnd::Link) => {
                        if let Some(target) = target.take() {
                            let web =
                                target.starts_with("https://") || target.starts_with("http://");
                            transaction.execute("INSERT INTO chat_sources (message_id, kind, title, excerpt, url, note_path) VALUES (?1, ?2, ?3, '', ?4, ?5)", params![message.id, if web { "web" } else { "note" }, title, web.then_some(&target), (!web).then_some(&target)]).map_err(|error| error.to_string())?;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    // Remembered quotes are explicit user choices in Conversation.md. Recover
    // only quotes whose stable excerpt anchor still belongs to a message.
    let remembered = regex::Regex::new(
        r"(?m)^((?:> .*\n)+)> — \[\[Part [0-9]+#\^([A-Za-z0-9_-]+)\|source\]\]\n\^([A-Za-z0-9_-]+)$",
    )
    .unwrap();
    for capture in remembered.captures_iter(&chat.index_body) {
        let anchor = &capture[2];
        if anchor != &capture[3] {
            continue;
        }
        if let Some(message) = chat.messages.iter().find(|message| {
            message
                .footer
                .lines()
                .any(|line| line == format!("^{anchor}"))
        }) {
            let quote = capture[1]
                .lines()
                .map(|line| line.strip_prefix("> ").unwrap_or(line))
                .collect::<Vec<_>>()
                .join("\n");
            transaction.execute("INSERT INTO chat_excerpts (id, conversation_id, message_id, start_offset, end_offset, quote, anchor, remembered, created_at_millis) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5, 1, ?6)", params![generate_id("excerpt"), chat.id, message.id, quote, anchor, to_i64(chat.created)?]).map_err(|error| error.to_string())?;
        }
    }
    for (path, markdown) in &chat.files {
        transaction.execute("INSERT INTO chat_projection_files (conversation_id, path, content_hash) VALUES (?1, ?2, ?3)", params![chat.id, path.to_string_lossy(), content_hash(markdown)]).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestDir;

    fn fixture(name: &str) -> (TestDir, ChatService, String, PathBuf) {
        let root = TestDir::new(name);
        let data = root.path().join(".gneauxghts");
        fs::create_dir_all(&data).unwrap();
        let service = ChatService::new(root.path().into(), data).unwrap();
        let chat = service
            .create_conversation(
                Some("Recovered conversation".into()),
                Some(VaultAccess::Full),
            )
            .unwrap();
        let connection = service.connection().unwrap();
        for (id, ordinal, role, status, content, part) in [
            ("recovery-user", 1, "user", "complete", "What about **this**?\n\n```md\n## Thought partner\n\n^msg_fake\n```\n\n## You\n\nLiteral heading.\n", 1),
            ("recovery-answer", 2, "assistant", "complete", "A quote.\nSecond line.", 1),
            ("recovery-interrupted", 3, "assistant", "cancelled", "Partial answer", 2),
        ] {
            connection.execute("INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)", params![id, chat.summary.id, ordinal, role, status, content, part]).unwrap();
        }
        connection.execute("INSERT INTO chat_sources (message_id, kind, title, excerpt, url) VALUES ('recovery-answer', 'web', 'Reference', '', 'https://example.com/reference')", []).unwrap();
        drop(connection);
        let excerpt = service
            .create_excerpt(
                &chat.summary.id,
                "recovery-answer",
                0,
                "A quote.\nSecond line.".len(),
            )
            .unwrap();
        service.set_excerpt_remembered(&excerpt.id, true).unwrap();
        service.write_projection(&chat.summary.id, false).unwrap();
        let directory = conversation_directory(root.path(), &chat.summary);
        (root, service, chat.summary.id, directory)
    }

    fn reopen(root: &Path) -> ChatService {
        let data = root.join(".gneauxghts");
        fs::create_dir_all(&data).unwrap();
        ChatService::new(root.into(), data).unwrap()
    }

    #[test]
    fn deleted_vault_data_recovers_chat_parts_without_rewriting_and_can_continue() {
        let (root, service, id, directory) = fixture("chat-markdown-recovery");
        let before = service.get_conversation(&id).unwrap();
        let files = ["Conversation.md", "Part 001.md", "Part 002.md"].map(|name| {
            (
                directory.join(name),
                fs::read(directory.join(name)).unwrap(),
            )
        });
        drop(service);
        fs::remove_dir_all(root.path().join(".gneauxghts")).unwrap();
        let service = reopen(root.path());
        assert_eq!(service.list_conversations().unwrap().len(), 1);
        let recovered = service.get_conversation(&id).unwrap();
        assert_eq!(recovered.summary.title, before.summary.title);
        assert_eq!(
            recovered.summary.created_at_millis,
            before.summary.created_at_millis
        );
        assert_eq!(recovered.summary.access, VaultAccess::None);
        assert!(!recovered.summary.detached);
        assert_eq!(recovered.messages.len(), 3);
        for (actual, expected) in recovered.messages.iter().zip(&before.messages) {
            assert_eq!(actual.id, expected.id);
            assert_eq!(actual.content, expected.content);
            assert_eq!(actual.role, expected.role);
            assert_eq!(actual.status, expected.status);
            assert_eq!(actual.part, expected.part);
        }
        assert_eq!(
            recovered.messages[1].sources[0].url,
            before.messages[1].sources[0].url
        );
        assert!(recovered.messages[1].has_revision_evidence);
        assert_eq!(recovered.excerpts.len(), 1);
        assert_eq!(recovered.excerpts[0].quote, before.excerpts[0].quote);
        assert!(recovered.excerpts[0].remembered);
        for (path, bytes) in &files {
            assert_eq!(fs::read(path).unwrap(), *bytes);
        }
        assert!(!service.mark_projection_detached_if_needed(&id).unwrap());
        drop(service);
        let service = reopen(root.path());
        assert_eq!(service.get_conversation(&id).unwrap().messages.len(), 3);
        service
            .rename_conversation(&id, "Continue this chat")
            .unwrap();
        service.connection().unwrap().execute("INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES ('recovery-next', ?1, 4, 'user', 'complete', 'Continue', 2, 2)", [&id]).unwrap();
        service.write_projection(&id, false).unwrap();
        let continued = service.get_conversation(&id).unwrap();
        assert_eq!(continued.messages.len(), 4);
        assert!(fs::read_to_string(directory.join("Part 002.md"))
            .unwrap()
            .contains("Continue"));
        // Genuine later edits still use the ordinary conflict boundary.
        fs::write(directory.join("Part 001.md"), "External edit").unwrap();
        assert!(service.mark_projection_detached_if_needed(&id).unwrap());
    }

    #[test]
    fn recovery_never_replaces_existing_database_chat() {
        let (root, service, id, directory) = fixture("chat-recovery-existing");
        let path = directory.join("Part 001.md");
        let edited = fs::read_to_string(&path)
            .unwrap()
            .replace("A quote.", "An external edit.");
        fs::write(&path, &edited).unwrap();
        drop(service);
        let service = reopen(root.path());
        let chat = service.get_conversation(&id).unwrap();
        assert_eq!(chat.messages[1].content, "A quote.\nSecond line.");
        assert_eq!(fs::read_to_string(&path).unwrap(), edited);
        assert!(service.mark_projection_detached_if_needed(&id).unwrap());
    }

    #[test]
    fn incomplete_recovery_is_skipped_and_retried_when_part_returns() {
        let (root, service, id, directory) = fixture("chat-recovery-missing-part");
        let path = directory.join("Part 002.md");
        let part = fs::read(&path).unwrap();
        drop(service);
        fs::remove_dir_all(root.path().join(".gneauxghts")).unwrap();
        fs::remove_file(&path).unwrap();
        let service = reopen(root.path());
        assert!(service.list_conversations().unwrap().is_empty());
        drop(service);
        fs::write(&path, part).unwrap();
        let service = reopen(root.path());
        assert_eq!(service.get_conversation(&id).unwrap().messages.len(), 3);
    }

    #[test]
    fn conflicting_message_id_rolls_back_entire_import() {
        let (root, service, id, _) = fixture("chat-recovery-collision");
        let existing = service
            .create_conversation(Some("Keep existing".into()), None)
            .unwrap();
        let connection = service.connection().unwrap();
        connection
            .execute("DELETE FROM chat_conversations WHERE id = ?1", [&id])
            .unwrap();
        // The connection's FK cascade is not enabled outside initialization.
        connection
            .execute(
                "DELETE FROM chat_messages WHERE conversation_id = ?1",
                [&id],
            )
            .unwrap();
        connection
            .execute(
                "DELETE FROM chat_projection_files WHERE conversation_id = ?1",
                [&id],
            )
            .unwrap();
        connection
            .execute(
                "DELETE FROM chat_excerpts WHERE conversation_id = ?1",
                [&id],
            )
            .unwrap();
        connection.execute("INSERT INTO chat_messages (id, conversation_id, ordinal, role, status, content, part, created_at_millis) VALUES ('recovery-answer', ?1, 1, 'user', 'complete', 'Keep me', 1, 1)", [&existing.summary.id]).unwrap();
        drop(connection);
        drop(service);
        let service = reopen(root.path());
        assert!(service.get_conversation(&id).is_err());
        assert_eq!(
            service
                .get_conversation(&existing.summary.id)
                .unwrap()
                .messages[0]
                .content,
            "Keep me"
        );
        assert_eq!(
            service
                .connection()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?1",
                    [&id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn duplicate_and_malformed_transcripts_do_not_import_partial_chats() {
        let (root, service, id, directory) = fixture("chat-recovery-ambiguous");
        let duplicate = root.path().join("Chats/duplicate");
        fs::create_dir_all(&duplicate).unwrap();
        for name in ["Conversation.md", "Part 001.md", "Part 002.md"] {
            fs::copy(directory.join(name), duplicate.join(name)).unwrap();
        }
        drop(service);
        fs::remove_dir_all(root.path().join(".gneauxghts")).unwrap();
        let service = reopen(root.path());
        assert!(service.list_conversations().unwrap().is_empty());
        drop(service);
        fs::remove_dir_all(duplicate).unwrap();
        let path = directory.join("Part 001.md");
        let original = fs::read_to_string(&path).unwrap();
        fs::write(
            &path,
            original.replace("^msg_recovery-answer", "missing-anchor"),
        )
        .unwrap();
        let service = reopen(root.path());
        assert!(service.get_conversation(&id).is_err());
        drop(service);
        fs::write(path, original).unwrap();
        let service = reopen(root.path());
        assert_eq!(service.get_conversation(&id).unwrap().messages.len(), 3);
    }

    #[cfg(unix)]
    #[test]
    fn recovery_does_not_follow_symlinked_chat_roots_or_parts() {
        let (outside, service, id, directory) = fixture("chat-recovery-outside");
        drop(service);
        let root = TestDir::new("chat-recovery-symlink");
        std::os::unix::fs::symlink(outside.path().join("Chats"), root.path().join("Chats"))
            .unwrap();
        assert!(reopen(root.path()).list_conversations().unwrap().is_empty());
        let path = directory.join("Part 001.md");
        let moved = outside.path().join("moved.md");
        fs::rename(&path, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &path).unwrap();
        fs::remove_dir_all(outside.path().join(".gneauxghts")).unwrap();
        assert!(reopen(outside.path()).get_conversation(&id).is_err());
    }

    #[test]
    fn attachment_inventory_remains_visible_without_fabricating_attachment_bytes() {
        let (root, service, id, directory) = fixture("chat-recovery-attachments");
        service.connection().unwrap().execute("INSERT INTO chat_message_attachments (id, message_id, kind, name, mime_type, size_bytes, data_base64, created_at_millis) VALUES ('attachment-recovery', 'recovery-user', 'file', 'document.pdf', 'application/pdf', 1, 'AA==', 1)", []).unwrap();
        service.write_projection(&id, false).unwrap();
        drop(service);
        fs::remove_dir_all(root.path().join(".gneauxghts")).unwrap();
        let service = reopen(root.path());
        let chat = service.get_conversation(&id).unwrap();
        assert!(chat.messages[0].attachments.is_empty());
        assert!(chat.messages[0]
            .content
            .contains("document.pdf (application/pdf)"));
        assert!(chat.messages[0]
            .content
            .contains("Attachment contents unavailable"));
        service
            .rename_conversation(&id, "Keep attachment inventory")
            .unwrap();
        assert!(fs::read_to_string(directory.join("Part 001.md"))
            .unwrap()
            .contains("document.pdf"));
    }
}
