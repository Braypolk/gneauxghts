use super::{
    atlas::{AtlasCloud, AtlasNode},
    db::{
        load_atlas_label_embeddings, load_chunks_for_note_paths, save_atlas_label_embeddings,
        AtlasLabelChunk,
    },
    embed::{EmbeddingInputKind, EmbeddingProvider, EMBEDDING_BATCH_SIZE},
    similarity::cosine_similarity,
};
use rayon::prelude::*;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

pub(crate) const LABEL_ALGORITHM_VERSION: &str = "chunk-keybert-atlas-v7";
/// Soft per-cloud candidate budget: `clamp(MIN, members * SCALE, MAX)`.
const CANDIDATES_PER_CLOUD_MIN: usize = 24;
const CANDIDATES_PER_CLOUD_MAX: usize = 64;
const CANDIDATES_PER_MEMBER: usize = 4;
const CHUNKS_PER_CLOUD: usize = 12;
const CHUNKS_PER_NOTE: usize = 3;
/// Reject unigrams that appear in more than this fraction of selected
/// cloud-content documents (centroid-nearest chunks across the vault).
const MAX_DOCUMENT_FREQUENCY_RATIO: f32 = 0.35;
/// Drop body/heading unigrams whose cloud residual is below this. Function-word
/// embeddings sit near the vault average, so their residual collapses.
const MIN_CONTENT_UNIGRAM_RESIDUAL: f32 = 0.05;

const GENERIC_SECTION_LABELS: &[&str] = &["Title", "Overview", "Remembered passage"];

/// Closed-class words (sorted for binary search). Classic KeyBERT drops these
/// via `CountVectorizer(stop_words='english')` before embedding; DF alone is
/// not enough because short connectors still embed and can beat weak phrases.
const FUNCTION_WORDS: &[&str] = &[
    "about",
    "after",
    "again",
    "against",
    "all",
    "also",
    "among",
    "and",
    "another",
    "any",
    "anyone",
    "are",
    "because",
    "been",
    "before",
    "being",
    "between",
    "both",
    "but",
    "can",
    "could",
    "did",
    "during",
    "each",
    "every",
    "everyone",
    "everything",
    "for",
    "from",
    "had",
    "has",
    "have",
    "her",
    "here",
    "him",
    "his",
    "how",
    "however",
    "into",
    "its",
    "just",
    "more",
    "most",
    "much",
    "not",
    "nothing",
    "once",
    "one",
    "only",
    "other",
    "our",
    "out",
    "over",
    "same",
    "she",
    "should",
    "some",
    "someone",
    "something",
    "such",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "therefore",
    "these",
    "they",
    "thing",
    "things",
    "this",
    "those",
    "through",
    "too",
    "under",
    "upon",
    "very",
    "was",
    "were",
    "what",
    "whatever",
    "when",
    "whenever",
    "where",
    "which",
    "while",
    "who",
    "will",
    "with",
    "within",
    "without",
    "would",
    "you",
    "your",
];

fn is_function_word(normalized: &str) -> bool {
    if normalized.len() <= 2 {
        return matches!(
            normalized,
            "a" | "an"
                | "as"
                | "at"
                | "be"
                | "by"
                | "do"
                | "if"
                | "in"
                | "is"
                | "it"
                | "me"
                | "my"
                | "no"
                | "of"
                | "on"
                | "or"
                | "so"
                | "to"
                | "up"
                | "us"
                | "we"
        );
    }
    FUNCTION_WORDS.binary_search(&normalized).is_ok()
}

fn phrase_has_content_token(normalized: &str) -> bool {
    normalized
        .split_whitespace()
        .any(|token| is_candidate_token(token) && !is_function_word(token))
}

#[derive(Clone, Debug)]
pub(crate) struct AtlasLabelNote {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) tags: Vec<String>,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone, Debug, Default)]
struct DocumentFrequency {
    document_count: usize,
    term_frequency: HashMap<String, usize>,
}

impl DocumentFrequency {
    fn from_documents(documents: &[String]) -> Self {
        let mut term_frequency = HashMap::new();
        for document in documents {
            let mut terms = HashSet::new();
            collect_document_terms(document, &mut terms);
            for term in terms {
                *term_frequency.entry(term).or_default() += 1;
            }
        }
        Self {
            document_count: documents.len(),
            term_frequency,
        }
    }

    fn is_ubiquitous(&self, term: &str) -> bool {
        if self.document_count < 3 {
            return false;
        }
        let frequency = self.term_frequency.get(term).copied().unwrap_or_default();
        if frequency < 2 {
            return false;
        }
        (frequency as f32 / self.document_count as f32) > MAX_DOCUMENT_FREQUENCY_RATIO
    }
}

fn collect_document_terms(text: &str, terms: &mut HashSet<String>) {
    for word in sanitize_label_text(text).split_whitespace() {
        let normalized = word.to_lowercase();
        if is_candidate_token(&normalized) {
            terms.insert(normalized);
        }
    }
}

fn is_candidate_token(normalized: &str) -> bool {
    normalized.len() >= 3
        && normalized.chars().any(char::is_alphabetic)
        && !normalized
            .chars()
            .all(|character| character.is_ascii_digit())
}

