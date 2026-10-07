//! Embedding seam. LiteRT and retained Jina providers own their prompts and lifecycle.
use serde::Serialize;

pub(crate) const EMBEDDING_BATCH_SIZE: usize = 128;
#[cfg(test)]
pub(crate) use super::legacy_jina::JinaLlamaEmbeddingProvider;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelInfo {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) dimensions: usize,
    pub(crate) runtime_binary_path: Option<String>,
    pub(crate) model_path: Option<String>,
    pub(crate) model_repo_id: String,
    pub(crate) available: bool,
    pub(crate) loading: bool,
    pub(crate) ready: bool,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
}

impl ModelInfo {
    /// Stable identity for persisted embeddings. It intentionally excludes
    /// runtime status and absolute paths, while including the exact configured
    /// model artifact identity and output shape.
    pub(crate) fn fingerprint(&self) -> String {
        let identity = format!("{}\0{}\0{}", self.id, self.model_repo_id, self.dimensions);
        blake3::hash(identity.as_bytes()).to_hex().to_string()
    }
}

#[derive(Clone, Copy)]
pub(crate) enum EmbeddingInputKind {
    Document,
    Query,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticModelDownloadResult {
    pub(crate) already_present: bool,
    pub(crate) path: String,
}

pub(crate) trait EmbeddingProvider {
    fn minimum_edge_score(&self) -> f32 {
        0.42
    }
    fn minimum_text_score(&self) -> f32 {
        super::similarity::LEGACY_JINA_MIN_MATCH_SCORE
    }
    fn minimum_image_score(&self, image_query: bool) -> f32 {
        if image_query {
            0.80
        } else {
            0.70
        }
    }
    fn minimum_image_to_text_score(&self) -> f32 {
        0.75
    }
    fn image_capability(&self) -> &'static str {
        if self.image_representation().is_some() {
            "available"
        } else {
            "unsupported"
        }
    }
    fn image_representation(&self) -> Option<String> {
        None
    }
    fn embed_image(&self, _bytes: &[u8]) -> Result<Vec<f32>, String> {
        Err("This embedding provider does not support images.".into())
    }
    fn embed_image_query(&self, bytes: &[u8], text: Option<&str>) -> Result<Vec<f32>, String> {
        if text.is_some_and(|text| !text.trim().is_empty()) {
            return Err("This provider does not support image and text together.".into());
        }
        self.embed_image(bytes)
    }
    fn embed_texts(
        &self,
        texts: &[String],
        kind: EmbeddingInputKind,
    ) -> Result<Vec<Vec<f32>>, String>;
    fn prepare(&self) -> Result<(), String>;
    fn model_info(&self) -> ModelInfo;
    fn shutdown(&self);
    fn download_model_if_needed(&self) -> Result<SemanticModelDownloadResult, String> {
        Err("Embedding model download is not supported.".to_string())
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

pub(super) fn normalize_vector(vector: &mut [f32]) {
    let magnitude = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if magnitude == 0.0 {
        return;
    }

    for value in vector {
        *value /= magnitude;
    }
}
