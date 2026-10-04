//! Private Atlas query implementation; one semantic owner remains authoritative.
use crate::{semantic::embed::EmbeddingInputKind, state::effective_open_count};
const ATLAS_SEARCH_SEMANTIC_WEIGHT: f32 = 0.55;
const ATLAS_SEARCH_LEXICAL_WEIGHT: f32 = 0.25;
const ATLAS_SEARCH_STRUCTURAL_WEIGHT: f32 = 0.10;
const ATLAS_SEARCH_RECENCY_WEIGHT: f32 = 0.07;
const ATLAS_SEARCH_FREQUENCY_WEIGHT: f32 = 0.03;

use super::*;

impl ActiveSemanticState {
    pub(in crate::semantic) fn search_vault_atlas(
        &self,
        generation_key: AtlasGenerationKey,
        query: String,
        activity_by_note_id: HashMap<String, NoteActivity>,
        notes_dir: &Path,
    ) -> Result<AtlasSearchResponse, String> {
        let tag_query = crate::tags::TagQuery::parse(&query);
        let trimmed_query = tag_query.text.clone();
        if trimmed_query.is_empty() && tag_query.tags.is_empty() {
            return Ok(AtlasSearchResponse {
                status: "ready".to_string(),
                reason: None,
                query,
                generated_at_millis: current_time_millis()?,
                matches: Vec::new(),
            });
        }

        let connection = open_database(&self.db_path)?;
        crate::semantic::ensure_schema(&connection)?;
        let metadata = persisted_atlas_inputs(&connection, generation_key)?.metadata;
        let indexed_notes = visible_atlas_notes(
            load_atlas_note_embeddings(&connection)?,
            &metadata,
            self.provider.model_info().dimensions,
        )
        .into_iter()
        .filter(|note| Path::new(&note.note_path).is_file())
        .collect::<Vec<_>>();
        if indexed_notes.is_empty() {
            return Ok(AtlasSearchResponse {
                status: "empty".to_string(),
                reason: Some("No indexed notes are available yet.".to_string()),
                query,
                generated_at_millis: current_time_millis()?,
                matches: Vec::new(),
            });
        }

        let query_embedding = if trimmed_query.is_empty() {
            None
        } else {
            self.provider
                .embed_texts(
                    std::slice::from_ref(&trimmed_query),
                    EmbeddingInputKind::Query,
                )
                .ok()
                .and_then(|mut embeddings| embeddings.pop())
        };
        let now = current_time_millis()?;
        let normalized_query = normalize_search_text(&trimmed_query);
        let terms = normalized_query
            .split_whitespace()
            .filter(|term| !term.is_empty())
            .map(|term| term.to_string())
            .collect::<Vec<_>>();

        let mut matches = indexed_notes
            .into_iter()
            .filter(|note| {
                tag_query.matches(
                    metadata
                        .get(&note.note_path)
                        .map_or(&[], |meta| meta.tags.as_slice()),
                )
            })
            .map(|note| {
                let meta = metadata.get(&note.note_path);
                let title = meta
                    .map(|item| item.title.as_str())
                    .filter(|title| !title.trim().is_empty())
                    .unwrap_or(note.note_title.as_str());
                let fallback_file_name = file_name_for_path(&note.note_path);
                let file_name = meta
                    .map(|item| item.file_name.as_str())
                    .unwrap_or(fallback_file_name.as_str());
                let relative_path = atlas_searchable_note_path(&note.note_path, notes_dir);
                let preview = meta.map(|item| item.preview.as_str()).unwrap_or("");
                let tags = meta.map_or(&[] as &[String], |item| item.tags.as_slice());
                let semantic_score = if note
                    .semantic_input_hash
                    .starts_with(NAVIGATION_ONLY_SEMANTIC_HASH_PREFIX)
                {
                    0.0
                } else {
                    query_embedding
                        .as_ref()
                        .map(|embedding| {
                            atlas_cosine_similarity(embedding, &note.embedding).max(0.0)
                        })
                        .unwrap_or(0.0)
                };
                let lexical_score = lexical_note_score(
                    &terms,
                    &[title, file_name, relative_path.as_str(), preview],
                    tags,
                );
                let structural_score = title_tag_path_score(
                    &normalized_query,
                    &terms,
                    title,
                    file_name,
                    &relative_path,
                    tags,
                );
                let note_id = meta.and_then(|item| item.note_id.clone());
                let document_kind = meta
                    .map(|item| item.document_kind)
                    .unwrap_or(DocumentKind::Note);
                let activity = note_id.as_ref().and_then(|id| activity_by_note_id.get(id));
                let last_viewed = activity.map(|item| item.last_viewed_at_millis);
                let open_count = activity.map(|item| item.open_count).unwrap_or(0);
                let recency_score = recency_score(
                    now,
                    last_viewed.unwrap_or(note.modified_millis),
                    note.modified_millis,
                );
                let frequency_score = frequency_score(effective_open_count(
                    open_count,
                    last_viewed.unwrap_or(0),
                    now,
                ));
                let access_score = (0.7 * recency_score + 0.3 * frequency_score).clamp(0.0, 1.0);
                let score = ATLAS_SEARCH_SEMANTIC_WEIGHT * semantic_score
                    + ATLAS_SEARCH_LEXICAL_WEIGHT * lexical_score
                    + ATLAS_SEARCH_STRUCTURAL_WEIGHT * structural_score
                    + ATLAS_SEARCH_RECENCY_WEIGHT * recency_score
                    + ATLAS_SEARCH_FREQUENCY_WEIGHT * frequency_score;
                AtlasSearchMatch {
                    note_id,
                    note_path: note.note_path,
                    document_kind,
                    score: if trimmed_query.is_empty() {
                        1.0
                    } else {
                        score.clamp(0.0, 1.0)
                    },
                    semantic_score,
                    lexical_score,
                    structural_score,
                    reason_labels: {
                        let mut labels = reason_labels(
                            semantic_score,
                            lexical_score,
                            structural_score,
                            access_score,
                        );
                        labels.extend(
                            tags.iter()
                                .filter(|tag| {
                                    tag_query.tags.contains(tag)
                                        || terms.iter().any(|term| tag.contains(term))
                                })
                                .map(|tag| format!("#{tag}")),
                        );
                        labels
                    },
                }
            })
            .filter(|item| {
                item.score > 0.02 || item.lexical_score > 0.0 || item.structural_score > 0.0
            })
            .collect::<Vec<_>>();
        matches.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.note_path.cmp(&right.note_path))
        });

        Ok(AtlasSearchResponse {
            status: "ready".to_string(),
            reason: (query_embedding.is_none() && !trimmed_query.is_empty()).then(|| {
                "Semantic query embedding unavailable; used lexical and recency scoring."
                    .to_string()
            }),
            query,
            generated_at_millis: now,
            matches,
        })
    }
}
fn lexical_note_score(terms: &[String], text_parts: &[&str], tags: &[String]) -> f32 {
    if terms.is_empty() {
        return 0.0;
    }
    let haystack = normalize_search_text(&format!("{} {}", text_parts.join(" "), tags.join(" ")));
    let matched = terms
        .iter()
        .filter(|term| {
            haystack
                .split_whitespace()
                .any(|word| word == term.as_str())
                || haystack.contains(term.as_str())
        })
        .count();
    let coverage = matched as f32 / terms.len().max(1) as f32;
    let phrase_bonus = if haystack.contains(&terms.join(" ")) {
        0.18
    } else {
        0.0
    };
    (coverage + phrase_bonus).clamp(0.0, 1.0)
}

