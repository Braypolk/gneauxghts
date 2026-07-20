use super::similarity::MIN_SEMANTIC_MATCH_SCORE;
use super::{
    chunking, content_hash, load_note_record, load_related_note_previews,
    load_related_note_previews_for_paths, open_database, ActiveSemanticState, RelatedNoteMatch,
    RelatedNotesResponse, SemanticChunkMatch,
};
use std::{fs, sync::atomic::Ordering, time::Instant};

const RELATED_QUERY_CACHE_LIMIT: usize = 32;
const MIN_RELATED_NOTE_CHARS: usize = 80;
const MIN_RELATED_SELECTION_CHARS: usize = 48;
/// Keep related-note query embeddings under the llama-server physical batch
/// limit (512 tokens). ~1600 chars stays safely below that for this model.
const MAX_RELATED_QUERY_CHARS: usize = 1600;

impl ActiveSemanticState {
    pub(super) fn related_notes(
        &self,
        current_path: Option<&str>,
        current_title: &str,
        current_markdown: &str,
        selected_text: Option<&str>,
        limit: usize,
    ) -> Result<RelatedNotesResponse, String> {
        let started_at = Instant::now();
        let scope = related_scope_label(selected_text);
        let normalized_markdown = normalize_related_text(current_markdown);
        let normalized_selection = selected_text
            .map(normalize_related_text)
            .filter(|text| !text.is_empty());

        if !self.get_settings()?.semantic_search_enabled {
            let response = RelatedNotesResponse {
                status: "unavailable".to_string(),
                scope: scope.clone(),
                reason: Some("Semantic search is disabled in Settings.".to_string()),
                items: Vec::new(),
            };
            self.record_related_response(
                &scope,
                &response.status,
                "disabled",
                response.items.len(),
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(response);
        }

        if selected_text.is_some()
            && normalized_selection
                .as_ref()
                .is_none_or(|text| text.chars().count() < MIN_RELATED_SELECTION_CHARS)
        {
            let response = RelatedNotesResponse {
                status: "insufficientContent".to_string(),
                scope: scope.clone(),
                reason: Some("Select a larger passage to find section-specific notes.".to_string()),
                items: Vec::new(),
            };
            self.record_related_response(
                &scope,
                &response.status,
                "none",
                0,
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(response);
        }

        if selected_text.is_none() && normalized_markdown.chars().count() < MIN_RELATED_NOTE_CHARS {
            let response = RelatedNotesResponse {
                status: "insufficientContent".to_string(),
                scope: scope.clone(),
                reason: Some("Write a bit more before looking for related notes.".to_string()),
                items: Vec::new(),
            };
            self.record_related_response(
                &scope,
                &response.status,
                "none",
                0,
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(response);
        }

        let revision = self.index_revision.load(Ordering::Acquire);
        let cache_key = build_related_cache_key(
            revision,
            current_path,
            current_title,
            current_markdown,
            normalized_selection.as_deref(),
            limit,
        );
        if let Some(cached) = self.lookup_related_query_cache(&cache_key, revision)? {
            self.record_related_response(
                &scope,
                &cached.status,
                "cache",
                cached.items.len(),
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            );
            return Ok(cached);
        }

        let connection = open_database(&self.db_path)?;
        super::ensure_schema(&connection)?;
        let effective_limit = limit.max(1);
        let edges_stale = super::db::edges_are_stale_for_generation(
            &connection,
            self.note_ann.model_signature(),
            self.note_ann.generation_id().as_deref(),
        )? || self
            .runtime
            .lock()
            .map(|runtime| runtime.edges_stale)
            .unwrap_or(true);

        let (response, strategy) = if normalized_selection.is_none() {
            if let Some(items) =
                self.related_from_edges(&connection, current_path, edges_stale, effective_limit)?
            {
                (
                    RelatedNotesResponse {
                        status: "ready".to_string(),
                        scope: "note".to_string(),
                        reason: None,
                        items,
                    },
                    "edges",
                )
            } else if let Some(items) =
                self.related_from_note_ann(&connection, current_path, effective_limit)?
            {
                (
                    RelatedNotesResponse {
                        status: "ready".to_string(),
                        scope: "note".to_string(),
                        reason: None,
                        items,
                    },
                    "note_ann",
                )
            } else {
                self.related_from_semantic_query(
                    "note",
                    &build_note_query_text(current_title, current_markdown),
                    current_path,
                    effective_limit,
                )?
            }
        } else {
            let query_text = truncate_related_query(&build_selection_query_text(
                current_title,
                current_markdown,
                normalized_selection.as_deref().unwrap_or_default(),
            ));
            self.related_from_semantic_query(
                "selection",
                &query_text,
                current_path,
                effective_limit,
            )?
        };

        // Don't cache unavailable/warming responses — the index may become ready
        // without bumping the related-query cache revision.
        if response.status == "ready" {
            self.store_related_query_cache(cache_key, revision, response.clone())?;
        }
        self.record_related_response(
            &scope,
            &response.status,
            strategy,
            response.items.len(),
            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        );
        Ok(response)
    }

    fn related_from_edges(
        &self,
        connection: &rusqlite::Connection,
        current_path: Option<&str>,
        edges_stale: bool,
        limit: usize,
    ) -> Result<Option<Vec<RelatedNoteMatch>>, String> {
        let Some(note_path) = current_path.filter(|path| !path.is_empty()) else {
            return Ok(None);
        };
        if edges_stale {
            return Ok(None);
        }
        let Some(stored) = load_note_record(connection, note_path)? else {
            return Ok(None);
        };
        // Compare against on-disk content (what the indexer hashed), not the
        // editor body. The frontend sends title-stripped body markdown, so
        // hashing that never matched the stored full-file content hash and
        // permanently skipped the edges shortcut.
        if !indexed_note_matches_disk(note_path, &stored.content_hash) {
            return Ok(None);
        }

        let items = load_related_note_previews(connection, note_path, limit)?
            .into_iter()
            .map(related_match_from_preview)
            .collect::<Vec<_>>();
        if items.is_empty() {
            return Ok(None);
        }
        Ok(Some(items))
    }

    fn related_from_note_ann(
        &self,
        connection: &rusqlite::Connection,
        current_path: Option<&str>,
        limit: usize,
    ) -> Result<Option<Vec<RelatedNoteMatch>>, String> {
        let Some(note_path) = current_path.filter(|path| !path.is_empty()) else {
            return Ok(None);
        };
        let note_ann_status = self.note_ann.status_snapshot();
        if !note_ann_status.loaded || note_ann_status.indexed_notes == 0 {
            return Ok(None);
        }

        let neighbors = self.note_ann.neighbors_for_note(
            connection,
            note_path,
            limit.saturating_mul(4).max(16),
            limit,
        )?;
        if neighbors.is_empty() {
            return Ok(None);
        }

        let scored_paths = neighbors
            .into_iter()
            .filter(|neighbor| neighbor.score >= MIN_SEMANTIC_MATCH_SCORE)
            .map(|neighbor| (neighbor.note_path, neighbor.score))
            .collect::<Vec<_>>();
        if scored_paths.is_empty() {
            return Ok(None);
        }

        let items = load_related_note_previews_for_paths(connection, &scored_paths)?
            .into_iter()
            .map(related_match_from_preview)
            .collect::<Vec<_>>();
        if items.is_empty() {
            return Ok(None);
        }
        Ok(Some(items))
    }

    fn related_from_semantic_query(
        &self,
        response_scope: &str,
        query_text: &str,
        current_path: Option<&str>,
        limit: usize,
    ) -> Result<(RelatedNotesResponse, &'static str), String> {
        let ann_status = self.ann.status_snapshot();
        if !ann_status.loaded || ann_status.indexed_chunks == 0 {
            return Ok((
                RelatedNotesResponse {
                    status: "unavailable".to_string(),
                    scope: response_scope.to_string(),
                    reason: Some(
                        "Semantic index is still warming up or has not been built yet.".to_string(),
                    ),
                    items: Vec::new(),
                },
                "semantic",
            ));
        }

        let matches =
            match self.semantic_matches_for_text(query_text, current_path, limit.saturating_mul(4))
            {
                Ok(matches) => matches,
                Err(_) => {
                    return Ok((
                    RelatedNotesResponse {
                        status: "unavailable".to_string(),
                        scope: response_scope.to_string(),
                        reason: Some(
                            "Related notes could not be computed from the current note right now."
                                .to_string(),
                        ),
                        items: Vec::new(),
                    },
                    "semantic",
                ));
                }
            };

        Ok((
            RelatedNotesResponse {
                status: "ready".to_string(),
                scope: response_scope.to_string(),
                reason: None,
                items: collapse_related_matches(matches, limit),
            },
            "semantic",
        ))
    }

    fn record_related_response(
        &self,
        scope: &str,
        status: &str,
        strategy: &str,
        item_count: usize,
        elapsed: u64,
    ) {
        self.debug.record_timing(
            "related",
            "related_completed",
            Some(format!(
                "scope={scope} status={status} strategy={strategy} items={item_count}"
            )),
            elapsed,
            |metrics| {
                metrics.related_request_count += 1;
                if scope == "selection" {
                    metrics.related_selection_request_count += 1;
                } else {
                    metrics.related_note_request_count += 1;
                }
                match strategy {
                    "cache" => metrics.related_cache_hit_count += 1,
                    "edges" => metrics.related_edge_reuse_count += 1,
                    "note_ann" => metrics.related_note_ann_count += 1,
                    "semantic" => metrics.related_semantic_query_count += 1,
                    _ => {}
                }
                if status == "insufficientContent" {
                    metrics.related_insufficient_content_count += 1;
                }
                if status == "unavailable" {
                    metrics.related_unavailable_count += 1;
                }
                metrics.related_result_total += item_count as u64;
                metrics.related_duration_total_millis += elapsed;
                metrics.related_duration_max_millis =
                    metrics.related_duration_max_millis.max(elapsed);
            },
        );
    }

    fn lookup_related_query_cache(
        &self,
        key: &str,
        revision: u64,
    ) -> Result<Option<RelatedNotesResponse>, String> {
        let cache = self
            .related_query_cache
            .lock()
            .map_err(|_| "Related query cache lock poisoned".to_string())?;
        Ok(cache
            .iter()
            .find(|(cached_key, cached_revision, _)| {
                *cached_revision == revision && cached_key == key
            })
            .map(|(_, _, response)| response.clone()))
    }

    fn store_related_query_cache(
        &self,
        key: String,
        revision: u64,
        response: RelatedNotesResponse,
    ) -> Result<(), String> {
        let mut cache = self
            .related_query_cache
            .lock()
            .map_err(|_| "Related query cache lock poisoned".to_string())?;
        cache.retain(|(_, cached_revision, _)| *cached_revision == revision);
        cache.retain(|(cached_key, _, _)| cached_key != &key);
        cache.push((key, revision, response));
        if cache.len() > RELATED_QUERY_CACHE_LIMIT {
            let overflow = cache.len() - RELATED_QUERY_CACHE_LIMIT;
            cache.drain(0..overflow);
        }
        Ok(())
    }
}

pub(super) fn related_scope_label(selected_text: Option<&str>) -> String {
    if selected_text.is_some() {
        "selection".to_string()
    } else {
        "note".to_string()
    }
}

pub(super) fn build_excerpt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let excerpt = trimmed.chars().take(max_chars).collect::<String>();
    format!("{}…", excerpt.trim_end())
}

fn normalize_related_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_related_query(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= MAX_RELATED_QUERY_CHARS {
        return trimmed.to_string();
    }

    let truncated = trimmed
        .chars()
        .take(MAX_RELATED_QUERY_CHARS)
        .collect::<String>();
    format!("{}…", truncated.trim_end())
}

fn build_note_query_text(current_title: &str, current_markdown: &str) -> String {
    let body = normalize_related_text(current_markdown);
    let query = if current_title.trim().is_empty() {
        body
    } else {
        format!("{}\n\n{body}", current_title.trim())
    };
    truncate_related_query(&query)
}

fn indexed_note_matches_disk(note_path: &str, stored_content_hash: &str) -> bool {
    fs::read_to_string(note_path)
        .ok()
        .is_some_and(|disk| content_hash(&disk) == stored_content_hash)
}

fn related_match_from_preview(preview: super::db::StoredRelatedNotePreview) -> RelatedNoteMatch {
    RelatedNoteMatch {
        note_path: preview.note_path,
        note_title: preview.note_title,
        section_label: preview.section_label,
        excerpt: build_excerpt(&preview.text, 180),
        match_text: preview.text,
        score: preview.score,
        start_line: preview.start_line,
        end_line: preview.end_line,
        document_kind: preview.document_kind,
        block_anchor: preview.block_anchor,
    }
}

fn build_related_cache_key(
    revision: u64,
    current_path: Option<&str>,
    current_title: &str,
    current_markdown: &str,
    selected_text: Option<&str>,
    limit: usize,
) -> String {
    let scope = if selected_text.is_some() {
        "selection"
    } else {
        "note"
    };
    let base_hash = content_hash(&format!("{current_title}\n{current_markdown}"));
    let selected_hash = selected_text
        .map(content_hash)
        .unwrap_or_else(|| "none".to_string());
    format!(
        "{revision}:{scope}:{}:{base_hash}:{selected_hash}:{limit}",
        current_path.unwrap_or("")
    )
}

fn build_selection_query_text(
    current_title: &str,
    current_markdown: &str,
    selected_text: &str,
) -> String {
    let chunked = chunking::chunk_markdown(current_markdown, current_title);
    if chunked.title.trim().is_empty() {
        selected_text.to_string()
    } else {
        format!("{}\n\n{}", chunked.title.trim(), selected_text)
    }
}

fn collapse_related_matches(
    matches: Vec<SemanticChunkMatch>,
    limit: usize,
) -> Vec<RelatedNoteMatch> {
    let mut collapsed = Vec::<RelatedNoteMatch>::new();

    for candidate in matches {
        if let Some(existing) = collapsed
            .iter_mut()
            .find(|existing| existing.note_path == candidate.note_path)
        {
            if candidate.score > existing.score {
                *existing = RelatedNoteMatch {
                    note_path: candidate.note_path,
                    note_title: candidate.note_title,
                    section_label: candidate.section_label,
                    excerpt: candidate.excerpt,
                    match_text: candidate.match_text,
                    score: candidate.score,
                    start_line: candidate.start_line,
                    end_line: candidate.end_line,
                    document_kind: candidate.document_kind,
                    block_anchor: candidate.block_anchor,
                };
            }
            continue;
        }

        collapsed.push(RelatedNoteMatch {
            note_path: candidate.note_path,
            note_title: candidate.note_title,
            section_label: candidate.section_label,
            excerpt: candidate.excerpt,
            match_text: candidate.match_text,
            score: candidate.score,
            start_line: candidate.start_line,
            end_line: candidate.end_line,
            document_kind: candidate.document_kind,
            block_anchor: candidate.block_anchor,
        });
    }

    collapsed.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.note_title.cmp(&right.note_title))
            .then_with(|| left.note_path.cmp(&right.note_path))
    });
    collapsed.truncate(limit);
    collapsed
}