fn is_generic_section_label(label: &str) -> bool {
    GENERIC_SECTION_LABELS
        .iter()
        .any(|generic| generic.eq_ignore_ascii_case(label.trim()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CloudLabelSource {
    Keybert,
    Medoid,
}

impl CloudLabelSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Keybert => "keybert",
            Self::Medoid => "medoid",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CloudLabelAssignment {
    pub(crate) label: String,
    pub(crate) confidence: f32,
    pub(crate) source: CloudLabelSource,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct LabelPipelineMetrics {
    pub(crate) cloud_count: usize,
    pub(crate) candidate_count: usize,
    pub(crate) unique_candidate_count: usize,
    pub(crate) chunk_count: usize,
    pub(crate) selected_chunk_count: usize,
    pub(crate) cache_hit_count: usize,
    pub(crate) provider_text_count: usize,
    pub(crate) provider_batch_count: usize,
    pub(crate) keybert_label_count: usize,
    pub(crate) medoid_fallback_count: usize,
}

#[derive(Clone, Debug, Default)]
struct CandidateEvidence {
    display: String,
    source_priority: u8,
    note_ids: HashSet<String>,
    term_frequency: usize,
}

#[derive(Clone, Debug)]
struct ScoredCandidate {
    display: String,
    source_priority: u8,
    note_count: usize,
}

#[derive(Clone, Debug)]
struct CloudCandidates {
    cloud_id: String,
    centroid: Vec<f32>,
    phrases: Vec<ScoredCandidate>,
}

pub(crate) fn normalized_phrase(value: &str) -> String {
    value
        .split_whitespace()
        .map(|part| part.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn model_cache_fingerprint(provider: &dyn EmbeddingProvider) -> String {
    provider.model_info().fingerprint()
}

pub(crate) fn cloud_membership_fingerprint(
    structural_generation: &str,
    clouds: &[AtlasCloud],
) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(structural_generation.as_bytes());
    let mut ordered = clouds.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.id.cmp(&right.id));
    for cloud in ordered {
        hasher.update(cloud.id.as_bytes());
        hasher.update(&[0]);
        let mut members = cloud.member_node_ids.clone();
        members.sort();
        for member in members {
            hasher.update(member.as_bytes());
            hasher.update(&[0]);
        }
    }
    hasher.finalize().to_hex().to_string()
}

pub(crate) fn cloud_centroid(notes: &[&AtlasLabelNote]) -> Vec<f32> {
    let dimensions = notes.first().map(|note| note.embedding.len()).unwrap_or(0);
    if dimensions == 0 {
        return Vec::new();
    }
    let mut centroid = vec![0.0; dimensions];
    let mut count = 0usize;
    for note in notes {
        if note.embedding.len() != dimensions {
            continue;
        }
        for (target, value) in centroid.iter_mut().zip(&note.embedding) {
            *target += *value;
        }
        count += 1;
    }
    if count > 0 {
        for value in &mut centroid {
            *value /= count as f32;
        }
    }
    centroid
}

pub(crate) fn medoid_note_ids(notes: &[&AtlasLabelNote], limit: usize) -> Vec<String> {
    let centroid = cloud_centroid(notes);
    let mut ranked = notes
        .iter()
        .map(|note| {
            let similarity = cosine_similarity(&centroid, &note.embedding);
            (note.id.clone(), similarity)
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked.into_iter().take(limit).map(|(id, _)| id).collect()
}

pub(crate) fn medoid_placeholder(notes: &[&AtlasLabelNote]) -> Option<String> {
    let medoid = medoid_note_ids(notes, 1).into_iter().next()?;
    notes
        .iter()
        .find(|note| note.id == medoid)
        .map(|note| sanitize_label_text(&note.title))
        .filter(|title| !title.is_empty())
}

pub(crate) fn sanitize_label_text(input: &str) -> String {
    let mut without_fences = String::new();
    let mut fenced = false;
    for line in input.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if !fenced {
            without_fences.push_str(line);
            without_fences.push(' ');
        }
    }

    let chars = without_fences.chars().collect::<Vec<_>>();
    let mut output = String::new();
    let mut index = 0usize;
    while index < chars.len() {
        if chars[index] == '`' {
            index += 1;
            while index < chars.len() && chars[index] != '`' {
                index += 1;
            }
            index += usize::from(index < chars.len());
            output.push(' ');
            continue;
        }
        if chars[index] == '!' && chars.get(index + 1) == Some(&'[') {
            index = skip_markdown_link(&chars, index + 1);
            output.push(' ');
            continue;
        }
        if chars[index] == '[' && chars.get(index + 1) == Some(&'[') {
            if let Some(end) = find_pair(&chars, index + 2, ']', ']') {
                let inner = chars[index + 2..end].iter().collect::<String>();
                let useful = inner
                    .rsplit_once('|')
                    .map(|(_, alias)| alias)
                    .unwrap_or(&inner);
                output.push(' ');
                output.push_str(useful);
                output.push(' ');
                index = end + 2;
                continue;
            }
        }
        if chars[index] == '[' {
            if let Some(close) = chars[index + 1..].iter().position(|value| *value == ']') {
                let close = index + 1 + close;
                if chars.get(close + 1) == Some(&'(') {
                    output.push(' ');
                    output.extend(&chars[index + 1..close]);
                    output.push(' ');
                    index = skip_parenthesized(&chars, close + 1);
                    continue;
                }
            }
        }
        let remainder = chars[index..].iter().collect::<String>();
        if starts_url(&remainder) {
            while index < chars.len()
                && !chars[index].is_whitespace()
                && !matches!(chars[index], '<' | '>')
            {
                index += 1;
            }
            output.push(' ');
            continue;
        }
        let character = chars[index];
        if character.is_alphanumeric() || matches!(character, ' ' | '-' | '\'' | '/') {
            output.push(character);
        } else {
            output.push(' ');
        }
        index += 1;
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn starts_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("www.")
}

fn find_pair(chars: &[char], start: usize, first: char, second: char) -> Option<usize> {
    (start..chars.len().saturating_sub(1))
        .find(|index| chars[*index] == first && chars[*index + 1] == second)
}

fn skip_markdown_link(chars: &[char], open: usize) -> usize {
    let close = chars[open + 1..]
        .iter()
        .position(|value| *value == ']')
        .map(|offset| open + 1 + offset);
    match close {
        Some(close) if chars.get(close + 1) == Some(&'(') => skip_parenthesized(chars, close + 1),
        Some(close) => close + 1,
        None => chars.len(),
    }
}

fn skip_parenthesized(chars: &[char], open: usize) -> usize {
    let mut depth = 0usize;
    for (index, character) in chars.iter().enumerate().skip(open) {
        match character {
            '(' => depth += 1,
            ')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return index + 1;
                }
            }
            _ => {}
        }
    }
    chars.len()
}

fn add_source_candidates(
    text: &str,
    note_id: &str,
    source_priority: u8,
    document_frequency: &DocumentFrequency,
    evidence: &mut HashMap<String, CandidateEvidence>,
) {
    let sanitized = sanitize_label_text(text);
    // Single-word labels only: drop function words and vault-ubiquitous terms
    // before collecting unigrams.
    for word in sanitized
        .split_whitespace()
        .filter(|word| {
            let normalized = word.to_lowercase();
            is_candidate_token(&normalized)
                && !is_function_word(&normalized)
                && !document_frequency.is_ubiquitous(&normalized)
        })
        .take(64)
    {
        let normalized = word.to_lowercase();
        if normalized.len() < 3 || !phrase_has_content_token(&normalized) {
            continue;
        }
        let entry = evidence
            .entry(normalized.clone())
            .or_insert_with(|| CandidateEvidence {
                display: normalized,
                source_priority,
                note_ids: HashSet::new(),
                term_frequency: 0,
            });
        entry.source_priority = entry.source_priority.min(source_priority);
        entry.note_ids.insert(note_id.to_string());
        entry.term_frequency = entry.term_frequency.saturating_add(1);
    }
}

fn select_chunks_for_cloud(
    cloud: &AtlasCloud,
    chunks_by_note: &HashMap<String, Vec<AtlasLabelChunk>>,
    centroid: &[f32],
) -> Vec<AtlasLabelChunk> {
    let mut selected = pick_chunks_for_cloud(cloud, chunks_by_note, centroid, false);
    // Short notes often only have a Title chunk; still mine that text so the
    // cloud is not forced straight to a medoid filename fallback.
    if selected.is_empty() {
        selected = pick_chunks_for_cloud(cloud, chunks_by_note, centroid, true);
    }
    selected
}

fn pick_chunks_for_cloud(
    cloud: &AtlasCloud,
    chunks_by_note: &HashMap<String, Vec<AtlasLabelChunk>>,
    centroid: &[f32],
    include_title: bool,
) -> Vec<AtlasLabelChunk> {
    let mut ranked = Vec::new();
    let mut unscored = Vec::new();
    for member_id in &cloud.member_node_ids {
        let Some(chunks) = chunks_by_note.get(member_id) else {
            continue;
        };
        for chunk in chunks {
            if !include_title && chunk.section_label.eq_ignore_ascii_case("Title") {
                continue;
            }
            if chunk.text.trim().is_empty() {
                continue;
            }
            if !centroid.is_empty()
                && !chunk.embedding.is_empty()
                && chunk.embedding.len() == centroid.len()
            {
                let similarity = cosine_similarity(centroid, &chunk.embedding);
                ranked.push((similarity, chunk));
            } else {
                unscored.push(chunk);
            }
        }
    }
    ranked.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| left.1.note_path.cmp(&right.1.note_path))
            .then_with(|| left.1.ordinal.cmp(&right.1.ordinal))
    });

    let had_scored = !ranked.is_empty();
    let mut ordered = ranked
        .into_iter()
        .map(|(_, chunk)| chunk)
        .chain(unscored)
        .collect::<Vec<_>>();
    if !had_scored {
        ordered.sort_by(|left, right| {
            left.note_path
                .cmp(&right.note_path)
                .then_with(|| left.ordinal.cmp(&right.ordinal))
        });
    }

    let mut per_note = HashMap::<&str, usize>::new();
    let mut selected = Vec::new();
    for chunk in ordered {
        let count = per_note.entry(chunk.note_path.as_str()).or_insert(0);
        if *count >= CHUNKS_PER_NOTE {
            continue;
        }
        *count += 1;
        selected.push(chunk.clone());
        if selected.len() >= CHUNKS_PER_CLOUD {
            break;
        }
    }
    selected
}

fn candidate_budget_for_cloud(member_count: usize) -> usize {
    let scaled = member_count.saturating_mul(CANDIDATES_PER_MEMBER);
    scaled.clamp(CANDIDATES_PER_CLOUD_MIN, CANDIDATES_PER_CLOUD_MAX)
}

fn candidates_from_selected_chunks(
    cloud: &AtlasCloud,
    notes_by_id: &HashMap<String, AtlasLabelNote>,
    selected: &[AtlasLabelChunk],
    document_frequency: &DocumentFrequency,
    centroid: Vec<f32>,
) -> CloudCandidates {
    let mut evidence = HashMap::new();
    for note_id in &cloud.member_node_ids {
        if let Some(note) = notes_by_id.get(note_id) {
            for tag in &note.tags {
                add_source_candidates(tag, note_id, 0, document_frequency, &mut evidence);
            }
        }
    }
    for chunk in selected {
        if !is_generic_section_label(&chunk.section_label) {
            add_source_candidates(
                &chunk.section_label,
                &chunk.note_path,
                1,
                document_frequency,
                &mut evidence,
            );
        }
        add_source_candidates(
            &chunk.text,
            &chunk.note_path,
            2,
            document_frequency,
            &mut evidence,
        );
    }

    let mut ranked = evidence.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        left.1
            .source_priority
            .cmp(&right.1.source_priority)
            .then_with(|| right.1.note_ids.len().cmp(&left.1.note_ids.len()))
            .then_with(|| right.1.term_frequency.cmp(&left.1.term_frequency))
            .then_with(|| left.0.cmp(&right.0))
    });

    let budget = candidate_budget_for_cloud(cloud.member_node_ids.len());
    CloudCandidates {
        cloud_id: cloud.id.clone(),
        centroid,
        phrases: ranked
            .into_iter()
            .take(budget)
            .map(|(_, value)| ScoredCandidate {
                display: value.display,
                source_priority: value.source_priority,
                note_count: value.note_ids.len(),
            })
            .collect(),
    }
}