fn title_tag_path_score(
    normalized_query: &str,
    terms: &[String],
    title: &str,
    file_name: &str,
    note_path: &str,
    tags: &[String],
) -> f32 {
    if normalized_query.is_empty() {
        return 0.0;
    }
    let title = normalize_search_text(title);
    let file_name = normalize_search_text(file_name);
    let note_path = normalize_search_text(note_path);
    let tags = normalize_search_text(&tags.join(" "));
    let exact = [
        (title.contains(normalized_query), 0.48_f32),
        (tags.contains(normalized_query), 0.28_f32),
        (file_name.contains(normalized_query), 0.18_f32),
        (note_path.contains(normalized_query), 0.12_f32),
    ]
    .into_iter()
    .filter_map(|(matched, weight)| matched.then_some(weight))
    .sum::<f32>();
    let term_hits = terms
        .iter()
        .map(|term| {
            if title.contains(term) {
                0.12
            } else if tags.contains(term) {
                0.1
            } else if file_name.contains(term) || note_path.contains(term) {
                0.05
            } else {
                0.0
            }
        })
        .sum::<f32>();
    (exact + term_hits).clamp(0.0, 1.0)
}

pub(crate) fn recency_score(now: u64, last_activity: u64, modified: u64) -> f32 {
    let activity = last_activity.max(modified);
    if activity >= now {
        return 1.0;
    }
    let ninety_days = 1000.0 * 60.0 * 60.0 * 24.0 * 90.0;
    (1.0 - (now - activity) as f32 / ninety_days).clamp(0.0, 1.0)
}

/// Diminishing returns on open count: ~0.5 around 7 opens, ~1.0 around 54.
pub(crate) fn frequency_score(open_count: u64) -> f32 {
    ((open_count as f32).ln_1p() / 4.0).clamp(0.0, 1.0)
}

fn reason_labels(
    semantic_score: f32,
    lexical_score: f32,
    structural_score: f32,
    access_score: f32,
) -> Vec<String> {
    let mut labels = Vec::new();
    if semantic_score >= 0.55 {
        labels.push("Semantic match".to_string());
    }
    if lexical_score >= 0.45 {
        labels.push("Text match".to_string());
    }
    if structural_score >= 0.28 {
        labels.push("Title/tag/path match".to_string());
    }
    if access_score >= 0.72 {
        labels.push("Recent or accessed".to_string());
    }
    labels
}

fn atlas_searchable_note_path(note_path: &str, notes_dir: &Path) -> String {
    let path = Path::new(note_path);
    path.strip_prefix(notes_dir)
        .ok()
        .filter(|relative| !relative.as_os_str().is_empty())
        .unwrap_or_else(|| path.file_name().map(Path::new).unwrap_or(path))
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
#[path = "query_tests.rs"]
mod tests;
