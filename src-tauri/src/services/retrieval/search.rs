//! Bounded interactive retrieval. Indexes rank candidates; canonical bytes supply previews.
use super::VaultRetrievalItem;
use crate::{
    index::AppState,
    note::{self, DocumentKind},
    services::content_hash::canonical_content_hash,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};
const WORK_LIMIT: usize = 4096;
const PREVIEW_BYTES: usize = 480;

#[derive(Clone)]
struct Passage {
    id: String,
    note_id: String,
    location: String,
    start: usize,
    end: usize,
    excerpt: String,
}
#[derive(Clone)]
struct Candidate {
    passage: Passage,
    path: PathBuf,
    title: String,
    section: String,
    score: f32,
}

fn bounded(text: &str, bytes: usize) -> String {
    let mut end = bytes.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].into()
}
fn hash(text: &str) -> String {
    blake3::hash(text.as_bytes()).to_hex().to_string()
}
fn scope_paths(state: &AppState, ids: &HashSet<String>) -> Result<Vec<(String, PathBuf)>, String> {
    let index = state
        .notes_index
        .lock()
        .map_err(|_| "Notes index unavailable")?;
    let mut paths = ids
        .iter()
        .filter_map(|id| {
            index
                .get_note_by_note_id(id)
                .map(|(path, _)| (id.clone(), path.clone()))
        })
        .collect::<Vec<_>>();
    drop(index);
    paths.sort();
    Ok(paths)
}

fn fingerprint(state: &AppState, ids: &HashSet<String>) -> Result<String, String> {
    fingerprint_with(state, ids, |path| {
        // Filesystem timestamps, delayed index refreshes and assignment of
        // catalog identities to legacy files are not changes to search
        // content. Bind the scope to actual paths/bytes instead. A changed
        // embedded identity is still detected because it changes the bytes;
        // Snapshot loading separately verifies embedded note identity.
        let mut file = fs::File::open(path)
            .map_err(|_| String::from("Search scope unavailable; search again"))?;
        let mut content = blake3::Hasher::new();
        content
            .update_reader(&mut file)
            .map_err(|_| String::from("Search scope unavailable; search again"))?;
        Ok(content.finalize().to_hex().to_string())
    })
}

fn fingerprint_with(
    state: &AppState,
    ids: &HashSet<String>,
    mut hash_file: impl FnMut(&std::path::Path) -> Result<String, String>,
) -> Result<String, String> {
    // Clone only identity/path bindings under the catalog lock. Filesystem reads
    // can block independently of corpus size; they must not block catalog users.
    let paths = scope_paths(state, ids)?;
    let keys = paths
        .iter()
        .map(|(_, path)| {
            serde_json::to_string(&(path, hash_file(path)?)).map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<_>, String>>()?;
    // A rename/removal during the unlocked read invalidates this proof. The
    // surrounding delivery boundary separately verifies timeline generations.
    if scope_paths(state, ids)? != paths {
        return Err("Search scope changed; search again".into());
    }
    Ok(hash(&keys.join("\n")))
}

pub(super) fn search(
    state: &AppState,
    ids: &HashSet<String>,
    query: &str,
    limit: usize,
    query_bytes: usize,
) -> Result<Vec<VaultRetrievalItem>, String> {
    if query.len() > query_bytes {
        return Err(format!("Query exceeds {query_bytes} bytes"));
    }
    let version = fingerprint(state, ids)?;
    let mut snapshots = HashMap::new();
    let mut candidates = Vec::new();
    if query.trim().is_empty() {
        // Metadata-only filtering returns a bounded canonical preview per note.
        let mut sorted: Vec<_> = ids.iter().collect();
        sorted.sort();
        for id in sorted.into_iter().take(WORK_LIMIT) {
            if let Some(snapshot) = snapshot_for(state, &mut snapshots, id) {
                let body = &snapshot.locations["body"];
                if let Some(candidate) =
                    snapshot.candidate(id, body, "body", "Exact match", 1.0, Some(0))
                {
                    candidates.push(candidate);
                }
            }
        }
    } else {
        let mut ranked = {
            let index = state
                .notes_index
                .lock()
                .map_err(|_| "Notes index unavailable")?;
            state
                .lexical
                .passage_matches_with_catalog(&index.entries, query, ids, WORK_LIMIT)
                .unwrap_or_default()
        };
        ranked.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.note_id.cmp(&b.note_id))
                .then_with(|| a.text.cmp(&b.text))
        });
        for (rank, hit) in ranked.into_iter().enumerate() {
            let Some(snapshot) = snapshot_for(state, &mut snapshots, &hit.note_id) else {
                continue;
            };
            let location = hit.location.as_str();
            let content = &snapshot.locations[location];
            let Some((start, end)) = current_text_range(content, &hit.text) else {
                continue;
            };
            let mut offset = start;
            for text in passage_slices(&content[start..end]) {
                let relevant = query
                    .split_whitespace()
                    .any(|term| text.to_lowercase().contains(&term.to_lowercase()));
                let score = reciprocal_rank(rank) * if relevant { 1.1 } else { 1.0 };
                if let Some(c) = snapshot.candidate(
                    &hit.note_id,
                    text,
                    location,
                    &hit.section_label,
                    score,
                    Some(offset),
                ) {
                    candidates.push(c);
                }
                offset += text.len();
                if candidates.len() >= WORK_LIMIT {
                    break;
                }
            }
            if candidates.len() >= WORK_LIMIT {
                break;
            }
        }
        let available = state.semantic.get_status().is_ok_and(|s| {
            s.settings.semantic_search_enabled && s.model_available && s.ann_index_loaded
        });
        if available {
            collect_semantic_candidates(state, ids, &mut snapshots, &mut candidates, |width| {
                state.semantic.semantic_matches_for_text(query, None, width)
            });
        }
    }
    let mut merged: HashMap<String, Candidate> = HashMap::new();
    for c in candidates {
        merged
            .entry(c.passage.id.clone())
            .and_modify(|old| old.score += c.score)
            .or_insert(c);
    }
    let mut candidates: Vec<_> = merged.into_values().collect();
    candidates.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.passage.id.cmp(&b.passage.id))
    });
    let mut distinct: Vec<Candidate> = Vec::new();
    for candidate in candidates {
        if let Some(old) = distinct.iter_mut().find(|old| overlaps(old, &candidate)) {
            // A title-only match must not displace the containing passage.
            if candidate.passage.start <= old.passage.start
                && candidate.passage.end >= old.passage.end
            {
                let score = old.score.max(candidate.score);
                *old = candidate;
                old.score = score;
            }
        } else {
            distinct.push(candidate);
        }
    }
    distinct.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.passage.id.cmp(&b.passage.id))
    });
    // The surrounding CurrentContentAccess checks eligibility and timeline generation.
    // Also reject external edits that have not reached the watcher yet.
    if fingerprint(state, ids)? != version {
        return Err("Content changed during search; retry".into());
    }
    let mut seen = HashSet::new();
    Ok(distinct
        .into_iter()
        .filter(|c| seen.insert(c.passage.note_id.clone()))
        .take(limit.clamp(1, WORK_LIMIT))
        .map(|c| VaultRetrievalItem {
            note_id: c.passage.note_id,
            note_path: c.path,
            title: c.title,
            excerpt: bounded(&c.passage.excerpt, PREVIEW_BYTES),
            section_label: bounded(&c.section, 160),
            score: c.score,
        })
        .collect())
}