/// Deduplicate every cloud's candidate phrases for embedding. Cost scales with
/// cloud count and each cloud's member-scaled budget, reduced by phrase overlap;
/// there is no fixed vault-wide ceiling that starves later clouds.
fn phrases_to_embed(candidate_clouds: &[CloudCandidates]) -> Vec<String> {
    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for cloud in candidate_clouds {
        for candidate in &cloud.phrases {
            let key = normalized_phrase(&candidate.display);
            if seen.insert(key) {
                unique.push(candidate.display.clone());
            }
        }
    }
    unique
}

fn candidate_rank_score(
    cloud_similarity: f32,
    null_similarity: f32,
    candidate: &ScoredCandidate,
) -> f32 {
    let residual = cloud_similarity - null_similarity;
    residual + lexical_prior(candidate)
}

fn lexical_prior(candidate: &ScoredCandidate) -> f32 {
    let coverage_bonus = ((candidate.note_count as f32).ln_1p()) * 0.02;
    let tag_bonus = if candidate.source_priority == 0 {
        0.03
    } else if candidate.source_priority == 1 {
        0.015
    } else {
        0.0
    };
    coverage_bonus + tag_bonus
}

fn mean_embedding(embeddings: &[Vec<f32>]) -> Vec<f32> {
    let dimensions = embeddings.first().map(Vec::len).unwrap_or(0);
    if dimensions == 0 {
        return Vec::new();
    }
    let mut mean = vec![0.0; dimensions];
    let mut count = 0usize;
    for embedding in embeddings {
        if embedding.len() != dimensions {
            continue;
        }
        for (target, value) in mean.iter_mut().zip(embedding) {
            *target += *value;
        }
        count += 1;
    }
    if count > 0 {
        for value in &mut mean {
            *value /= count as f32;
        }
    }
    mean
}

