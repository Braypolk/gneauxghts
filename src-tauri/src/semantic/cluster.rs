use std::collections::{HashMap, HashSet};

use super::similarity::cosine_similarity;

const MAX_CLUSTER_NOTES: usize = 7;
const MIN_COLOR_GROUPS: usize = 2;
const MAX_COLOR_GROUPS: usize = 5;

pub(crate) struct ClusterResult {
    pub(crate) assignments: Vec<usize>,
    pub(crate) labels: Vec<String>,
    pub(crate) color_groups: Vec<usize>,
    pub(crate) k: usize,
}

/// Candidate extraction + embedding callback used for KeyBERT-style labeling.
/// Returns Ok(embeddings) for the given strings, or Err to fall back to TF-IDF.
pub(crate) type EmbedFn = dyn Fn(&[String]) -> Result<Vec<Vec<f32>>, String>;

pub(crate) fn cluster_notes(
    embeddings: &[(String, Vec<f32>)],
    note_titles: &HashMap<String, String>,
    note_snippets: &HashMap<String, String>,
    embed_fn: Option<&EmbedFn>,
    requested_color_groups: usize,
) -> ClusterResult {
    let n = embeddings.len();
    if n == 0 {
        return ClusterResult {
            assignments: Vec::new(),
            labels: Vec::new(),
            color_groups: Vec::new(),
            k: 0,
        };
    }

    let k = choose_k(n);
    if k <= 1 || n <= k {
        let assignments = vec![0; n];
        let label = label_for_single_cluster(embeddings, note_titles, note_snippets, embed_fn);
        return ClusterResult {
            assignments,
            labels: vec![label],
            color_groups: vec![0],
            k: 1,
        };
    }

    let assignments = split_oversized_clusters(embeddings, kmeans(embeddings, k, 25));
    let final_k = assignments
        .iter()
        .max()
        .map(|cluster| cluster + 1)
        .unwrap_or(0);
    let cluster_members = build_cluster_members(&assignments);
    let centroids = compute_cluster_centroids(embeddings, &cluster_members);
    let labels = generate_labels(
        embeddings,
        &assignments,
        final_k,
        note_titles,
        note_snippets,
        embed_fn,
    );
    let color_groups = assign_color_groups(&centroids, requested_color_groups);

    ClusterResult {
        assignments,
        labels,
        color_groups,
        k: final_k,
    }
}

fn label_for_single_cluster(
    embeddings: &[(String, Vec<f32>)],
    note_titles: &HashMap<String, String>,
    note_snippets: &HashMap<String, String>,
    embed_fn: Option<&EmbedFn>,
) -> String {
    let paths: Vec<&str> = embeddings.iter().map(|(p, _)| p.as_str()).collect();
    let vecs: Vec<&Vec<f32>> = embeddings.iter().map(|(_, v)| v).collect();
    let centroid = compute_centroid(&vecs);

    if let Some(label) = try_keybert_label(&centroid, &paths, note_titles, note_snippets, embed_fn)
    {
        return label;
    }
    tfidf_label(paths.into_iter(), note_titles, note_snippets)
}

fn generate_labels(
    embeddings: &[(String, Vec<f32>)],
    assignments: &[usize],
    k: usize,
    note_titles: &HashMap<String, String>,
    note_snippets: &HashMap<String, String>,
    embed_fn: Option<&EmbedFn>,
) -> Vec<String> {
    let mut cluster_members: Vec<Vec<usize>> = vec![Vec::new(); k];
    for (i, &c) in assignments.iter().enumerate() {
        if c < k {
            cluster_members[c].push(i);
        }
    }

    let centroids: Vec<Vec<f32>> = (0..k)
        .map(|c| {
            let vecs: Vec<&Vec<f32>> = cluster_members[c]
                .iter()
                .map(|&i| &embeddings[i].1)
                .collect();
            compute_centroid(&vecs)
        })
        .collect();

    // Batch all candidate embeddings across clusters in one call for efficiency
    if let Some(ef) = embed_fn {
        if let Some(labels) = try_keybert_labels_batched(
            &centroids,
            &cluster_members,
            embeddings,
            note_titles,
            note_snippets,
            ef,
        ) {
            return labels;
        }
    }

    // Fallback: TF-IDF per cluster
    (0..k)
        .map(|c| {
            let paths = cluster_members[c].iter().map(|&i| embeddings[i].0.as_str());
            tfidf_label(paths, note_titles, note_snippets)
        })
        .collect()
}

