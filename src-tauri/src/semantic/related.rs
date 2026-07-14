use super::{
    chunking, content_hash, load_note_record, load_related_note_previews, open_database,
    ActiveSemanticState, RelatedNoteMatch, RelatedNotesResponse, SemanticChunkMatch,
};
use std::{sync::atomic::Ordering, time::Instant};

const RELATED_QUERY_CACHE_LIMIT: usize = 32;
const MIN_RELATED_NOTE_CHARS: usize = 80;
const MIN_RELATED_SELECTION_CHARS: usize = 48;

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
            match current_path
                .zip(load_note_record(
                    &connection,
                    current_path.unwrap_or_default(),
                )?)
                .filter(|(note_path, stored)| {
                    stored.content_hash == content_hash(current_markdown)
                        && !note_path.is_empty()
                        && !edges_stale
                }) {
                Some((note_path, _)) => {
                    let items =
                        load_related_note_previews(&connection, note_path, effective_limit)?
                            .into_iter()
                            .map(|preview| RelatedNoteMatch {
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
                            })
                            .collect::<Vec<_>>();

                    (
                        RelatedNotesResponse {
                            status: "ready".to_string(),
                            scope: "note".to_string(),
                            reason: None,
                            items,
                        },
                        "edges",
                    )
                }
                None => {
                    let ann_status = self.ann.status_snapshot();
                    if !ann_status.loaded || ann_status.indexed_chunks == 0 {
                        let response = RelatedNotesResponse {
                            status: "unavailable".to_string(),
                            scope: "note".to_string(),
                            reason: Some(
                                "Semantic index is still warming up or has not been built yet."
                                    .to_string(),
                            ),
                            items: Vec::new(),
                        };
                        self.record_related_response(
                            &scope,
                            &response.status,
                            "semantic",
                            0,
                            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                        );
                        return Ok(response);
                    }

                    let matches = self.semantic_matches_for_text(
                        current_markdown,
                        current_path,
                        effective_limit.saturating_mul(4),
                    )?;

                    (
                        RelatedNotesResponse {
                            status: "ready".to_string(),
                            scope: "note".to_string(),
                            reason: None,
                            items: collapse_related_matches(matches, effective_limit),
                        },
                        "semantic",
                    )
                }
            }
        } else {
            let ann_status = self.ann.status_snapshot();
            if !ann_status.loaded || ann_status.indexed_chunks == 0 {
                let response = RelatedNotesResponse {
                    status: "unavailable".to_string(),
                    scope: "selection".to_string(),
                    reason: Some(
                        "Semantic index is still warming up or has not been built yet.".to_string(),
                    ),
                    items: Vec::new(),
                };
                self.record_related_response(
                    &scope,
                    &response.status,
                    "semantic",
                    0,
                    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                );
                return Ok(response);
            }

            let query_text = build_selection_query_text(
                current_title,
                current_markdown,
                normalized_selection.as_deref().unwrap_or_default(),
            );
            let matches = self.semantic_matches_for_text(
                &query_text,
                current_path,
                effective_limit.saturating_mul(4),
            )?;

            (
                RelatedNotesResponse {
                    status: "ready".to_string(),
                    scope: "selection".to_string(),
                    reason: None,
                    items: collapse_related_matches(matches, effective_limit),
                },
                "semantic",
            )
        };

        self.store_related_query_cache(cache_key, revision, response.clone())?;
        self.record_related_response(
            &scope,
            &response.status,
            strategy,
            response.items.len(),
            started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        );
        Ok(response)
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
