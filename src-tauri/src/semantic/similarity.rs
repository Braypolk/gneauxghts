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

/// Retrieval is scale invariant for every nonzero finite vector. Invalid or
/// absent direction contributes no similarity, never NaN to ranking/thresholds.
pub(crate) fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    cosine_with_norm_floor(left, right, 0.0)
}

/// Atlas treats near-zero vectors/centroids as directionless. Preserve its
/// historical squared-norm epsilon floor independently of retrieval policy.
pub(crate) fn atlas_cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    cosine_with_norm_floor(left, right, f64::from(f32::EPSILON))
}

fn cosine_with_norm_floor(left: &[f32], right: &[f32], min_squared_norm: f64) -> f32 {
    if left.is_empty() || left.len() != right.len() {
        return 0.0;
    }
    // Every finite f32 product fits f64, including subnormal and maximum inputs.
    // This avoids f32 underflow/overflow manufacturing zero norms or NaN scores.
    let mut dot = 0.0_f64;
    let mut left_norm = 0.0_f64;
    let mut right_norm = 0.0_f64;
    for (&left_value, &right_value) in left.iter().zip(right) {
        if !left_value.is_finite() || !right_value.is_finite() {
            return 0.0;
        }
        let (left_value, right_value) = (f64::from(left_value), f64::from(right_value));
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }
    if left_norm <= min_squared_norm || right_norm <= min_squared_norm {
        return 0.0;
    }
    (dot / (left_norm.sqrt() * right_norm.sqrt())).clamp(-1.0, 1.0) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retrieval_cosine_is_scale_invariant_and_rejects_invalid_directions() {
        for (left, right, expected) in [
            (vec![], vec![], 0.0),
            (vec![1.0], vec![1.0, 0.0], 0.0),
            (vec![0.0, 0.0], vec![1.0, 0.0], 0.0),
            (vec![3.0, 4.0], vec![3.0, 4.0], 1.0),
            (vec![3.0, 4.0], vec![-3.0, -4.0], -1.0),
            (vec![1.0, 0.0], vec![0.0, 1.0], 0.0),
            (vec![1.0e-4], vec![1.0e-4], 1.0),
            (vec![f32::from_bits(1)], vec![f32::from_bits(1)], 1.0),
            (vec![f32::MAX, f32::MAX], vec![f32::MAX, f32::MAX], 1.0),
            (vec![f32::NAN], vec![1.0], 0.0),
            (vec![1.0], vec![f32::INFINITY], 0.0),
            (vec![f32::NEG_INFINITY], vec![1.0], 0.0),
        ] {
            let score = cosine_similarity(&left, &right);
            assert!(score.is_finite() && (-1.0..=1.0).contains(&score));
            assert_eq!(score, expected, "retrieval {left:?} / {right:?}");
            assert_eq!(cosine_similarity(&right, &left), score);
        }
    }

    #[test]
    fn atlas_cosine_preserves_near_zero_centroid_policy_and_finite_geometry() {
        for (left, right, expected) in [
            (vec![], vec![], 0.0),
            (vec![1.0], vec![1.0, 0.0], 0.0),
            (vec![0.0], vec![1.0], 0.0),
            (vec![1.0e-4], vec![1.0e-4], 0.0),
            (vec![f32::from_bits(1)], vec![1.0], 0.0),
            (vec![1.0e-3], vec![1.0e-3], 1.0),
            (vec![3.0, 4.0], vec![3.0, 4.0], 1.0),
            (vec![3.0, 4.0], vec![-3.0, -4.0], -1.0),
            (vec![1.0, 0.0], vec![0.0, 1.0], 0.0),
            (vec![f32::MAX], vec![f32::MAX], 1.0),
            (vec![f32::NAN], vec![1.0], 0.0),
            (vec![1.0], vec![f32::INFINITY], 0.0),
            (vec![f32::NEG_INFINITY], vec![1.0], 0.0),
        ] {
            let score = atlas_cosine_similarity(&left, &right);
            assert!(score.is_finite() && (-1.0..=1.0).contains(&score));
            assert_eq!(score, expected, "Atlas {left:?} / {right:?}");
            assert_eq!(atlas_cosine_similarity(&right, &left), score);
        }
    }
}