fn compute_cluster_centroids(
    embeddings: &[(String, Vec<f32>)],
    cluster_members: &[Vec<usize>],
) -> Vec<Vec<f32>> {
    cluster_members
        .iter()
        .map(|members| {
            let vecs: Vec<&Vec<f32>> = members.iter().map(|&i| &embeddings[i].1).collect();
            compute_centroid(&vecs)
        })
        .collect()
}

fn clamp_color_group_count(requested_color_groups: usize, cluster_count: usize) -> usize {
    requested_color_groups
        .clamp(MIN_COLOR_GROUPS, MAX_COLOR_GROUPS)
        .min(cluster_count.max(1))
}

fn assign_color_groups(centroids: &[Vec<f32>], requested_color_groups: usize) -> Vec<usize> {
    if centroids.is_empty() {
        return Vec::new();
    }
    if centroids.len() == 1 {
        return vec![0];
    }

    let color_group_count = clamp_color_group_count(requested_color_groups, centroids.len());
    if color_group_count <= 1 {
        return vec![0; centroids.len()];
    }

    let centroid_embeddings: Vec<(String, Vec<f32>)> = centroids
        .iter()
        .enumerate()
        .map(|(index, centroid)| (format!("cluster-{index}"), centroid.clone()))
        .collect();

    kmeans(&centroid_embeddings, color_group_count, 25)
}

fn compute_centroid(vecs: &[&Vec<f32>]) -> Vec<f32> {
    if vecs.is_empty() {
        return Vec::new();
    }
    let dim = vecs[0].len();
    let mut centroid = vec![0.0f32; dim];
    for v in vecs {
        for (i, &val) in v.iter().enumerate() {
            centroid[i] += val;
        }
    }
    let n = vecs.len() as f32;
    for val in &mut centroid {
        *val /= n;
    }
    // L2 normalize
    let norm: f32 = centroid.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for val in &mut centroid {
            *val /= norm;
        }
    }
    centroid
}

// ---------------------------------------------------------------------------
// KeyBERT-style labeling
// ---------------------------------------------------------------------------

/// Batch KeyBERT labeling for all clusters at once (single embed call).
fn try_keybert_labels_batched(
    centroids: &[Vec<f32>],
    cluster_members: &[Vec<usize>],
    embeddings: &[(String, Vec<f32>)],
    note_titles: &HashMap<String, String>,
    note_snippets: &HashMap<String, String>,
    embed_fn: &EmbedFn,
) -> Option<Vec<String>> {
    let k = centroids.len();

    // Per-cluster: find medoid paths + collect all candidate n-grams
    let mut per_cluster_candidates: Vec<Vec<String>> = Vec::with_capacity(k);
    let mut all_unique_candidates: Vec<String> = Vec::new();
    let mut candidate_set: HashSet<String> = HashSet::new();

    for c in 0..k {
        let member_indices = &cluster_members[c];
        if member_indices.is_empty() {
            per_cluster_candidates.push(Vec::new());
            continue;
        }

        let centroid = &centroids[c];
        let mut medoids: Vec<(usize, f32)> = member_indices
            .iter()
            .map(|&i| (i, cosine_similarity(&embeddings[i].1, centroid)))
            .collect();
        medoids.sort_by(|a, b| b.1.total_cmp(&a.1));
        let top_medoid_count = medoids.len().min(5);

        // Extract candidates from ALL member titles + medoid snippets
        let mut candidates = Vec::new();
        let stops = stop_words();

        for &idx in member_indices {
            let path = &embeddings[idx].0;
            if let Some(title) = note_titles.get(path) {
                extract_ngrams(title, &stops, &mut candidates);
            }
        }

        for &(idx, _) in &medoids[..top_medoid_count] {
            let path = &embeddings[idx].0;
            if let Some(snippet) = note_snippets.get(path) {
                extract_ngrams(snippet, &stops, &mut candidates);
            }
        }

        candidates.sort();
        candidates.dedup();

        for c_str in &candidates {
            if candidate_set.insert(c_str.clone()) {
                all_unique_candidates.push(c_str.clone());
            }
        }
        per_cluster_candidates.push(candidates);
    }

    if all_unique_candidates.is_empty() {
        return None;
    }

    // Single batch embed call for all candidates across all clusters
    let candidate_embeddings = embed_fn(&all_unique_candidates).ok()?;
    if candidate_embeddings.len() != all_unique_candidates.len() {
        return None;
    }

    let embed_lookup: HashMap<&str, &Vec<f32>> = all_unique_candidates
        .iter()
        .zip(candidate_embeddings.iter())
        .map(|(s, v)| (s.as_str(), v))
        .collect();

    // Per-cluster: rank candidates, apply MMR for diversity
    let mut labels = Vec::with_capacity(k);
    for c in 0..k {
        let centroid = &centroids[c];
        let candidates = &per_cluster_candidates[c];

        if candidates.is_empty() {
            labels.push("Notes".to_string());
            continue;
        }

        let mut scored: Vec<(&str, f32)> = candidates
            .iter()
            .filter_map(|cand| {
                let emb = embed_lookup.get(cand.as_str())?;
                let sim = cosine_similarity(emb, centroid);
                Some((cand.as_str(), sim))
            })
            .collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));

        // MMR selection: pick top terms that aren't too similar to each other
        let mut selected: Vec<(&str, &Vec<f32>)> = Vec::new();
        for &(term, _score) in &scored {
            if selected.len() >= 3 {
                break;
            }
            if let Some(emb) = embed_lookup.get(term) {
                let too_similar = selected
                    .iter()
                    .any(|(_, sel_emb)| cosine_similarity(emb, sel_emb) > 0.85);
                if !too_similar {
                    selected.push((term, emb));
                }
            }
        }

        if selected.is_empty() {
            labels.push("Notes".to_string());
        } else {
            let label = selected
                .iter()
                .map(|(term, _)| capitalize_first(term))
                .collect::<Vec<_>>()
                .join(" / ");
            labels.push(label);
        }
    }

    Some(labels)
}

