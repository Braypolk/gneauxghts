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