fn overlaps(a: &Candidate, b: &Candidate) -> bool {
    let (a, b) = (&a.passage, &b.passage);
    a.note_id == b.note_id
        && a.location == b.location
        && a.end.min(b.end).saturating_sub(a.start.max(b.start)) * 2
            > (a.end - a.start).min(b.end - b.start)
}
fn passage_slices(text: &str) -> Vec<&str> {
    let mut slices = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + 2400).min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        slices.push(&text[start..end]);
        start = end;
        if slices.len() >= WORK_LIMIT {
            break;
        }
    }
    slices
}

fn reciprocal_rank(rank: usize) -> f32 {
    1.0 / (60.0 + rank as f32 + 1.0)
}

// Tantivy paragraphs collapse whitespace for ranking. Recover exact canonical
// bytes with a correspondence map; never deliver the normalized index string.
fn current_text_range(body: &str, excerpt: &str) -> Option<(usize, usize)> {
    let exact: Vec<_> = body.match_indices(excerpt).take(2).collect();
    if exact.len() == 1 {
        return Some((exact[0].0, exact[0].0 + excerpt.len()));
    }
    if exact.len() > 1 {
        return None;
    }
    let mut normalized = String::new();
    let mut ranges: Vec<(usize, usize, usize, usize)> = Vec::new();
    let mut was_space = false;
    for (offset, ch) in body.char_indices() {
        if ch.is_whitespace() && was_space {
            if let Some(last) = ranges.last_mut() {
                last.3 = offset + ch.len_utf8();
            }
            continue;
        }
        let before = normalized.len();
        normalized.push(if ch.is_whitespace() { ' ' } else { ch });
        ranges.push((before, normalized.len(), offset, offset + ch.len_utf8()));
        was_space = ch.is_whitespace();
    }
    let needle = excerpt.split_whitespace().collect::<Vec<_>>().join(" ");
    if needle.is_empty() {
        return None;
    }
    let hits: Vec<_> = normalized.match_indices(&needle).take(2).collect();
    if hits.len() != 1 {
        return None;
    }
    let start = hits[0].0;
    let end = start + needle.len();
    Some((
        ranges.iter().find(|r| r.0 == start)?.2,
        ranges.iter().find(|r| r.1 == end)?.3,
    ))
}