/// Single-cluster KeyBERT attempt.
fn try_keybert_label(
    centroid: &[f32],
    paths: &[&str],
    note_titles: &HashMap<String, String>,
    note_snippets: &HashMap<String, String>,
    embed_fn: Option<&EmbedFn>,
) -> Option<String> {
    let ef = embed_fn?;
    let stops = stop_words();
    let mut candidates = Vec::new();

    for &path in paths {
        if let Some(title) = note_titles.get(path) {
            extract_ngrams(title, &stops, &mut candidates);
        }
        if let Some(snippet) = note_snippets.get(path) {
            extract_ngrams(snippet, &stops, &mut candidates);
        }
    }
    candidates.sort();
    candidates.dedup();

    if candidates.is_empty() {
        return None;
    }

    let embeddings = ef(&candidates).ok()?;
    if embeddings.len() != candidates.len() {
        return None;
    }

    let mut scored: Vec<(&str, f32, &Vec<f32>)> = candidates
        .iter()
        .zip(embeddings.iter())
        .map(|(cand, emb)| (cand.as_str(), cosine_similarity(emb, centroid), emb))
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));

    let mut selected: Vec<(&str, &Vec<f32>)> = Vec::new();
    for &(term, _score, emb) in &scored {
        if selected.len() >= 3 {
            break;
        }
        let too_similar = selected
            .iter()
            .any(|(_, sel_emb)| cosine_similarity(emb, sel_emb) > 0.85);
        if !too_similar {
            selected.push((term, emb));
        }
    }

    if selected.is_empty() {
        return None;
    }

    let label = selected
        .iter()
        .map(|(term, _)| capitalize_first(term))
        .collect::<Vec<_>>()
        .join(" / ");
    Some(label)
}

// ---------------------------------------------------------------------------
// N-gram extraction
// ---------------------------------------------------------------------------

fn extract_ngrams(text: &str, stops: &HashSet<&str>, out: &mut Vec<String>) {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() >= 3 && !stops.contains(w.as_str()) && !is_pure_number(w))
        .collect();

    // Unigrams
    for w in &words {
        out.push(w.clone());
    }

    // Bigrams
    for pair in words.windows(2) {
        out.push(format!("{} {}", pair[0], pair[1]));
    }
}

fn is_pure_number(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii_digit())
}

// ---------------------------------------------------------------------------
// TF-IDF fallback
// ---------------------------------------------------------------------------