#[cfg(test)]
mod tests {
    use super::{
        build_note_query_text, indexed_note_matches_disk, truncate_related_query,
        MAX_RELATED_QUERY_CHARS,
    };
    use crate::semantic::db::content_hash;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn truncate_related_query_keeps_short_text() {
        assert_eq!(truncate_related_query("  hello world  "), "hello world");
    }

    #[test]
    fn truncate_related_query_caps_long_text() {
        let long = "x".repeat(MAX_RELATED_QUERY_CHARS + 40);
        let truncated = truncate_related_query(&long);
        assert!(truncated.chars().count() <= MAX_RELATED_QUERY_CHARS + 1);
        assert!(truncated.ends_with('…'));
    }

    #[test]
    fn build_note_query_text_includes_title_and_truncates() {
        let body = "word ".repeat(800);
        let query = build_note_query_text("Ceremony", &body);
        assert!(query.starts_with("Ceremony"));
        assert!(query.chars().count() <= MAX_RELATED_QUERY_CHARS + 1);
    }

    #[test]
    fn indexed_note_matches_disk_compares_full_file_hash() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("gneauxghts-related-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("note.md");
        let contents = "---\nid: abc\n---\n\n# Title\n\nBody text here.\n";
        fs::write(&path, contents).expect("write note");
        let hash = content_hash(contents);
        assert!(indexed_note_matches_disk(
            path.to_str().expect("utf8 path"),
            &hash
        ));
        assert!(!indexed_note_matches_disk(
            path.to_str().expect("utf8 path"),
            &content_hash("Body text here.\n")
        ));
        let _ = fs::remove_dir_all(&dir);
    }
}
