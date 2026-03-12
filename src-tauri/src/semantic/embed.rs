use blake3::hash;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelInfo {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) dimensions: usize,
    pub(crate) local_only: bool,
    pub(crate) auto_download_supported: bool,
}

pub(crate) trait EmbeddingProvider {
    fn embed_texts(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
    fn model_info(&self) -> ModelInfo;
}

pub(crate) struct LocalHashEmbeddingProvider {
    dimensions: usize,
}

impl LocalHashEmbeddingProvider {
    pub(crate) fn new(dimensions: usize) -> Self {
        Self { dimensions }
    }
}

impl EmbeddingProvider for LocalHashEmbeddingProvider {
    fn embed_texts(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        Ok(texts
            .iter()
            .map(|text| embed_text(text, self.dimensions))
            .collect())
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            id: "local-hash-v1".to_string(),
            label: "Local Hash Embeddings v1".to_string(),
            dimensions: self.dimensions,
            local_only: true,
            auto_download_supported: false,
        }
    }
}

pub(crate) fn mean_pool(vectors: &[Vec<f32>]) -> Vec<f32> {
    if vectors.is_empty() {
        return Vec::new();
    }

    let dimensions = vectors[0].len();
    let mut pooled = vec![0.0; dimensions];
    for vector in vectors {
        if vector.len() != dimensions {
            continue;
        }

        for (index, value) in vector.iter().enumerate() {
            pooled[index] += value;
        }
    }

    let count = vectors.len() as f32;
    for value in &mut pooled {
        *value /= count.max(1.0);
    }

    normalize_vector(&mut pooled);
    pooled
}

fn embed_text(text: &str, dimensions: usize) -> Vec<f32> {
    let normalized = normalize_text(text);
    let tokens = normalized
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut vector = vec![0.0; dimensions];

    for token in &tokens {
        add_feature(&mut vector, &format!("u:{token}"), 1.0);

        for trigram in char_ngrams(token, 3) {
            add_feature(&mut vector, &format!("c:{trigram}"), 0.35);
        }
    }

    for window in tokens.windows(2) {
        add_feature(
            &mut vector,
            &format!("b:{} {}", window[0], window[1]),
            1.25,
        );
    }

    if tokens.is_empty() {
        add_feature(&mut vector, "empty", 1.0);
    }

    normalize_vector(&mut vector);
    vector
}

fn add_feature(vector: &mut [f32], feature: &str, weight: f32) {
    if vector.is_empty() {
        return;
    }

    let digest = hash(feature.as_bytes());
    let bytes = digest.as_bytes();
    let dimension = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize
        % vector.len();
    let sign = if bytes[4] & 1 == 0 { 1.0 } else { -1.0 };
    vector[dimension] += weight * sign;
}

fn char_ngrams(token: &str, width: usize) -> Vec<String> {
    let chars = token.chars().collect::<Vec<_>>();
    if chars.len() <= width {
        return vec![token.to_string()];
    }

    chars
        .windows(width)
        .map(|window| window.iter().collect::<String>())
        .collect()
}

fn normalize_text(text: &str) -> String {
    let mut normalized = String::with_capacity(text.len());
    let mut last_was_space = false;

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            normalized.extend(ch.to_lowercase());
            last_was_space = false;
            continue;
        }

        if !last_was_space {
            normalized.push(' ');
            last_was_space = true;
        }
    }

    normalized.trim().to_string()
}

fn normalize_vector(vector: &mut [f32]) {
    let magnitude = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if magnitude == 0.0 {
        return;
    }

    for value in vector {
        *value /= magnitude;
    }
}