fn tfidf_label<'a>(
    member_paths: impl Iterator<Item = &'a str>,
    note_titles: &HashMap<String, String>,
    note_snippets: &HashMap<String, String>,
) -> String {
    let mut term_freq: HashMap<String, usize> = HashMap::new();
    let mut doc_count = 0usize;

    for path in member_paths {
        doc_count += 1;
        let mut text = String::new();
        if let Some(title) = note_titles.get(path) {
            text.push_str(title);
            text.push(' ');
        }
        if let Some(snippet) = note_snippets.get(path) {
            text.push_str(snippet);
        }
        if text.is_empty() {
            continue;
        }
        for word in extract_words(&text) {
            *term_freq.entry(word).or_default() += 1;
        }
    }

    if term_freq.is_empty() {
        return "Notes".to_string();
    }

    let stop_words = stop_words();
    let mut scored: Vec<(String, f64)> = term_freq
        .into_iter()
        .filter(|(word, count)| {
            *count >= 2 && word.len() >= 3 && !stop_words.contains(word.as_str())
        })
        .map(|(word, count)| {
            let tf = count as f64;
            let idf = ((doc_count as f64 + 1.0) / (count as f64 + 1.0)).ln() + 1.0;
            (word, tf * idf)
        })
        .collect();

    scored.sort_by(|a, b| b.1.total_cmp(&a.1));

    let top_terms: Vec<String> = scored
        .into_iter()
        .take(3)
        .map(|(word, _)| capitalize_first(&word))
        .collect();

    if top_terms.is_empty() {
        "Notes".to_string()
    } else {
        top_terms.join(" / ")
    }
}

fn extract_words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect()
}

// ---------------------------------------------------------------------------
// Cluster size refinement
// ---------------------------------------------------------------------------

fn split_oversized_clusters(
    embeddings: &[(String, Vec<f32>)],
    initial_assignments: Vec<usize>,
) -> Vec<usize> {
    let mut clusters = build_cluster_members(&initial_assignments);
    let mut changed = true;

    while changed {
        changed = false;
        let mut refined = Vec::new();

        for members in clusters {
            if members.len() <= MAX_CLUSTER_NOTES || members.len() < 2 {
                refined.push(members);
                continue;
            }

            let split_count = choose_split_k(members.len());
            let split_clusters = split_member_indices(embeddings, &members, split_count);

            if split_clusters.len() <= 1 {
                refined.push(members);
                continue;
            }

            changed = true;
            refined.extend(split_clusters);
        }

        clusters = refined;
    }

    let mut assignments = vec![0usize; embeddings.len()];
    for (cluster_id, members) in clusters.iter().enumerate() {
        for &index in members {
            assignments[index] = cluster_id;
        }
    }
    assignments
}

fn build_cluster_members(assignments: &[usize]) -> Vec<Vec<usize>> {
    let cluster_count = assignments
        .iter()
        .max()
        .map(|cluster| cluster + 1)
        .unwrap_or(0);
    let mut clusters = vec![Vec::new(); cluster_count];
    for (index, &cluster_id) in assignments.iter().enumerate() {
        if cluster_id < cluster_count {
            clusters[cluster_id].push(index);
        }
    }
    clusters.retain(|members| !members.is_empty());
    clusters
}

fn choose_split_k(member_count: usize) -> usize {
    let target = ((member_count as f64) / (MAX_CLUSTER_NOTES as f64)).ceil() as usize;
    target.clamp(2, member_count)
}

fn split_member_indices(
    embeddings: &[(String, Vec<f32>)],
    members: &[usize],
    split_count: usize,
) -> Vec<Vec<usize>> {
    if members.len() < 2 || split_count < 2 {
        return vec![members.to_vec()];
    }

    let subset: Vec<(String, Vec<f32>)> = members
        .iter()
        .map(|&index| embeddings[index].clone())
        .collect();
    let sub_assignments = kmeans(&subset, split_count.min(subset.len()), 25);
    let mut subclusters = build_cluster_members(&sub_assignments)
        .into_iter()
        .map(|cluster| {
            cluster
                .into_iter()
                .filter_map(|subset_index| members.get(subset_index).copied())
                .collect::<Vec<_>>()
        })
        .filter(|cluster| !cluster.is_empty())
        .collect::<Vec<_>>();

    if subclusters.len() <= 1 {
        return fallback_partition(members, split_count);
    }

    subclusters.sort_by(|left, right| left[0].cmp(&right[0]));
    subclusters
}

