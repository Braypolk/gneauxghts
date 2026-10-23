//! Share the last pure text-query preparation across independently admitted
//! text/image ranking. This contains no source content, scope, or ranked results.
use super::embed::{EmbeddingInputKind, EmbeddingProvider};
use std::sync::Mutex;

struct PreparedQuery {
    model: String,
    text: String,
    vector: Vec<f32>,
}

#[derive(Default)]
pub(super) struct QueryEmbedding {
    // The provider already serializes inference. Holding this lock through its
    // call also coalesces concurrent consumers of the same exact input. Keep one
    // success only, replaced by the next query/model rather than a guessed TTL.
    last: Mutex<Option<PreparedQuery>>,
}

impl QueryEmbedding {
    pub(super) fn prepare(
        &self,
        provider: &(dyn EmbeddingProvider + Send + Sync),
        text: &str,
    ) -> Result<Vec<f32>, String> {
        let mut last = self
            .last
            .lock()
            .map_err(|_| "Query preparation unavailable")?;
        let model = provider.model_info().fingerprint();
        if let Some(prepared) = last.as_ref().filter(|p| p.model == model && p.text == text) {
            return Ok(prepared.vector.clone());
        }
        let vector = provider
            .embed_texts(&[text.to_string()], EmbeddingInputKind::Query)?
            .into_iter()
            .next()
            .ok_or("No query embedding.")?;
        if provider.model_info().fingerprint() != model {
            return Err("Search model changed. Search again.".into());
        }
        *last = Some(PreparedQuery {
            model,
            text: text.into(),
            vector: vector.clone(),
        });
        Ok(vector)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::embed::ModelInfo;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    struct Provider {
        calls: AtomicUsize,
        model: Mutex<String>,
        fail: Mutex<bool>,
    }
    impl EmbeddingProvider for Provider {
        fn embed_texts(
            &self,
            _: &[String],
            _: EmbeddingInputKind,
        ) -> Result<Vec<Vec<f32>>, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if *self.fail.lock().unwrap() {
                return Err("not ready".into());
            }
            Ok(vec![vec![1.0, 0.0]])
        }
        fn prepare(&self) -> Result<(), String> {
            Ok(())
        }
        fn model_info(&self) -> ModelInfo {
            ModelInfo {
                id: self.model.lock().unwrap().clone(),
                label: "Test".into(),
                dimensions: 2,
                runtime_binary_path: None,
                runtime_bundled: false,
                model_path: None,
                model_repo_id: "test".into(),
                available: true,
                loading: false,
                ready: true,
                status: "ready".into(),
                error: None,
            }
        }
        fn shutdown(&self) {}
    }
    #[test]
    fn last_query_is_exact_bounded_model_specific_and_never_caches_errors() {
        let provider = Provider {
            calls: AtomicUsize::new(0),
            model: Mutex::new("one".into()),
            fail: Mutex::new(false),
        };
        let query = QueryEmbedding::default();
        query.prepare(&provider, "café").unwrap();
        query.prepare(&provider, "café").unwrap();
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        query.prepare(&provider, "café ").unwrap();
        query.prepare(&provider, "café").unwrap();
        assert_eq!(provider.calls.load(Ordering::SeqCst), 3);
        *provider.model.lock().unwrap() = "two".into();
        query.prepare(&provider, "café").unwrap();
        assert_eq!(provider.calls.load(Ordering::SeqCst), 4);
        *provider.fail.lock().unwrap() = true;
        assert!(query.prepare(&provider, "retry").is_err());
        *provider.fail.lock().unwrap() = false;
        query.prepare(&provider, "retry").unwrap();
        assert_eq!(provider.calls.load(Ordering::SeqCst), 6);
    }
    #[test]
    fn concurrent_consumers_share_one_preparation() {
        let provider = Arc::new(Provider {
            calls: AtomicUsize::new(0),
            model: Mutex::new("one".into()),
            fail: Mutex::new(false),
        });
        let query = QueryEmbedding::default();
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let provider = &provider;
                let query = &query;
                scope.spawn(move || {
                    query.prepare(provider.as_ref(), "same input").unwrap();
                });
            }
        });
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    }
}
