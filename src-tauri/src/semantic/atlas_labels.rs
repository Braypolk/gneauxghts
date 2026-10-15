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

mod topic_names;

pub(crate) use topic_names::generate_labels_progressive;

// Binds published labels and descriptor embeddings to this exact naming policy.
pub(crate) const LABEL_ALGORITHM_VERSION: &str = "topic-atlas-v9";

const GENERIC_SECTION_LABELS: &[&str] = &["Title", "Overview", "Remembered passage"];

/// Closed-class words (sorted for binary search) are excluded from topic evidence.
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

#[derive(Clone, Debug)]
pub(crate) struct AtlasLabelNote {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) tags: Vec<String>,
    pub(crate) embedding: Vec<f32>,
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
    Topic,
}

impl CloudLabelSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Topic => "topic",
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
    pub(crate) topic_label_count: usize,
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

#[cfg(test)]
mod tests;