fn fallback_partition(members: &[usize], split_count: usize) -> Vec<Vec<usize>> {
    if split_count < 2 || members.len() < 2 {
        return vec![members.to_vec()];
    }

    let partitions = split_count.min(members.len());
    let base_size = members.len() / partitions;
    let remainder = members.len() % partitions;

    let mut result = Vec::with_capacity(partitions);
    let mut cursor = 0;
    for partition_index in 0..partitions {
        let size = base_size + usize::from(partition_index < remainder);
        let end = cursor + size;
        result.push(members[cursor..end].to_vec());
        cursor = end;
    }
    result
}

// ---------------------------------------------------------------------------
// k-means
// ---------------------------------------------------------------------------

fn choose_k(n: usize) -> usize {
    let raw = ((n as f64) / 3.0).sqrt();
    (raw.round() as usize).clamp(3, 8)
}

fn kmeans(embeddings: &[(String, Vec<f32>)], k: usize, max_iterations: usize) -> Vec<usize> {
    let n = embeddings.len();
    let dim = embeddings[0].1.len();

    let mut centroids = initialize_centroids(embeddings, k);
    let mut assignments = vec![0usize; n];

    for _ in 0..max_iterations {
        let mut changed = false;
        for i in 0..n {
            let nearest = nearest_centroid(&embeddings[i].1, &centroids);
            if assignments[i] != nearest {
                assignments[i] = nearest;
                changed = true;
            }
        }

        if !changed {
            break;
        }

        let mut new_centroids = vec![vec![0.0f32; dim]; k];
        let mut counts = vec![0usize; k];

        for (i, embedding) in embeddings.iter().enumerate() {
            let cluster = assignments[i];
            counts[cluster] += 1;
            for (j, &val) in embedding.1.iter().enumerate() {
                new_centroids[cluster][j] += val;
            }
        }

        for (cluster, centroid) in new_centroids.iter_mut().enumerate() {
            if counts[cluster] > 0 {
                let count = counts[cluster] as f32;
                for val in centroid.iter_mut() {
                    *val /= count;
                }
            } else {
                centroid.clone_from(&centroids[cluster]);
            }
        }

        centroids = new_centroids;
    }

    assignments
}

fn initialize_centroids(embeddings: &[(String, Vec<f32>)], k: usize) -> Vec<Vec<f32>> {
    let n = embeddings.len();
    let mut centroids = Vec::with_capacity(k);
    centroids.push(embeddings[0].1.clone());

    let mut distances = vec![f32::MAX; n];

    for _ in 1..k {
        for (i, embedding) in embeddings.iter().enumerate() {
            let dist = euclidean_distance_sq(&embedding.1, centroids.last().unwrap());
            distances[i] = distances[i].min(dist);
        }

        let total: f32 = distances.iter().sum();
        if total <= 0.0 {
            centroids.push(embeddings[centroids.len() % n].1.clone());
            continue;
        }

        let threshold = total * simple_random_fraction(centroids.len());
        let mut cumulative = 0.0f32;
        let mut selected = 0;
        for (i, &dist) in distances.iter().enumerate() {
            cumulative += dist;
            if cumulative >= threshold {
                selected = i;
                break;
            }
        }
        centroids.push(embeddings[selected].1.clone());
    }

    centroids
}

fn simple_random_fraction(seed: usize) -> f32 {
    let hash = (seed as u64)
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    (hash >> 33) as f32 / (1u64 << 31) as f32
}

fn nearest_centroid(point: &[f32], centroids: &[Vec<f32>]) -> usize {
    let mut best = 0;
    let mut best_dist = f32::MAX;
    for (i, centroid) in centroids.iter().enumerate() {
        let dist = euclidean_distance_sq(point, centroid);
        if dist < best_dist {
            best_dist = dist;
            best = i;
        }
    }
    best
}

fn euclidean_distance_sq(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(&x, &y)| {
            let diff = x - y;
            diff * diff
        })
        .sum()
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let upper: String = first.to_uppercase().collect();
            upper + chars.as_str()
        }
    }
}

