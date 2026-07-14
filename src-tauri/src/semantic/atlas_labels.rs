use super::{
    atlas::{AtlasCloud, AtlasNode},
    db::{load_atlas_label_embeddings, save_atlas_label_embeddings},
    embed::{EmbeddingInputKind, EmbeddingProvider},
    similarity::cosine_similarity,
};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

pub(crate) const LABEL_ALGORITHM_VERSION: &str = "keybert-atlas-v5";
pub(crate) const MEDOID_NOTE_LIMIT: usize = 3;
pub(crate) const CANDIDATES_PER_CLOUD: usize = 48;
pub(crate) const GLOBAL_UNIQUE_CANDIDATE_LIMIT: usize = 256;
pub(crate) const EMBEDDING_BATCH_SIZE: usize = 32;
/// Reject unigrams that appear in more than this fraction of vault notes.
/// This only catches terms that are common in titles/previews/tags. Sparse
/// titles often omit connectors, so ranking also uses a null-centroid residual.
const MAX_DOCUMENT_FREQUENCY_RATIO: f32 = 0.25;
/// Title/preview unigrams whose cloud residual is below this are treated as
/// generic filler (e.g. "from", "with") even when rare in the vault.
const MIN_TITLE_UNIGRAM_RESIDUAL: f32 = 0.12;

#[derive(Clone, Debug)]
pub(crate) struct AtlasLabelNote {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) preview: String,
    pub(crate) tags: Vec<String>,
    pub(crate) embedding: Vec<f32>,
}

#[derive(Clone, Debug, Default)]
struct DocumentFrequency {
    note_count: usize,
    term_frequency: HashMap<String, usize>,
}

impl DocumentFrequency {
    fn from_notes(notes: &HashMap<String, AtlasLabelNote>) -> Self {
        let mut term_frequency = HashMap::new();
        for note in notes.values() {
            let mut terms = HashSet::new();
            collect_document_terms(&note.title, &mut terms);
            collect_document_terms(&note.preview, &mut terms);
            for tag in &note.tags {
                collect_document_terms(tag, &mut terms);
            }
            for term in terms {
                *term_frequency.entry(term).or_default() += 1;
            }
        }
        Self {
            note_count: notes.len(),
            term_frequency,
        }
    }

