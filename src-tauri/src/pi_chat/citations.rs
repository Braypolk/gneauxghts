//! Terminal citation admission. Native receipts, never Markdown, authorize sources.
use super::{
    authority::{AuthorityStore, ConversationBinding, DomainError, DomainResult},
    notes::{self, ReadSource, ReadState, SourceLocation},
};
use crate::{index::AppState, services::content_hash::canonical_content_hash};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AnswerSegment {
    pub text: String,
    pub sources: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AnswerSegments {
    pub segments: Vec<AnswerSegment>,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum SourceDestination {
    Note {
        #[serde(rename = "noteId")]
        note_id: String,
        path: String,
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        limitation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        location: Option<SourceLocation>,
    },
    Unavailable {
        code: String,
        message: String,
    },
}
fn unavailable(code: &str, message: &str) -> SourceDestination {
    SourceDestination::Unavailable {
        code: code.into(),
        message: message.into(),
    }
}
fn valid_id(id: &str) -> bool {
    id.len() == 48
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn admit_segments(
    answer: AnswerSegments,
    mut source: impl FnMut(&str) -> DomainResult<ReadSource>,
) -> DomainResult<String> {
    let mut markdown = String::new();
    for segment in answer.segments {
        // Do not trust a WebView parser to hide source targets in literal text.
        if segment.text.contains("gneauxghts-source:") {
            return Err(DomainError::new(
                "invalid_answer",
                "Citation markup was not admitted.",
            ));
        }
        markdown.push_str(&segment.text);
        for id in segment.sources {
            if !valid_id(&id) {
                markdown.push_str("[citation unavailable]");
                continue;
            }
            let issued = match source(&id) {
                Ok(issued) => issued,
                Err(error)
                    if matches!(error.code.as_str(), "unknown_source" | "unavailable_note") =>
                {
                    markdown.push_str("[citation unavailable]");
                    continue;
                }
                Err(error) => return Err(error),
            };
            if issued.source_id != id {
                return Err(DomainError::new(
                    "storage",
                    "Read source metadata is unavailable.",
                ));
            }
            markdown.push_str(&issued.citation());
        }
    }
    Ok(markdown)
}

pub(crate) fn admit_answers(
    state: &AppState,
    store: &AuthorityStore,
    authority_id: &str,
    binding: &ConversationBinding,
    answers: Vec<AnswerSegments>,
) -> DomainResult<Vec<String>> {
    let lease = store.validate_binding(authority_id, binding)?;
    // Atomic across all text blocks, including an empty tool-only response.
    store.with_authority(
        authority_id,
        Some(lease.snapshot.revision),
        |connection, snapshot| {
            answers
                .into_iter()
                .map(|answer| {
                    admit_segments(answer, |id| {
                        let receipt = notes::receipt_in(connection, snapshot, id)?;
                        notes::validate_source_note(
                            state,
                            snapshot,
                            connection,
                            &receipt.source.note_id,
                        )?;
                        Ok(receipt.source)
                    })
                })
                .collect()
        },
    )
}
pub(crate) fn open_source(
    state: &AppState,
    store: &AuthorityStore,
    authority_id: &str,
    source_id: &str,
) -> DomainResult<SourceDestination> {
    store.with_authority(authority_id, None, |connection, snapshot| {
        if !valid_id(source_id) { return Ok(unavailable("unknown_source", "This source is unavailable.")); }
        let receipt = match notes::receipt_in(connection, snapshot, source_id) {
            Ok(receipt) => receipt,
            Err(error) if matches!(error.code.as_str(), "unknown_source" | "unavailable_note") => return Ok(unavailable(&error.code, &error.message)),
            Err(error) => return Err(error),
        };
        let current = match notes::source_navigation_content(state, snapshot, connection, &receipt.source.note_id) {
            Ok(current) => current,
            Err(error) if error.code == "unavailable_note" => return Ok(unavailable(&error.code, &error.message)),
            Err(error) => return Err(error),
        };
        let ReadSource { note_id, read_state, location, .. } = receipt.source;
        let read_hash = match read_state {
            ReadState::Revision { content_hash, .. } | ReadState::Observed { content_hash, .. } => content_hash,
        };
        let mut limitation = (read_hash != canonical_content_hash(&current.markdown))
            .then(|| "This note has changed since the cited read. Opening the current note.".to_string());
        let location = location.filter(|location| {
            if notes::unique_quote(&current.markdown, &location.quote) { return true; }
            limitation = Some("The cited passage changed or is no longer unique. Opening the current note without selecting a passage.".into());
            false
        });
        Ok(SourceDestination::Note { note_id, path: current.path.to_string_lossy().into_owned(), title: current.title, limitation, location })
    })
}
#[tauri::command]
pub(crate) async fn pi_chat_admit_answer(
    app: tauri::AppHandle,
    authority_id: String,
    conversation_id: u64,
    provider_session_id: String,
    answers: Vec<AnswerSegments>,
) -> DomainResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        admit_answers(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &authority_id,
            &ConversationBinding {
                conversation_id,
                provider_session_id,
            },
            answers,
        )
    })
    .await
    .map_err(|_| DomainError::new("unavailable", "Citation admission was interrupted."))?
}
#[tauri::command]
pub(crate) async fn pi_chat_open_source(
    app: tauri::AppHandle,
    authority_id: String,
    source_id: String,
) -> DomainResult<SourceDestination> {
    tauri::async_runtime::spawn_blocking(move || {
        open_source(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &authority_id,
            &source_id,
        )
    })
    .await
    .map_err(|_| DomainError::new("unavailable", "Source navigation was interrupted."))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(id: &str) -> ReadSource {
        ReadSource {
            source_id: id.into(),
            note_id: "note".into(),
            title: "Native title".into(),
            read_state: ReadState::Observed {
                content_hash: "old-authored-hash".into(),
                observed_at_millis: 1,
            },
            location: None,
        }
    }
    fn answer(text: &str, ids: &[&str]) -> AnswerSegments {
        AnswerSegments {
            segments: vec![AnswerSegment {
                text: text.into(),
                sources: ids.iter().map(|id| (*id).into()).collect(),
            }],
        }
    }
    #[test]
    fn only_issued_ids_become_links_and_duplicate_relationships_are_unique() {
        let id = "a".repeat(48);
        let invented = "b".repeat(48);
        let admitted = admit_segments(
            answer("Claim ", &[&id, &invented, "malformed", &id]),
            |value| {
                if value == id {
                    Ok(source(value))
                } else {
                    Err(DomainError::new("unknown_source", "Unknown"))
                }
            },
        )
        .unwrap();
        assert!(admitted.contains("[Note: Native title](gneauxghts-source:"));
        assert_eq!(admitted.matches("gneauxghts-source:").count(), 2);
        assert_eq!(admitted.matches("[citation unavailable]").count(), 2);
    }
    #[test]
    fn source_free_markdown_passes_and_unparsed_reserved_text_fails() {
        let markdown = "## Summary\nOrdinary **Markdown**.";
        assert_eq!(
            admit_segments(answer(markdown, &[]), |_| panic!("no lookup")).unwrap(),
            markdown
        );
        for text in [
            "gneauxghts-source:invented",
            "[spoof](gneauxghts-source:invented)",
        ] {
            assert_eq!(
                admit_segments(answer(text, &[]), |_| panic!("no lookup"))
                    .unwrap_err()
                    .code,
                "invalid_answer"
            );
        }
    }
    #[test]
    fn storage_failures_do_not_silently_admit_and_old_hash_is_not_compared() {
        let id = "a".repeat(48);
        let admitted =
            admit_segments(answer("Earlier read ", &[&id]), |value| Ok(source(value))).unwrap();
        assert!(admitted.contains(&format!("gneauxghts-source:{id}")));
        let failed = admit_segments(answer("Claim ", &[&id]), |_| {
            Err(DomainError::new("storage", "Unavailable"))
        })
        .unwrap_err();
        assert_eq!(failed.code, "storage");
    }
}