fn snapshot_for<'a>(
    state: &AppState,
    snapshots: &'a mut HashMap<String, Option<CanonicalSnapshot>>,
    id: &str,
) -> Option<&'a CanonicalSnapshot> {
    snapshots
        .entry(id.to_string())
        .or_insert_with(|| CanonicalSnapshot::load(state, id))
        .as_ref()
}
#[allow(clippy::too_many_arguments)]
fn cached_candidate(
    state: &AppState,
    snapshots: &mut HashMap<String, Option<CanonicalSnapshot>>,
    id: &str,
    excerpt: &str,
    location: &str,
    section: &str,
    score: f32,
    start: Option<usize>,
) -> Option<Candidate> {
    snapshot_for(state, snapshots, id)?.candidate(id, excerpt, location, section, score, start)
}
fn collect_semantic_candidates(
    state: &AppState,
    ids: &HashSet<String>,
    snapshots: &mut HashMap<String, Option<CanonicalSnapshot>>,
    candidates: &mut Vec<Candidate>,
    mut retrieve: impl FnMut(usize) -> Result<Vec<crate::semantic::SemanticChunkMatch>, String>,
) {
    let mut semantic_seen = HashSet::new();
    let mut width = 64;
    loop {
        match retrieve(width) {
            Ok(items) => {
                let count = items.len();
                let mut rank = 0;
                for item in items {
                    let id = state.notes_index.lock().ok().and_then(|index| {
                        index
                            .entries
                            .get(&PathBuf::from(&item.note_path))
                            .map(|n| n.note_id.clone())
                    });
                    let Some(id) = id.filter(|id| ids.contains(id)) else {
                        continue;
                    };
                    if item.document_kind != DocumentKind::Note {
                        continue;
                    }
                    if let Some(c) = cached_candidate(
                        state,
                        snapshots,
                        &id,
                        &item.match_text,
                        "body",
                        &item.section_label,
                        reciprocal_rank(rank),
                        None,
                    ) {
                        // Keep one score per retrieval source while widening.
                        if semantic_seen.insert(c.passage.id.clone()) {
                            if let Some(old) = candidates.iter_mut().find(|old| overlaps(old, &c)) {
                                old.score += c.score;
                            } else {
                                candidates.push(c);
                            }
                        }
                        rank += 1;
                    }
                }
                if count < width {
                    break;
                }
                if width >= WORK_LIMIT {
                    break;
                }
                width = (width * 4).min(WORK_LIMIT);
            }
            Err(_) => {
                break;
            }
        }
    }
}

struct CanonicalSnapshot {
    path: PathBuf,
    title: String,
    locations: HashMap<&'static str, String>,
    content_hash: String,
}
impl CanonicalSnapshot {
    fn load(state: &AppState, id: &str) -> Option<Self> {
        let (path, title) = {
            let index = state.notes_index.lock().ok()?;
            let (path, note) = index.get_note_by_note_id(id)?;
            (path.clone(), note.title.clone())
        };
        let raw = fs::read_to_string(&path).ok()?;
        let parsed = note::parse_note(&raw);
        if parsed
            .frontmatter
            .managed
            .as_ref()
            .is_some_and(|m| (!m.id.trim().is_empty() && m.id != id) || m.trashed_at.is_some())
        {
            return None;
        }
        let body = parsed.body.to_string();
        let content_hash = canonical_content_hash(&raw);
        Some(Self {
            path,
            title: title.clone(),
            content_hash,
            locations: HashMap::from([("title", title), ("body", body)]),
        })
    }
    fn candidate(
        &self,
        id: &str,
        excerpt: &str,
        location: &str,
        section: &str,
        score: f32,
        exact_start: Option<usize>,
    ) -> Option<Candidate> {
        // Exact canonical ranges can contain whitespace-only chunks between
        // authored text. Discovery still needs a nonblank match.
        if excerpt.is_empty() || (exact_start.is_none() && excerpt.trim().is_empty()) {
            return None;
        }
        let body = self.locations.get(location)?;
        // Paragraphs can be arbitrarily long. Split into bounded exact passages;
        // initial candidate takes a bounded prefix without splitting UTF-8.
        let excerpt = bounded(excerpt, 2400);
        let (start, end) = if let Some(start) = exact_start {
            let end = start.checked_add(excerpt.len())?;
            if body.get(start..end)? != excerpt {
                return None;
            }
            (start, end)
        } else {
            current_text_range(&body, &excerpt)?
        };
        let excerpt = bounded(&body[start..end], 2400);
        let end = start + excerpt.len();
        let content_hash = self.content_hash.clone();
        let reference = hash(&format!("{id}:{content_hash}:{location}:{start}:{end}"));
        Some(Candidate {
            passage: Passage {
                id: reference,
                note_id: id.into(),
                location: location.into(),
                start,
                end,
                excerpt,
            },
            path: self.path.clone(),
            title: self.title.clone(),
            section: section.into(),
            score,
        })
    }
}

#[cfg(test)]
mod tests;