    fn is_ubiquitous(&self, term: &str) -> bool {
        // Tiny vaults lack enough mass for a stable ratio; keep all candidates.
        if self.note_count < 3 {
            return false;
        }
        let frequency = self.term_frequency.get(term).copied().unwrap_or_default();
        // A term in a single note is rare by definition. Without this floor,
        // vaults of size 3–4 treat every 1-note term as ubiquitous (1/3 > 0.25)
        // and wipe the entire candidate set.
        if frequency < 2 {
            return false;
        }
        (frequency as f32 / self.note_count as f32) > MAX_DOCUMENT_FREQUENCY_RATIO
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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct LabelPipelineMetrics {
    pub(crate) cloud_count: usize,
    pub(crate) candidate_count: usize,
    pub(crate) unique_candidate_count: usize,
    pub(crate) cache_hit_count: usize,
    pub(crate) provider_text_count: usize,
    pub(crate) provider_batch_count: usize,
}

#[derive(Clone, Debug)]
struct CandidateEvidence {
    display: String,
    source_priority: u8,
    note_ids: HashSet<String>,
    word_count: usize,
}

#[derive(Clone, Debug)]
struct ScoredCandidate {
    display: String,
    source_priority: u8,
    note_count: usize,
    word_count: usize,
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
            (
                note.id.clone(),
                cosine_similarity(&centroid, &note.embedding),
            )
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
    // Drop vault-ubiquitous unigrams before building n-grams when DF has
    // enough signal. Titles often omit connectors, so ranking still applies a
    // null-centroid residual for rare-but-generic words.
    let words = sanitized
        .split_whitespace()
        .filter(|word| {
            let normalized = word.to_lowercase();
            is_candidate_token(&normalized) && !document_frequency.is_ubiquitous(&normalized)
        })
        .take(48)
        .collect::<Vec<_>>();
    if words.is_empty() {
        return;
    }
    let max_words = words.len().min(3);
    for start in 0..words.len() {
        for length in 1..=max_words.min(words.len() - start) {
            let display = words[start..start + length].join(" ");
            let normalized = normalized_phrase(&display);
            if normalized.len() < 3 {
                continue;
            }
            let entry = evidence
                .entry(normalized)
                .or_insert_with(|| CandidateEvidence {
                    display,
                    source_priority,
                    note_ids: HashSet::new(),
                    word_count: length,
                });
            entry.source_priority = entry.source_priority.min(source_priority);
            entry.note_ids.insert(note_id.to_string());
            entry.word_count = length;
        }
    }
}

fn candidates_for_cloud(
    cloud: &AtlasCloud,
    notes_by_id: &HashMap<String, AtlasLabelNote>,
    document_frequency: &DocumentFrequency,
) -> CloudCandidates {
    let members = cloud
        .member_node_ids
        .iter()
        .filter_map(|id| notes_by_id.get(id))
        .collect::<Vec<_>>();
    let medoid_ids = medoid_note_ids(&members, MEDOID_NOTE_LIMIT)
        .into_iter()
        .collect::<HashSet<_>>();
    let mut evidence = HashMap::new();
    for note in &members {
        for tag in &note.tags {
            add_source_candidates(tag, &note.id, 0, document_frequency, &mut evidence);
        }
        add_source_candidates(&note.title, &note.id, 1, document_frequency, &mut evidence);
        if medoid_ids.contains(&note.id) {
            add_source_candidates(
                &note.preview,
                &note.id,
                2,
                document_frequency,
                &mut evidence,
            );
        }
    }
    let mut ranked = evidence.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        left.1
            .source_priority
            .cmp(&right.1.source_priority)
            .then_with(|| right.1.note_ids.len().cmp(&left.1.note_ids.len()))
            .then_with(|| right.1.word_count.cmp(&left.1.word_count))
            .then_with(|| left.0.cmp(&right.0))
    });
    CloudCandidates {
        cloud_id: cloud.id.clone(),
        centroid: cloud_centroid(&members),
        phrases: ranked
            .into_iter()
            .filter(|(_, value)| {
                // Single-word title/preview terms need cross-note support.
                // Tags may still label a cloud from one distinctive note.
                value.word_count > 1 || value.source_priority == 0 || value.note_ids.len() >= 2
            })
            .take(CANDIDATES_PER_CLOUD)
            .map(|(_, value)| ScoredCandidate {
                display: value.display,
                source_priority: value.source_priority,
                note_count: value.note_ids.len(),
                word_count: value.word_count,
            })
            .collect(),
    }
}

fn globally_embedded_candidates(candidate_clouds: &[CloudCandidates]) -> Vec<String> {
    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for phrase in candidate_clouds
        .iter()
        .flat_map(|cloud| cloud.phrases.iter().map(|candidate| &candidate.display))
    {
        let key = normalized_phrase(phrase);
        if seen.contains(&key) {
            continue;
        }
        if seen.len() >= GLOBAL_UNIQUE_CANDIDATE_LIMIT {
            break;
        }
        seen.insert(key);
        unique.push(phrase.clone());
    }
    unique
}

fn candidate_rank_score(
    cloud_similarity: f32,
    null_similarity: f32,
    candidate: &ScoredCandidate,
) -> f32 {
    // Prefer phrases that match the cloud more than generic vault meaning.
    // Connectors embed near the vault average, so their residual collapses.
    let residual = cloud_similarity - null_similarity;
    let phrase_bonus = candidate.word_count.saturating_sub(1) as f32 * 0.08;
    let coverage_bonus = ((candidate.note_count as f32).ln_1p()) * 0.04;
    let tag_bonus = if candidate.source_priority == 0 {
        0.03
    } else {
        0.0
    };
    residual + phrase_bonus + coverage_bonus + tag_bonus
}