fn take_unique_label(
    ranked: &[(String, f32)],
    used: &HashSet<String>,
) -> Option<CloudLabelAssignment> {
    let choice = ranked
        .iter()
        .find(|(phrase, _)| !used.contains(&normalized_phrase(phrase)))?;
    Some(CloudLabelAssignment {
        // Canonical lowercase so HubSpot / hubspot cannot both win.
        label: normalized_phrase(&choice.0),
        confidence: choice.1,
        source: CloudLabelSource::Keybert,
    })
}

fn unused_medoid_placeholder(notes: &[&AtlasLabelNote], used: &HashSet<String>) -> Option<String> {
    let limit = notes.len().max(1);
    for note_id in medoid_note_ids(notes, limit) {
        let Some(title) = notes
            .iter()
            .find(|note| note.id == note_id)
            .map(|note| sanitize_label_text(&note.title))
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if !used.contains(&normalized_phrase(&title)) {
            return Some(title);
        }
    }
    None
}

fn rank_cloud_phrases(
    phrases: &[ScoredCandidate],
    centroid: &[f32],
    null_centroid: &[f32],
    embeddings: &HashMap<String, Vec<f32>>,
) -> Vec<(String, f32)> {
    let mut ranked = phrases
        .iter()
        .filter_map(|candidate| {
            let key = normalized_phrase(&candidate.display);
            if !phrase_has_content_token(&key) {
                return None;
            }
            let embedding = embeddings.get(&key)?;
            if centroid.is_empty() || embedding.len() != centroid.len() {
                return None;
            }
            let cloud_similarity = cosine_similarity(centroid, embedding);
            let null_similarity =
                if null_centroid.is_empty() || embedding.len() != null_centroid.len() {
                    0.0
                } else {
                    cosine_similarity(null_centroid, embedding)
                };
            // Keep low-residual words in the list so uniqueness can still
            // pick a runner-up instead of falling back to a note title.
            let mut score = candidate_rank_score(cloud_similarity, null_similarity, candidate);
            let residual = cloud_similarity - null_similarity;
            if candidate.source_priority > 0 && residual < MIN_CONTENT_UNIGRAM_RESIDUAL {
                score -= MIN_CONTENT_UNIGRAM_RESIDUAL;
            }
            Some((candidate.display.clone(), score))
        })
        .collect::<Vec<_>>();

    if ranked.is_empty() {
        ranked = phrases
            .iter()
            .filter(|candidate| phrase_has_content_token(&normalized_phrase(&candidate.display)))
            .map(|candidate| {
                let score = 0.04 + lexical_prior(candidate);
                (candidate.display.clone(), score)
            })
            .collect();
    }

    ranked.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| normalized_phrase(&left.0).cmp(&normalized_phrase(&right.0)))
    });
    ranked
}

