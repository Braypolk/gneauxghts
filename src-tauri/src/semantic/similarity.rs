/// Floor for live semantic retrieval (chunk ANN queries and note-ANN neighbors
/// shown in Related / hybrid search).
///
/// Why 0.18 rather than something tighter like edge linking (`0.42`):
/// - Edge rebuilds persist durable note↔note links, so they use a higher bar.
/// - Live retrieval asks "is this candidate even vaguely on-topic?" after ANN
///   already ranked it; a low floor mainly drops near-orthogonal noise.
/// - With Jina cosine embeddings, unrelated text tends to sit near ~0 while
///   weakly related passages often land in the 0.2–0.4 band. 0.18 keeps those
///   weak-but-real matches instead of returning an empty panel.
/// - Raising it much higher (e.g. 0.35+) tends to hide useful neighbors for
///   short/draft queries; lowering it much further mostly adds junk.
pub(crate) const MIN_SEMANTIC_MATCH_SCORE: f32 = 0.18;

pub(crate) fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.is_empty() || right.is_empty() || left.len() != right.len() {
        return 0.0;
    }

    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;

    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }

    if left_norm == 0.0 || right_norm == 0.0 {
        return 0.0;
    }

    dot / (left_norm.sqrt() * right_norm.sqrt())
}