pub(crate) fn generate_labels(
    connection: &mut Connection,
    provider: &dyn EmbeddingProvider,
    clouds: &[AtlasCloud],
    nodes: &[AtlasNode],
    note_embeddings: &HashMap<String, Vec<f32>>,
) -> Result<(HashMap<String, (String, f32)>, LabelPipelineMetrics), String> {
    let notes_by_id = nodes
        .iter()
        .filter_map(|node| {
            note_embeddings
                .get(&node.id)
                .map(|embedding| AtlasLabelNote {
                    id: node.id.clone(),
                    title: node.title.clone(),
                    preview: node.preview.clone(),
                    tags: node.tags.clone(),
                    embedding: embedding.clone(),
                })
        })
        .map(|note| (note.id.clone(), note))
        .collect::<HashMap<_, _>>();
    let document_frequency = DocumentFrequency::from_notes(&notes_by_id);
    let null_centroid = mean_embedding(
        &notes_by_id
            .values()
            .map(|note| note.embedding.clone())
            .collect::<Vec<_>>(),
    );
    let mut candidate_clouds = clouds
        .iter()
        .map(|cloud| candidates_for_cloud(cloud, &notes_by_id, &document_frequency))
        .collect::<Vec<_>>();
    candidate_clouds.sort_by(|left, right| left.cloud_id.cmp(&right.cloud_id));
    let candidate_count = candidate_clouds
        .iter()
        .map(|cloud| cloud.phrases.len())
        .sum();

    // Budget provider work globally, without removing phrases from any cloud.
    // A shared phrase is embedded once and every cloud ranks it through the
    // shared normalized-key lookup below.
    let unique = globally_embedded_candidates(&candidate_clouds);

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
    let mut provider_batches = 0usize;
    for batch in missing.chunks(EMBEDDING_BATCH_SIZE) {
        let texts = batch
            .iter()
            .map(|(phrase, _)| phrase.clone())
            .collect::<Vec<_>>();
        let vectors = provider.embed_texts(&texts, EmbeddingInputKind::Document)?;
        if vectors.len() != batch.len() {
            return Err("Atlas label embedding provider returned an unexpected count".to_string());
        }
        let rows = batch
            .iter()
            .zip(vectors)
            .map(|((_, key), vector)| (key.clone(), vector))
            .collect::<Vec<_>>();
        save_atlas_label_embeddings(connection, &rows, &fingerprint, LABEL_ALGORITHM_VERSION)?;
        embeddings.extend(rows);
        provider_batches += 1;
    }

    let mut ranked_by_cloud = Vec::new();
    for cloud in candidate_clouds {
        let mut ranked = cloud
            .phrases
            .into_iter()
            .filter_map(|candidate| {
                let key = normalized_phrase(&candidate.display);
                let embedding = embeddings.get(&key)?;
                let cloud_similarity = cosine_similarity(&cloud.centroid, embedding);
                let null_similarity = cosine_similarity(&null_centroid, embedding);
                let residual = cloud_similarity - null_similarity;
                // Rare connectors still embed near the vault average. Drop them
                // unless they are tags or multi-word phrases.
                if candidate.word_count == 1
                    && candidate.source_priority > 0
                    && residual < MIN_TITLE_UNIGRAM_RESIDUAL
                {
                    return None;
                }
                let score = candidate_rank_score(cloud_similarity, null_similarity, &candidate);
                Some((candidate.display, score))
            })
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| {
            right
                .1
                .total_cmp(&left.1)
                .then_with(|| normalized_phrase(&left.0).cmp(&normalized_phrase(&right.0)))
        });
        ranked_by_cloud.push((cloud.cloud_id, ranked));
    }
    let labels = assign_unique_labels(ranked_by_cloud);
    Ok((
        labels,
        LabelPipelineMetrics {
            cloud_count: clouds.len(),
            candidate_count,
            unique_candidate_count: unique.len(),
            cache_hit_count: cached.len(),
            provider_text_count: missing.len(),
            provider_batch_count: provider_batches,
        },
    ))
}

