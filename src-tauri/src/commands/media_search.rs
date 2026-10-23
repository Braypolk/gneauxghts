//! Interactive image search only. Agent evidence remains canonical text.
use crate::{
    search::NoteSearchResult,
    semantic::images::ImageMatch,
    services::note_timeline::{AllowedScope, CurrentContentIdentity, CurrentContentItem},
};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum MediaSearchResult {
    Image(ImageMatch),
    Passage(NoteSearchResult),
}

impl CurrentContentItem for MediaSearchResult {
    fn current_note_identity(&self) -> CurrentContentIdentity<'_> {
        match self {
            Self::Image(item) => CurrentContentIdentity::Note {
                // Imported notes can have a current path before their first
                // canonical save assigns a stable ID. Match passage admission:
                // let NoteTimeline resolve the path, never assert an empty ID.
                note_id: (!item.note_id.trim().is_empty()).then_some(item.note_id.as_str()),
                note_path: Some(&item.note_path),
            },
            Self::Passage(item) => item.current_note_identity(),
        }
    }
}

#[tauri::command]
pub(crate) async fn search_media(
    app: tauri::AppHandle,
    query: Option<String>,
    image_base64: Option<String>,
    include_passages: Option<bool>,
    include_images: Option<bool>,
    modified_since_millis: Option<u64>,
) -> Result<Vec<MediaSearchResult>, String> {
    if image_base64.is_none() && query.as_ref().is_none_or(|text| text.trim().is_empty()) {
        return Err("Supply a text query, an image, or both.".into());
    }
    if image_base64.is_some() && query.as_ref().is_some_and(|text| text.len() > 4096) {
        return Err("Image search refinement must be at most 4 KiB of text.".into());
    }
    // O(1) admission on IPC; byte decoding stays on the app worker.
    if image_base64
        .as_ref()
        .is_some_and(|s| s.len() > crate::semantic::image_input::MAX_ENCODED_BYTES.div_ceil(3) * 4)
    {
        return Err("Image exceeds the 20 MiB limit.".into());
    }
    super::on_app_worker(app, move |state| {
        let image_bytes = decode_image(
            image_base64,
            crate::semantic::image_input::MAX_ENCODED_BYTES,
        )?;
        let root = super::prepare_notes_dir(state, false)?;
        state.ensure_interactive_index(&root, "media_search")?;
        let parsed = query.as_deref().map(crate::tags::TagQuery::parse);
        let allowed = state
            .notes_index
            .lock()
            .map_err(|_| "Notes index unavailable")?
            .entries
            .iter()
            .filter(|(_, note)| {
                note.document_kind == crate::note::DocumentKind::Note
                    && modified_since_millis.is_none_or(|cutoff| note.modified_millis >= cutoff)
                    && parsed.as_ref().is_none_or(|q| q.matches(&note.tags))
            })
            .map(|(p, _)| p.to_string_lossy().into_owned())
            .collect::<HashSet<_>>();
        state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .read(|| {
                let (images, passages) = state.semantic.media_matches(
                    parsed.as_ref().map(|q| q.text.as_str()),
                    image_bytes.as_deref(),
                    Some(&allowed),
                    &root,
                    include_passages.unwrap_or(true),
                    include_images.unwrap_or(true),
                )?;
                let image_count = images.len();
                let mut results = images
                    .into_iter()
                    .map(MediaSearchResult::Image)
                    .collect::<Vec<_>>();
                for passage in passages {
                    let note_id =
                        state.indexed_note_identity(std::path::Path::new(&passage.note_path))?;
                    results.push(MediaSearchResult::Passage(NoteSearchResult {
                        note_id,
                        note_path: Some(passage.note_path),
                        document_kind: passage.document_kind,
                        file_name: passage.note_title,
                        section_label: passage.section_label,
                        excerpt: passage.excerpt,
                        match_text: passage.match_text,
                        highlight_ranges: Vec::new(),
                        reason_labels: vec!["semantic".into()],
                        lexical_score: None,
                        semantic_score: Some(passage.score),
                        start_line: Some(passage.start_line),
                        end_line: Some(passage.end_line),
                        block_anchor: passage.block_anchor,
                    }));
                }
                let passages = results.split_off(image_count);
                // Independent channel ranks; raw modality cosine scales never
                // enter the cross-channel result order.
                let mut fused = Vec::new();
                let mut passages = passages.into_iter();
                let mut images = results.into_iter();
                loop {
                    let passage = passages.next();
                    let image = images.next();
                    if passage.is_none() && image.is_none() {
                        break;
                    }
                    fused.extend(passage);
                    fused.extend(image);
                }
                Ok(fused)
            })
    })
    .await?
}