pub(crate) fn generate_labels_progressive<F>(
    connection: &mut Connection,
    provider: &(dyn EmbeddingProvider + Sync),
    clouds: &[AtlasCloud],
    nodes: &[AtlasNode],
    note_embeddings: &HashMap<String, Vec<f32>>,
    mut on_labeled: F,
) -> Result<(HashMap<String, CloudLabelAssignment>, LabelPipelineMetrics), String>
where
    F: FnMut(&str, &CloudLabelAssignment) -> Result<(), String>,
{
    let notes_by_id = nodes
        .iter()
        .filter_map(|node| {
            note_embeddings
                .get(&node.id)
                .map(|embedding| AtlasLabelNote {
                    id: node.id.clone(),
                    title: node.title.clone(),
                    tags: node.tags.clone(),
                    embedding: embedding.clone(),
                })
        })
        .map(|note| (note.id.clone(), note))
        .collect::<HashMap<_, _>>();
    let clouds_by_id = clouds
        .iter()
        .map(|cloud| (cloud.id.as_str(), cloud))
        .collect::<HashMap<_, _>>();

    let mut member_paths = HashSet::new();
    for cloud in clouds {
        for member in &cloud.member_node_ids {
            member_paths.insert(member.clone());
        }
    }
    let member_paths = member_paths.into_iter().collect::<Vec<_>>();
    let chunks_by_note = load_chunks_for_note_paths(connection, &member_paths)?;
    let chunk_count = chunks_by_note.values().map(Vec::len).sum();

    // DF over all member body chunks (not only the selected subset) so common
    // English connectors are reliably marked ubiquitous.
    let mut corpus_documents = Vec::new();
    for chunks in chunks_by_note.values() {
        for chunk in chunks {
            if chunk.section_label.eq_ignore_ascii_case("Title") {
                continue;
            }
            if !chunk.text.trim().is_empty() {
                corpus_documents.push(chunk.text.clone());
            }
            if !is_generic_section_label(&chunk.section_label) {
                corpus_documents.push(chunk.section_label.clone());
            }
        }
    }
    let document_frequency = DocumentFrequency::from_documents(&corpus_documents);
    let null_centroid = mean_embedding(
        &notes_by_id
            .values()
            .map(|note| note.embedding.clone())
            .collect::<Vec<_>>(),
    );

    let prepared = clouds
        .par_iter()
        .map(|cloud| {
            let members = cloud
                .member_node_ids
                .iter()
                .filter_map(|id| notes_by_id.get(id))
                .collect::<Vec<_>>();
            let centroid = cloud_centroid(&members);
            let selected = select_chunks_for_cloud(cloud, &chunks_by_note, &centroid);
            let selected_count = selected.len();
            let candidates = candidates_from_selected_chunks(
                cloud,
                &notes_by_id,
                &selected,
                &document_frequency,
                centroid,
            );
            (candidates, selected_count)
        })
        .collect::<Vec<_>>();
    let selected_chunk_count = prepared.iter().map(|(_, count)| *count).sum::<usize>();
    let mut candidate_clouds = prepared
        .into_iter()
        .map(|(candidates, _)| candidates)
        .collect::<Vec<_>>();
    candidate_clouds.sort_by(|left, right| left.cloud_id.cmp(&right.cloud_id));

    let candidate_count = candidate_clouds
        .iter()
        .map(|cloud| cloud.phrases.len())
        .sum();
    let unique = phrases_to_embed(&candidate_clouds);

    let fingerprint = model_cache_fingerprint(provider);
    let normalized = unique
        .iter()
        .map(|phrase| normalized_phrase(phrase))
        .collect::<Vec<_>>();
    let cached = load_atlas_label_embeddings(
        connection,
        &normalized,
        &fingerprint,
        LABEL_ALGORITHM_VERSION,
    )?;
    let mut embeddings = cached.clone();
    let missing = unique
        .iter()
        .zip(&normalized)
        .filter(|(_, key)| !embeddings.contains_key(*key))
        .map(|(phrase, key)| (phrase.clone(), key.clone()))
        .collect::<Vec<_>>();
    let provider_batches = missing.chunks(EMBEDDING_BATCH_SIZE).len();
    // Sequential HTTP batches on purpose: llama-server (especially Metal) already
    // parallelizes inside a request via --threads/--threads-batch. Fan-out HTTP
    // mostly queues on the same GPU/CPU pool and makes gneauxghts look idle.
    let mut embedded_batches = Vec::with_capacity(provider_batches);
    for batch in missing.chunks(EMBEDDING_BATCH_SIZE) {
        let texts = batch
            .iter()
            .map(|(phrase, _)| phrase.clone())
            .collect::<Vec<_>>();
        let vectors = provider.embed_texts(&texts, EmbeddingInputKind::Document)?;
        if vectors.len() != batch.len() {
            return Err("Atlas label embedding provider returned an unexpected count".to_string());
        }
        embedded_batches.push(
            batch
                .iter()
                .zip(vectors)
                .map(|((_, key), vector)| (key.clone(), vector))
                .collect::<Vec<_>>(),
        );
    }
    for rows in embedded_batches {
        save_atlas_label_embeddings(connection, &rows, &fingerprint, LABEL_ALGORITHM_VERSION)?;
        embeddings.extend(rows);
    }

    let mut ranked_clouds = candidate_clouds
        .into_par_iter()
        .map(|cloud_candidates| {
            let ranked = rank_cloud_phrases(
                &cloud_candidates.phrases,
                &cloud_candidates.centroid,
                &null_centroid,
                &embeddings,
            );
            (cloud_candidates.cloud_id, cloud_candidates.phrases, ranked)
        })
        .collect::<Vec<_>>();
    ranked_clouds.sort_by(|left, right| left.0.cmp(&right.0));

    let mut used = HashSet::new();
    let mut labels = HashMap::new();
    let mut keybert_label_count = 0usize;
    let mut medoid_fallback_count = 0usize;

    for (cloud_id, phrases, ranked) in ranked_clouds {
        let assignment = take_unique_label(&ranked, &used)
            .or_else(|| {
                // Top of the ranked list was already claimed; try any remaining
                // unused candidate words before a medoid title.
                let mut leftovers = phrases
                    .iter()
                    .filter(|candidate| {
                        let key = normalized_phrase(&candidate.display);
                        phrase_has_content_token(&key) && !used.contains(&key)
                    })
                    .map(|candidate| {
                        let score = 0.02 + lexical_prior(candidate);
                        (candidate.display.clone(), score)
                    })
                    .collect::<Vec<_>>();
                leftovers.sort_by(|left, right| {
                    right
                        .1
                        .total_cmp(&left.1)
                        .then_with(|| normalized_phrase(&left.0).cmp(&normalized_phrase(&right.0)))
                });
                take_unique_label(&leftovers, &used)
            })
            .or_else(|| {
                let cloud = clouds_by_id.get(cloud_id.as_str())?;
                let members = cloud
                    .member_node_ids
                    .iter()
                    .filter_map(|id| notes_by_id.get(id))
                    .collect::<Vec<_>>();
                unused_medoid_placeholder(&members, &used).map(|placeholder| CloudLabelAssignment {
                    label: placeholder,
                    confidence: 0.0,
                    source: CloudLabelSource::Medoid,
                })
            });

        if let Some(assignment) = assignment {
            used.insert(normalized_phrase(&assignment.label));
            match assignment.source {
                CloudLabelSource::Keybert => keybert_label_count += 1,
                CloudLabelSource::Medoid => medoid_fallback_count += 1,
            }
            on_labeled(&cloud_id, &assignment)?;
            labels.insert(cloud_id, assignment);
        }
    }

    Ok((
        labels,
        LabelPipelineMetrics {
            cloud_count: clouds.len(),
            candidate_count,
            unique_candidate_count: unique.len(),
            chunk_count,
            selected_chunk_count,
            cache_hit_count: cached.len(),
            provider_text_count: missing.len(),
            provider_batch_count: provider_batches,
            keybert_label_count,
            medoid_fallback_count,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        note::DocumentKind,
        semantic::db::ensure_schema,
        semantic::embed::{ModelInfo, SemanticModelDownloadResult},
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn note(id: &str, title: &str, embedding: Vec<f32>) -> AtlasLabelNote {
        AtlasLabelNote {
            id: id.to_string(),
            title: title.to_string(),
            tags: Vec::new(),
            embedding,
        }
    }

    struct MockProvider {
        calls: AtomicUsize,
        fail: bool,
    }

    impl MockProvider {
        fn new() -> Self {
            Self {
                calls: AtomicUsize::new(0),
                fail: false,
            }
        }

        fn failing() -> Self {
            Self {
                calls: AtomicUsize::new(0),
                fail: true,
            }
        }
    }

    impl EmbeddingProvider for MockProvider {
        fn embed_texts(
            &self,
            texts: &[String],
            kind: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
            assert!(matches!(kind, EmbeddingInputKind::Document));
            self.calls.fetch_add(1, Ordering::Relaxed);
            if self.fail {
                return Err("mock provider failure".to_string());
            }
            Ok(texts
                .iter()
                .map(|text| {
                    let lower = text.to_lowercase();
                    if lower.contains("garden")
                        || lower.contains("soil")
                        || lower.contains("compost")
                        || lower.contains("vegetable")
                    {
                        vec![1.0, 0.0]
                    } else if lower.contains("airport")
                        || lower.contains("travel")
                        || lower.contains("trip")
                    {
                        vec![0.0, 1.0]
                    } else {
                        vec![0.5, 0.5]
                    }
                })
                .collect())
        }

        fn prepare(&self) -> Result<(), String> {
            Ok(())
        }

        fn model_info(&self) -> ModelInfo {
            ModelInfo {
                id: "mock".to_string(),
                label: "Mock".to_string(),
                dimensions: 2,
                local_only: true,
                runtime_binary_path: None,
                model_path: None,
                model_repo_id: "mock/repo".to_string(),
                available: true,
                loading: false,
                ready: true,
                status: "ready".to_string(),
                error: None,
            }
        }

        fn shutdown(&self) {}

        fn download_model_if_needed(&self) -> Result<SemanticModelDownloadResult, String> {
            Err("unused".to_string())
        }
    }

    fn atlas_node(id: &str, title: &str, embedding: &[f32]) -> (AtlasNode, Vec<f32>) {
        (
            AtlasNode {
                id: id.to_string(),
                note_id: None,
                note_path: id.to_string(),
                title: title.to_string(),
                file_name: format!("{id}.md"),
                document_kind: DocumentKind::Note,
                x: 0.0,
                y: 0.0,
                drift_x: 0.0,
                drift_y: 0.0,
                radius: 1.0,
                cloud_id: Some("cloud".to_string()),
                parent_cloud_id: None,
                child_cloud_id: None,
                cluster_id: Some("cloud".to_string()),
                subcluster_id: None,
                centrality: 0.0,
                degree: 0,
                importance: 0.0,
                modified_at_millis: 0,
                last_viewed_at_millis: None,
                created_at_millis: 0,
                updated_at_millis: 0,
                stale_score: 0.0,
                preview: String::new(),
                tags: Vec::new(),
                isolated: false,
            },
            embedding.to_vec(),
        )
    }

    fn cloud(ids: &[&str]) -> AtlasCloud {
        AtlasCloud {
            id: format!("cloud-{}", ids.join("-")),
            parent_id: None,
            level: 0,
            label: None,
            label_confidence: 0.0,
            label_source: "pending".to_string(),
            note_count: ids.len(),
            density: 0.0,
            color: [0; 4],
            centroid: [0.0; 2],
            label_anchor: [0.0; 2],
            radius: 1.0,
            hull: Vec::new(),
            member_node_ids: ids.iter().map(|id| (*id).to_string()).collect(),
            core_node_ids: ids.iter().map(|id| (*id).to_string()).collect(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids: Vec::new(),
            representative_node_ids: Vec::new(),
        }
    }

    fn serialize_embedding(values: &[f32]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    }

    fn insert_chunk(
        connection: &Connection,
        note_path: &str,
        ordinal: usize,
        section_label: &str,
        text: &str,
        embedding: &[f32],
    ) {
        connection
            .execute(
                "
                INSERT OR IGNORE INTO notes (
                    path, title, modified_millis, content_hash, chunk_count, indexed_at_millis
                ) VALUES (?1, ?1, 0, 'hash', 1, 0)
                ",
                [note_path],
            )
            .expect("note");
        let ann_label = blake3::hash(format!("{note_path}\0{ordinal}").as_bytes()).as_bytes()[0]
            as u64
            | ((ordinal as u64) << 8)
            | 1;
        connection
            .execute(
                "
                INSERT INTO chunks (
                    note_path, ordinal, ann_label, section_label, text, text_hash,
                    start_line, end_line, embedding_blob, embedding_dim, indexed_at_millis
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7, ?8, 0)
                ",
                rusqlite::params![
                    note_path,
                    ordinal,
                    ann_label,
                    section_label,
                    text,
                    format!("hash-{note_path}-{ordinal}"),
                    serialize_embedding(embedding),
                    embedding.len(),
                ],
            )
            .expect("chunk");
    }

    #[test]
    fn sanitizes_urls_markdown_code_images_and_wikilinks() {
        let value = sanitize_label_text(
            "Keep [recipe text](https://site.test/wprm-recipe-container) \
             ![wprm image](https://site.test/wprm.png) `secret code` \
             https://site.test/wprm/recipe [[Target Page|Useful Alias]] **bold words**\n\
             ```rust\nwprm recipe container\n```",
        );
        assert_eq!(value, "Keep recipe text Useful Alias bold words");
        assert!(!value.to_lowercase().contains("wprm"));
        assert!(!value.contains("https"));
    }

    #[test]
    fn chooses_embedding_medoids_nearest_centroid() {
        let notes = [
            note("a", "A", vec![1.0, 0.0]),
            note("b", "B", vec![0.9, 0.1]),
            note("c", "C", vec![0.0, 1.0]),
        ];
        let refs = notes.iter().collect::<Vec<_>>();
        assert_eq!(medoid_note_ids(&refs, 1), vec!["b"]);
        assert_eq!(medoid_placeholder(&refs).as_deref(), Some("B"));
    }

    #[test]
    fn duplicate_labels_choose_runner_up_deterministically() {
        // Matches production: clouds are labeled in sorted id order with a shared
        // used-set, so the first cloud keeps "shared" and the second takes runner-up.
        let mut used = HashSet::new();
        let a = take_unique_label(
            &[("Shared".to_string(), 0.9), ("First".to_string(), 0.8)],
            &used,
        )
        .expect("cloud a");
        used.insert(normalized_phrase(&a.label));
        let b = take_unique_label(
            &[("Shared".to_string(), 0.95), ("Second".to_string(), 0.7)],
            &used,
        )
        .expect("cloud b");
        assert_eq!(a.label, "shared");
        assert_eq!(a.source, CloudLabelSource::Keybert);
        assert_eq!(b.label, "second");
        assert_eq!(b.source, CloudLabelSource::Keybert);
    }

    #[test]
    fn label_uniqueness_is_case_insensitive() {
        let mut used = HashSet::new();
        let a = take_unique_label(
            &[("HubSpot".to_string(), 0.9), ("crm".to_string(), 0.5)],
            &used,
        )
        .expect("cloud a");
        used.insert(normalized_phrase(&a.label));
        let b = take_unique_label(
            &[("hubspot".to_string(), 0.95), ("pipeline".to_string(), 0.8)],
            &used,
        )
        .expect("cloud b");
        assert_eq!(a.label, "hubspot");
        assert_eq!(b.label, "pipeline");
        assert_ne!(normalized_phrase(&a.label), normalized_phrase(&b.label));
    }

    #[test]
    fn uniqueness_prefers_runner_up_word_over_empty() {
        // Only the winning word is contested; runner-up must still be chosen.
        let mut used = HashSet::new();
        let a = take_unique_label(&[("hubspot".to_string(), 1.0)], &used).expect("cloud a");
        used.insert(normalized_phrase(&a.label));
        let b = take_unique_label(
            &[
                ("HubSpot".to_string(), 0.99),
                ("crm".to_string(), 0.4),
                ("deals".to_string(), 0.35),
            ],
            &used,
        )
        .expect("cloud b");
        assert_eq!(a.label, "hubspot");
        assert_eq!(b.label, "crm");
        assert_eq!(b.source, CloudLabelSource::Keybert);
    }

    #[test]
    fn membership_fingerprint_binds_structural_generation_and_members() {
        let first = cloud_membership_fingerprint("generation-a", &[cloud(&["a", "b"])]);
        let next_generation = cloud_membership_fingerprint("generation-b", &[cloud(&["a", "b"])]);
        let next_members = cloud_membership_fingerprint("generation-a", &[cloud(&["a", "c"])]);
        assert_ne!(first, next_generation);
        assert_ne!(first, next_members);
    }

    #[test]
    fn chunk_keybert_ranks_content_phrases_near_cloud_centroid() {
        let mut connection = Connection::open_in_memory().expect("database");
        ensure_schema(&connection).expect("schema");
        insert_chunk(&connection, "a", 0, "Title", "From the notes", &[1.0, 0.0]);
        insert_chunk(
            &connection,
            "a",
            1,
            "Soil Care",
            "Garden soil needs compost and mulch for healthy vegetables.",
            &[1.0, 0.0],
        );
        insert_chunk(
            &connection,
            "b",
            1,
            "Planting",
            "Vegetable beds benefit from compost tea before planting season.",
            &[0.95, 0.05],
        );
        insert_chunk(
            &connection,
            "c",
            1,
            "Travel",
            "Airport delays ruined the weekend trip itinerary.",
            &[0.0, 1.0],
        );

        let (node_a, emb_a) = atlas_node("a", "From the notes", &[1.0, 0.0]);
        let (node_b, emb_b) = atlas_node("b", "Weekly log", &[0.95, 0.05]);
        let (node_c, emb_c) = atlas_node("c", "Trip", &[0.0, 1.0]);
        let nodes = vec![node_a, node_b, node_c];
        let embeddings = HashMap::from([
            ("a".to_string(), emb_a),
            ("b".to_string(), emb_b),
            ("c".to_string(), emb_c),
        ]);
        let clouds = vec![cloud(&["a", "b"]), cloud(&["c"])];
        let provider = MockProvider::new();
        let (labels, metrics) = generate_labels_progressive(
            &mut connection,
            &provider,
            &clouds,
            &nodes,
            &embeddings,
            |_, _| Ok(()),
        )
        .expect("labels");

        assert!(metrics.selected_chunk_count > 0);
        assert!(metrics.provider_text_count > 0);
        let garden = &labels[&clouds[0].id].label.to_lowercase();
        assert_eq!(labels[&clouds[0].id].source, CloudLabelSource::Keybert);
        assert!(
            garden.contains("soil")
                || garden.contains("compost")
                || garden.contains("vegetable")
                || garden.contains("garden"),
            "expected content label, got {garden}"
        );
        // Connector-only unigrams should lose to content terms.
        assert_ne!(garden.as_str(), "from");
        assert!(
            !garden.contains(' '),
            "expected single-word label, got {garden}"
        );
        let travel = &labels[&clouds[1].id].label.to_lowercase();
        assert_eq!(labels[&clouds[1].id].source, CloudLabelSource::Keybert);
        assert!(
            travel == "airport" || travel == "trip" || travel == "travel",
            "expected travel content label, got {travel}"
        );
        assert!(!travel.contains(' '));
    }

    #[test]
    fn phrase_cache_hit_skips_embedding_provider() {
        let mut connection = Connection::open_in_memory().expect("database");
        ensure_schema(&connection).expect("schema");
        insert_chunk(
            &connection,
            "a",
            1,
            "Soil Care",
            "Garden soil needs compost for healthy vegetables.",
            &[1.0, 0.0],
        );
        insert_chunk(
            &connection,
            "b",
            1,
            "Planting",
            "Garden beds benefit from compost tea.",
            &[0.95, 0.05],
        );
        let (node_a, emb_a) = atlas_node("a", "Notes", &[1.0, 0.0]);
        let (node_b, emb_b) = atlas_node("b", "Log", &[0.95, 0.05]);
        let nodes = vec![node_a, node_b];
        let embeddings = HashMap::from([("a".to_string(), emb_a), ("b".to_string(), emb_b)]);
        let clouds = vec![cloud(&["a", "b"])];
        let provider = MockProvider::new();

        let (_, first_metrics) = generate_labels_progressive(
            &mut connection,
            &provider,
            &clouds,
            &nodes,
            &embeddings,
            |_, _| Ok(()),
        )
        .expect("first");
        let calls_after_first = provider.calls.load(Ordering::Relaxed);
        let (_, second_metrics) = generate_labels_progressive(
            &mut connection,
            &provider,
            &clouds,
            &nodes,
            &embeddings,
            |_, _| Ok(()),
        )
        .expect("cached");

        assert!(first_metrics.provider_text_count > 0);
        assert!(second_metrics.cache_hit_count > 0);
        assert_eq!(second_metrics.provider_text_count, 0);
        assert_eq!(provider.calls.load(Ordering::Relaxed), calls_after_first);
    }

    #[test]
    fn provider_failure_returns_without_labels() {
        let mut connection = Connection::open_in_memory().expect("database");
        ensure_schema(&connection).expect("schema");
        insert_chunk(
            &connection,
            "a",
            1,
            "Soil Care",
            "Garden soil needs compost.",
            &[1.0, 0.0],
        );
        let (node, embedding) = atlas_node("a", "Garden Planning", &[1.0, 0.0]);
        let result = generate_labels_progressive(
            &mut connection,
            &MockProvider::failing(),
            &[cloud(&["a"])],
            &[node],
            &HashMap::from([("a".to_string(), embedding)]),
            |_, _| Ok(()),
        );
        assert_eq!(
            result.expect_err("provider failure"),
            "mock provider failure"
        );
    }

    #[test]
    fn empty_chunks_fall_back_to_medoid_title() {
        let mut connection = Connection::open_in_memory().expect("database");
        ensure_schema(&connection).expect("schema");
        let (node, embedding) = atlas_node("a", "Garden Planning", &[1.0, 0.0]);
        let cloud = cloud(&["a"]);
        let (labels, _) = generate_labels_progressive(
            &mut connection,
            &MockProvider::new(),
            &[cloud.clone()],
            &[node],
            &HashMap::from([("a".to_string(), embedding)]),
            |_, _| Ok(()),
        )
        .expect("labels");
        assert_eq!(labels[&cloud.id].label, "Garden Planning");
        assert_eq!(labels[&cloud.id].source, CloudLabelSource::Medoid);
    }

    #[test]
    fn algorithm_version_identifies_chunk_keybert_path() {
        assert!(LABEL_ALGORITHM_VERSION.contains("chunk-keybert"));
    }

    #[test]
    fn function_words_never_become_standalone_or_function_only_phrases() {
        assert!(is_function_word("the"));
        assert!(is_function_word("from"));
        assert!(is_function_word("things"));
        assert!(!is_function_word("garden"));
        assert!(!phrase_has_content_token("the"));
        assert!(!phrase_has_content_token("for being you"));
        assert!(!phrase_has_content_token("from the"));
        assert!(phrase_has_content_token("garden soil"));
        assert!(phrase_has_content_token("hubspot"));
    }

    #[test]
    fn function_words_are_stripped_before_unigrams() {
        let mut evidence = HashMap::new();
        let df = DocumentFrequency::default();
        add_source_candidates(
            "From the notes about garden soil and the compost",
            "a",
            2,
            &df,
            &mut evidence,
        );
        let keys = evidence.keys().cloned().collect::<HashSet<_>>();
        assert!(!keys.contains("the"));
        assert!(!keys.contains("from"));
        assert!(!keys.contains("and"));
        assert!(!keys.contains("about"));
        assert!(!keys.iter().any(|key| key.contains(' ')));
        assert!(keys.contains("garden") || keys.contains("soil") || keys.contains("compost"));
    }

    #[test]
    fn candidate_budget_scales_with_membership() {
        assert_eq!(candidate_budget_for_cloud(0), CANDIDATES_PER_CLOUD_MIN);
        assert_eq!(candidate_budget_for_cloud(1), CANDIDATES_PER_CLOUD_MIN);
        assert_eq!(candidate_budget_for_cloud(6), 24);
        assert_eq!(candidate_budget_for_cloud(8), 32);
        assert_eq!(candidate_budget_for_cloud(16), 64);
        assert_eq!(candidate_budget_for_cloud(100), CANDIDATES_PER_CLOUD_MAX);
    }

    #[test]
    fn embeds_all_cloud_candidates_without_global_cap() {
        let mut clouds = Vec::new();
        for index in 0..40 {
            let phrases = (0..24)
                .map(|phrase_index| ScoredCandidate {
                    display: format!("cloud{index}word{phrase_index}"),
                    source_priority: 2,
                    note_count: 1,
                })
                .collect();
            clouds.push(CloudCandidates {
                cloud_id: format!("c{index}"),
                centroid: vec![1.0, 0.0],
                phrases,
            });
        }
        let unique = phrases_to_embed(&clouds);
        assert_eq!(unique.len(), 40 * 24);
        for cloud in &clouds {
            let covered = cloud
                .phrases
                .iter()
                .filter(|candidate| {
                    unique.iter().any(|phrase| {
                        normalized_phrase(phrase) == normalized_phrase(&candidate.display)
                    })
                })
                .count();
            assert_eq!(
                covered,
                cloud.phrases.len(),
                "cloud {} starved",
                cloud.cloud_id
            );
        }
    }

    #[test]
    fn shared_phrases_are_embedded_once() {
        let shared = ScoredCandidate {
            display: "garden".to_string(),
            source_priority: 2,
            note_count: 2,
        };
        let clouds = vec![
            CloudCandidates {
                cloud_id: "a".to_string(),
                centroid: vec![1.0, 0.0],
                phrases: vec![
                    shared.clone(),
                    ScoredCandidate {
                        display: "compost".to_string(),
                        source_priority: 2,
                        note_count: 1,
                    },
                ],
            },
            CloudCandidates {
                cloud_id: "b".to_string(),
                centroid: vec![0.0, 1.0],
                phrases: vec![shared],
            },
        ];
        let unique = phrases_to_embed(&clouds);
        assert_eq!(unique.len(), 2);
    }

    #[test]
    fn title_only_chunks_still_produce_keybert_label() {
        let mut connection = Connection::open_in_memory().expect("database");
        ensure_schema(&connection).expect("schema");
        insert_chunk(
            &connection,
            "a",
            0,
            "Title",
            "Vegetable garden beds need deep compost mulch.",
            &[1.0, 0.0],
        );
        let (node, embedding) = atlas_node("a", "note-a", &[1.0, 0.0]);
        let cloud = cloud(&["a"]);
        let (labels, metrics) = generate_labels_progressive(
            &mut connection,
            &MockProvider::new(),
            &[cloud.clone()],
            &[node],
            &HashMap::from([("a".to_string(), embedding)]),
            |_, _| Ok(()),
        )
        .expect("labels");
        assert_eq!(labels[&cloud.id].source, CloudLabelSource::Keybert);
        assert_ne!(labels[&cloud.id].label, "note-a");
        assert_eq!(metrics.medoid_fallback_count, 0);
        assert!(metrics.selected_chunk_count > 0);
    }

    #[test]
    fn progressive_callback_fires_once_per_cloud_in_sorted_id_order() {
        let mut connection = Connection::open_in_memory().expect("database");
        ensure_schema(&connection).expect("schema");
        insert_chunk(
            &connection,
            "a",
            1,
            "Soil Care",
            "Garden soil needs compost and mulch for healthy vegetables.",
            &[1.0, 0.0],
        );
        insert_chunk(
            &connection,
            "b",
            1,
            "Planting",
            "Vegetable beds benefit from compost tea before planting season.",
            &[0.95, 0.05],
        );
        insert_chunk(
            &connection,
            "c",
            1,
            "Travel",
            "Airport delays ruined the weekend trip itinerary.",
            &[0.0, 1.0],
        );
        let (node_a, emb_a) = atlas_node("a", "From the notes", &[1.0, 0.0]);
        let (node_b, emb_b) = atlas_node("b", "Weekly log", &[0.95, 0.05]);
        let (node_c, emb_c) = atlas_node("c", "Trip", &[0.0, 1.0]);
        let nodes = vec![node_a, node_b, node_c];
        let embeddings = HashMap::from([
            ("a".to_string(), emb_a),
            ("b".to_string(), emb_b),
            ("c".to_string(), emb_c),
        ]);
        // cloud-c sorts before cloud-a-b by id.
        let clouds = vec![cloud(&["a", "b"]), cloud(&["c"])];
        let mut expected_ids = clouds
            .iter()
            .map(|cloud| cloud.id.clone())
            .collect::<Vec<_>>();
        expected_ids.sort();

        let mut seen = Vec::new();
        let mut seen_labels = HashSet::new();
        let (labels, _) = generate_labels_progressive(
            &mut connection,
            &MockProvider::new(),
            &clouds,
            &nodes,
            &embeddings,
            |cloud_id, assignment| {
                seen.push(cloud_id.to_string());
                assert!(
                    seen_labels.insert(normalized_phrase(&assignment.label)),
                    "duplicate progressive label {}",
                    assignment.label
                );
                Ok(())
            },
        )
        .expect("labels");

        assert_eq!(seen, expected_ids);
        assert_eq!(labels.len(), expected_ids.len());
        for cloud_id in &expected_ids {
            assert!(labels.contains_key(cloud_id));
        }
    }
}