fn stop_words() -> HashSet<&'static str> {
    [
        "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one",
        "our", "out", "has", "his", "how", "its", "may", "new", "now", "old", "see", "way", "who",
        "did", "get", "let", "say", "she", "too", "use", "that", "with", "have", "this", "will",
        "your", "from", "they", "been", "call", "come", "each", "make", "like", "long", "look",
        "many", "over", "such", "take", "than", "them", "very", "when", "what", "about", "could",
        "other", "their", "there", "these", "think", "which", "would", "into", "just", "also",
        "more", "some", "then", "most", "only", "need", "note", "notes", "todo", "it's", "don't",
        "i'll", "i've", "we're", "they're", "doesn't", "didn't", "won't", "really", "going",
        "things", "thing", "still", "much", "well", "back",
    ]
    .into_iter()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_k_returns_reasonable_values() {
        assert_eq!(choose_k(5), 3);
        assert_eq!(choose_k(27), 3);
        assert_eq!(choose_k(75), 5);
        assert_eq!(choose_k(192), 8);
        assert_eq!(choose_k(500), 8);
    }

    #[test]
    fn cluster_notes_handles_empty_input() {
        let result = cluster_notes(&[], &HashMap::new(), &HashMap::new(), None, 3);
        assert_eq!(result.k, 0);
        assert!(result.assignments.is_empty());
    }

    #[test]
    fn cluster_notes_handles_few_notes() {
        let embeddings = vec![
            ("a.md".to_string(), vec![1.0, 0.0]),
            ("b.md".to_string(), vec![0.0, 1.0]),
        ];
        let titles = HashMap::new();
        let snippets = HashMap::new();
        let result = cluster_notes(&embeddings, &titles, &snippets, None, 3);
        assert_eq!(result.k, 1);
        assert_eq!(result.assignments.len(), 2);
        assert_eq!(result.color_groups, vec![0]);
    }

    #[test]
    fn extract_ngrams_produces_unigrams_and_bigrams() {
        let stops = stop_words();
        let mut out = Vec::new();
        extract_ngrams("grocery list items weekly", &stops, &mut out);
        assert!(out.contains(&"grocery".to_string()));
        assert!(out.contains(&"list".to_string()));
        assert!(out.contains(&"items".to_string()));
        assert!(out.contains(&"weekly".to_string()));
        assert!(out.contains(&"grocery list".to_string()));
        assert!(out.contains(&"list items".to_string()));
    }

    #[test]
    fn tfidf_fallback_produces_label() {
        let mut titles = HashMap::new();
        titles.insert("a.md".to_string(), "Grocery List".to_string());
        titles.insert("b.md".to_string(), "Grocery Shopping".to_string());
        titles.insert("c.md".to_string(), "Weekly Grocery Run".to_string());
        let snippets = HashMap::new();
        let paths = vec!["a.md", "b.md", "c.md"];
        let label = tfidf_label(paths.into_iter(), &titles, &snippets);
        assert!(label.to_lowercase().contains("grocery"));
    }

    #[test]
    fn split_oversized_clusters_caps_cluster_sizes() {
        let embeddings = (0..40)
            .map(|index| (format!("{index}.md"), vec![1.0, 0.0, 0.0]))
            .collect::<Vec<_>>();
        let assignments = split_oversized_clusters(&embeddings, vec![0; embeddings.len()]);
        let clusters = build_cluster_members(&assignments);

        assert!(clusters.len() > 1);
        assert!(clusters
            .iter()
            .all(|cluster| cluster.len() <= MAX_CLUSTER_NOTES));
    }

    #[test]
    fn split_oversized_clusters_limits_blobs_to_seven_notes() {
        let embeddings = (0..8)
            .map(|index| (format!("{index}.md"), vec![1.0, 0.0, 0.0]))
            .collect::<Vec<_>>();
        let assignments = split_oversized_clusters(&embeddings, vec![0; embeddings.len()]);
        let clusters = build_cluster_members(&assignments);

        assert!(clusters.len() > 1);
        assert!(clusters.iter().all(|cluster| cluster.len() <= 7));
    }

    #[test]
    fn fallback_partition_spreads_members_evenly() {
        let members = vec![0, 1, 2, 3, 4, 5, 6];
        let partitions = fallback_partition(&members, 3);
        let sizes = partitions.iter().map(Vec::len).collect::<Vec<_>>();

        assert_eq!(partitions.len(), 3);
        assert_eq!(sizes, vec![3, 2, 2]);
    }

    #[test]
    fn assign_color_groups_clamps_requested_count() {
        let centroids = vec![vec![1.0, 0.0], vec![0.0, 1.0], vec![-1.0, 0.0]];
        let groups = assign_color_groups(&centroids, 5);

        assert_eq!(groups.len(), centroids.len());
        assert!(groups.iter().all(|group| *group < centroids.len()));
    }
}