#[tauri::command]
pub(crate) async fn validate_image_search_result(
    app: tauri::AppHandle,
    item: ImageMatch,
    current_markdown: String,
) -> Result<bool, String> {
    super::on_app_worker(app, move |state| {
        let root = super::prepare_notes_dir(state, false)?;
        let valid = crate::semantic::images::is_current(&root, &item)
            && std::fs::read_to_string(&item.note_path).is_ok_and(|markdown| {
                crate::semantic::images::editor_body(&markdown, &item.note_path) == current_markdown
            });
        let admitted = state
            .note_timeline()
            .current_content(AllowedScope::vault())
            .read(|| {
                Ok(if valid {
                    vec![MediaSearchResult::Image(item)]
                } else {
                    Vec::new()
                })
            })?;
        Ok(!admitted.is_empty())
    })
    .await?
}

// Thumbnail reads/decodes share one memory budget across result components.
static THUMBNAIL_WORK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Search previews are capped at 160×128; original encoded bytes never reach the UI.
#[tauri::command]
pub(crate) async fn read_image_search_thumbnail(
    app: tauri::AppHandle,
    file_name: String,
    asset_hash: String,
) -> Result<String, String> {
    super::on_app_worker(app, move |state| {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let _decode = THUMBNAIL_WORK
            .lock()
            .map_err(|_| "Thumbnail decoder unavailable")?;
        let root = super::prepare_notes_dir(state, false)?;
        let bytes = crate::semantic::images::read_asset(&root, &file_name)?;
        if blake3::hash(&bytes).to_hex().as_str() != asset_hash {
            return Err("Image changed; refresh search.".into());
        }
        let png = crate::semantic::image_input::thumbnail(&bytes)?;
        Ok(format!("data:image/png;base64,{}", STANDARD.encode(png)))
    })
    .await?
}

fn decode_image(encoded: Option<String>, limit: usize) -> Result<Option<Vec<u8>>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    encoded
        .map(|encoded| {
            if encoded.len() > limit.div_ceil(3) * 4 {
                return Err("Image exceeds the 20 MiB limit.".into());
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "Invalid image encoding.".to_string())?;
            if bytes.len() > limit {
                return Err("Image exceeds the 20 MiB limit.".into());
            }
            Ok(bytes)
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imported_image_results_use_current_path_admission_until_identity_is_stable() {
        let mut item = ImageMatch {
            note_id: String::new(),
            note_path: "/vault/Imported.md".into(),
            note_title: "Imported".into(),
            note_hash: "note".into(),
            asset_name: "image.png".into(),
            asset_hash: "image".into(),
            source_start: 0,
            source_end: 20,
            score: 1.0,
        };
        let result = MediaSearchResult::Image(item.clone());
        assert!(matches!(
            result.current_note_identity(),
            CurrentContentIdentity::Note {
                note_id: None,
                note_path: Some("/vault/Imported.md")
            }
        ));
        item.note_id = "stable-id".into();
        let result = MediaSearchResult::Image(item);
        assert!(matches!(
            result.current_note_identity(),
            CurrentContentIdentity::Note {
                note_id: Some("stable-id"),
                note_path: Some("/vault/Imported.md")
            }
        ));
    }
    #[test]
    fn query_payload_limit_counts_decoded_bytes_and_rejects_invalid_encoding() {
        assert_eq!(decode_image(None, 3).unwrap(), None);
        assert_eq!(
            decode_image(Some("YWJj".into()), 3).unwrap().unwrap(),
            b"abc"
        );
        assert!(decode_image(Some("YWJj".into()), 2).is_err());
        assert!(decode_image(Some("YWJjZGVm".into()), 3).is_err());
        assert!(decode_image(Some("bad!".into()), 3).is_err());
    }
}