fn assign_unique_labels(
    ranked_by_cloud: Vec<(String, Vec<(String, f32)>)>,
) -> HashMap<String, (String, f32)> {
    let mut used = HashSet::new();
    let mut output = HashMap::new();
    for (cloud_id, ranked) in ranked_by_cloud {
        let choice = ranked
            .iter()
            .find(|(phrase, _)| !used.contains(&normalized_phrase(phrase)))
            .or_else(|| ranked.first());
        if let Some((phrase, score)) = choice {
            used.insert(normalized_phrase(phrase));
            output.insert(cloud_id, (phrase.clone(), *score));
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        note::DocumentKind,
        semantic::embed::{ModelInfo, SemanticModelDownloadResult},
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn note(id: &str, title: &str, embedding: Vec<f32>) -> AtlasLabelNote {
        AtlasLabelNote {
            id: id.to_string(),
            title: title.to_string(),
            preview: String::new(),
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
                    if text.to_lowercase().contains("garden") {
                        vec![1.0, 0.0]
                    } else {
                        vec![0.0, 1.0]
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
            id: "cloud".to_string(),
            parent_id: None,
            level: 0,
            label: None,
            label_confidence: 0.0,
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
    fn high_document_frequency_terms_never_become_label_candidates() {
        let mut notes = HashMap::new();
        for index in 0..8 {
            let id = format!("filler-{index}");
            notes.insert(
                id.clone(),
                note(
                    &id,
                    "After the notes from with updates about the day",
                    vec![0.0, 1.0],
                ),
            );
        }
        notes.insert(
            "a".to_string(),
            note("a", "After the Meeting with Alice", vec![1.0, 0.0]),
        );
        notes.insert(
            "b".to_string(),
            note("b", "From the Notes with Bob", vec![0.9, 0.1]),
        );
        notes.insert(
            "c".to_string(),
            note("c", "With the Project after Launch", vec![0.8, 0.2]),
        );

        let document_frequency = DocumentFrequency::from_notes(&notes);
        assert!(document_frequency.is_ubiquitous("the"));
        assert!(document_frequency.is_ubiquitous("from"));
        assert!(document_frequency.is_ubiquitous("with"));
        assert!(document_frequency.is_ubiquitous("after"));
        assert!(!document_frequency.is_ubiquitous("meeting"));
        assert!(!document_frequency.is_ubiquitous("project"));

        let candidates =
            candidates_for_cloud(&cloud(&["a", "b", "c"]), &notes, &document_frequency);
        let normalized = candidates
            .phrases
            .iter()
            .map(|phrase| normalized_phrase(&phrase.display))
            .collect::<HashSet<_>>();

        for common in ["the", "from", "with", "after", "notes"] {
            assert!(
                !normalized.contains(common),
                "high-DF term `{common}` should not be a candidate: {normalized:?}"
            );
        }
        assert!(normalized.iter().any(|phrase| phrase.contains("meeting")));
        assert!(normalized.iter().any(|phrase| phrase.contains("project")));
        assert!(normalized.iter().any(|phrase| phrase.contains("alice")));
    }

    #[test]
    fn null_centroid_residual_prefers_topic_over_generic_unigram() {
        let topic = ScoredCandidate {
            display: "Garden".to_string(),
            source_priority: 1,
            note_count: 3,
            word_count: 1,
        };
        let connector = ScoredCandidate {
            display: "From".to_string(),
            source_priority: 1,
            note_count: 1,
            word_count: 1,
        };
        // Both are close to the cloud, but the connector is also close to the
        // vault-wide average ("null") meaning.
        let topic_score = candidate_rank_score(0.82, 0.20, &topic);
        let connector_score = candidate_rank_score(0.80, 0.78, &connector);
        assert!(topic_score > connector_score);
    }

    #[test]
    fn singleton_title_unigrams_are_dropped_without_cross_note_support() {
        let notes = [
            note("a", "From Alice Meeting", vec![1.0, 0.0]),
            note("b", "Bob Planning", vec![0.9, 0.1]),
            note("c", "Carol Launch", vec![0.8, 0.2]),
        ]
        .into_iter()
        .map(|note| (note.id.clone(), note))
        .collect::<HashMap<_, _>>();
        let document_frequency = DocumentFrequency::from_notes(&notes);
        // Rare terms must not be treated as ubiquitous in small vaults.
        assert!(!document_frequency.is_ubiquitous("from"));
        assert!(!document_frequency.is_ubiquitous("alice"));
        let candidates =
            candidates_for_cloud(&cloud(&["a", "b", "c"]), &notes, &document_frequency);
        let normalized = candidates
            .phrases
            .iter()
            .map(|phrase| normalized_phrase(&phrase.display))
            .collect::<HashSet<_>>();
        assert!(!normalized.contains("from"));
        assert!(!normalized.contains("alice"));
        assert!(normalized.iter().any(|phrase| phrase.contains("alice")));
    }

    #[test]
    fn weak_residual_title_unigrams_are_skipped_during_ranking() {
        let topic = ScoredCandidate {
            display: "Gardening".to_string(),
            source_priority: 1,
            note_count: 2,
            word_count: 1,
        };
        let connector = ScoredCandidate {
            display: "From".to_string(),
            source_priority: 1,
            note_count: 2,
            word_count: 1,
        };
        assert!(candidate_rank_score(0.85, 0.20, &topic) > MIN_TITLE_UNIGRAM_RESIDUAL);
        // Connector is near both cloud and vault average → residual collapses.
        let connector_residual = 0.80 - 0.78;
        assert!(connector_residual < MIN_TITLE_UNIGRAM_RESIDUAL);
        assert!(
            candidate_rank_score(0.85, 0.20, &topic) > candidate_rank_score(0.80, 0.78, &connector)
        );
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
        let assigned = assign_unique_labels(vec![
            (
                "a".to_string(),
                vec![("Shared".to_string(), 0.9), ("First".to_string(), 0.8)],
            ),
            (
                "b".to_string(),
                vec![("Shared".to_string(), 0.95), ("Second".to_string(), 0.7)],
            ),
        ]);
        assert_eq!(assigned["a"].0, "Shared");
        assert_eq!(assigned["b"].0, "Second");
    }

    #[test]
    fn highest_similarity_wins_without_threshold() {
        let assigned = assign_unique_labels(vec![(
            "a".to_string(),
            vec![
                ("Tiny winner".to_string(), -0.1),
                ("Other".to_string(), -0.2),
            ],
        )]);
        assert_eq!(assigned["a"], ("Tiny winner".to_string(), -0.1));
    }

    #[test]
    fn model_and_version_are_part_of_cache_identity() {
        assert_ne!(
            format!("model-a:{LABEL_ALGORITHM_VERSION}"),
            format!("model-b:{LABEL_ALGORITHM_VERSION}")
        );
        assert_ne!(
            format!("model-a:{LABEL_ALGORITHM_VERSION}"),
            "model-a:keybert-atlas-v999"
        );
    }

    #[test]
    fn candidate_budget_is_bounded_and_globally_deduplicated() {
        let notes = (0..20)
            .map(|index| {
                note(
                    &format!("n{index}"),
                    &format!("Topic{index} Subtopic{index} Detail{index} Extra{index} Item{index}"),
                    vec![1.0, 0.0],
                )
            })
            .map(|note| (note.id.clone(), note))
            .collect::<HashMap<_, _>>();
        let document_frequency = DocumentFrequency::from_notes(&notes);
        let candidates = candidates_for_cloud(
            &cloud(
                &(0..20)
                    .map(|index| format!("n{index}"))
                    .collect::<Vec<_>>()
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
            ),
            &notes,
            &document_frequency,
        );
        assert!(candidates.phrases.len() <= CANDIDATES_PER_CLOUD);
        assert!(!candidates.phrases.is_empty());
        let unique = candidates
            .phrases
            .iter()
            .map(|phrase| normalized_phrase(&phrase.display))
            .collect::<HashSet<_>>();
        assert_eq!(unique.len(), candidates.phrases.len());
    }

    #[test]
    fn global_budget_keeps_duplicate_phrases_reusable_by_every_cloud() {
        let shared = ScoredCandidate {
            display: "Shared Topic".to_string(),
            source_priority: 1,
            note_count: 2,
            word_count: 2,
        };
        let clouds = vec![
            CloudCandidates {
                cloud_id: "a".to_string(),
                centroid: vec![1.0, 0.0],
                phrases: std::iter::once(shared.clone())
                    .chain(
                        (0..GLOBAL_UNIQUE_CANDIDATE_LIMIT).map(|index| ScoredCandidate {
                            display: format!("candidate {index}"),
                            source_priority: 1,
                            note_count: 1,
                            word_count: 2,
                        }),
                    )
                    .collect(),
            },
            CloudCandidates {
                cloud_id: "b".to_string(),
                centroid: vec![1.0, 0.0],
                phrases: vec![
                    shared.clone(),
                    ScoredCandidate {
                        display: "over budget".to_string(),
                        source_priority: 1,
                        note_count: 1,
                        word_count: 2,
                    },
                ],
            },
        ];

        let embedded = globally_embedded_candidates(&clouds);
        assert_eq!(embedded.len(), GLOBAL_UNIQUE_CANDIDATE_LIMIT);
        assert_eq!(
            embedded
                .iter()
                .filter(|phrase| normalized_phrase(phrase) == normalized_phrase(&shared.display))
                .count(),
            1
        );
        assert!(clouds[1]
            .phrases
            .iter()
            .any(|phrase| phrase.display == shared.display));
    }

    #[test]
    fn phrase_cache_hit_skips_embedding_provider() {
        let mut connection = Connection::open_in_memory().expect("database");
        crate::semantic::db::ensure_schema(&connection).expect("schema");
        let provider = MockProvider::new();
        let (first, first_embedding) = atlas_node("a", "Garden Planning", &[1.0, 0.0]);
        let (second, second_embedding) = atlas_node("b", "Garden Ideas", &[0.9, 0.1]);
        let nodes = vec![first, second];
        let embeddings = HashMap::from([
            ("a".to_string(), first_embedding),
            ("b".to_string(), second_embedding),
        ]);
        let clouds = vec![cloud(&["a", "b"])];

        let (_, first_metrics) =
            generate_labels(&mut connection, &provider, &clouds, &nodes, &embeddings)
                .expect("first labels");
        let calls_after_first = provider.calls.load(Ordering::Relaxed);
        let (_, second_metrics) =
            generate_labels(&mut connection, &provider, &clouds, &nodes, &embeddings)
                .expect("cached labels");

        assert!(first_metrics.provider_text_count > 0);
        assert!(second_metrics.cache_hit_count > 0);
        assert_eq!(second_metrics.provider_text_count, 0);
        assert_eq!(provider.calls.load(Ordering::Relaxed), calls_after_first);
    }

    #[test]
    fn provider_failure_returns_without_a_label_generation() {
        let mut connection = Connection::open_in_memory().expect("database");
        crate::semantic::db::ensure_schema(&connection).expect("schema");
        let provider = MockProvider::failing();
        let (node, embedding) = atlas_node("a", "Garden Planning", &[1.0, 0.0]);
        let result = generate_labels(
            &mut connection,
            &provider,
            &[cloud(&["a"])],
            &[node],
            &HashMap::from([("a".to_string(), embedding)]),
        );
        assert_eq!(
            result.expect_err("provider failure"),
            "mock provider failure"
        );
    }

    #[test]
    fn membership_fingerprint_binds_structural_generation_and_members() {
        let first = cloud_membership_fingerprint("generation-a", &[cloud(&["a", "b"])]);
        let next_generation = cloud_membership_fingerprint("generation-b", &[cloud(&["a", "b"])]);
        let next_members = cloud_membership_fingerprint("generation-a", &[cloud(&["a", "c"])]);
        assert_ne!(first, next_generation);
        assert_ne!(first, next_members);
    }
}
