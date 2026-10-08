//! One serialized, device-local Gemma engine. Setup alone downloads artifacts.
use super::{
    debug::SemanticDebugState,
    embed::{
        EmbeddingInputKind, EmbeddingProvider, ModelInfo, SemanticModelDownloadResult,
        SemanticSetupProgress, SetupPhase,
    },
    litert_ffi::Engine,
    litert_install::{self, Installer, MODEL_FILE, MODEL_REPO, MODEL_REV, MODEL_SHA},
    SemanticSettings,
};
use reqwest::blocking::Client;
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub(super) const TEXT_REPRESENTATION: &str = "embeddinggemma2-litert018-qat-768-average-v2";

// Platform namespaces prevent a portable vault from silently importing vectors
// from an unvalidated device backend pair.
pub(super) fn text_namespace() -> String {
    format!(
        "{TEXT_REPRESENTATION}-{}-{}-{}",
        &MODEL_SHA[..16],
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

pub(crate) struct GemmaLiteRtEmbeddingProvider {
    model_dir: PathBuf,
    installer: Installer,
    settings: Arc<Mutex<SemanticSettings>>,
    runtime: Mutex<Runtime>,
    setup: Mutex<()>,
    setup_progress: Mutex<Option<SemanticSetupProgress>>,
    debug: Arc<SemanticDebugState>,
    vision_disabled: AtomicBool,
}
#[derive(Default)]
struct Runtime {
    engine: Option<Engine>,
    tokens: u16,
    backend: Option<&'static str>,
    verified: bool,
    error: Option<String>,
}

impl GemmaLiteRtEmbeddingProvider {
    pub(crate) fn new(
        app_data: PathBuf,
        settings: Arc<Mutex<SemanticSettings>>,
        debug: Arc<SemanticDebugState>,
    ) -> Self {
        Self {
            model_dir: app_data.join("semantic/models"),
            installer: Installer::new(&app_data),
            settings,
            runtime: Mutex::new(Runtime::default()),
            setup: Mutex::new(()),
            setup_progress: Mutex::new(None),
            debug,
            vision_disabled: AtomicBool::new(false),
        }
    }
    pub(crate) fn supported() -> bool {
        Installer::supported()
    }
    fn model_path(&self) -> PathBuf {
        self.model_dir.join(MODEL_FILE)
    }
    fn available(&self) -> bool {
        self.model_path()
            .metadata()
            .is_ok_and(|m| m.len() == litert_install::MODEL_BYTES)
            && self.installer.library().is_some()
    }
    fn tokens(&self) -> Result<u16, String> {
        self.settings
            .lock()
            .map(|s| s.image_tokens)
            .map_err(|_| "Semantic settings lock poisoned".into())
    }
    fn report_setup(&self, file_index: u8, phase: SetupPhase, bytes: u64, total: Option<u64>) {
        if let Ok(mut progress) = self.setup_progress.lock() {
            *progress = Some(SemanticSetupProgress {
                phase,
                failed_phase: None,
                file_label: if file_index == 1 {
                    "LiteRT 0.18.0 search runtime"
                } else {
                    "EmbeddingGemma 2 text and image model"
                }
                .into(),
                file_name: if file_index == 1 {
                    Installer::package_name()
                } else {
                    MODEL_FILE.into()
                },
                file_index,
                file_count: 2,
                downloaded_bytes: bytes,
                total_bytes: total,
                error: None,
            });
        }
    }

    fn install_search_files(&self) -> Result<SemanticModelDownloadResult, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(7200))
            .build()
            .map_err(|e| e.to_string())?;
        // Release the engine before replacing damaged files (including on Windows).
        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "Gemma runtime lock poisoned")?;
            runtime.engine.take();
            runtime.backend = None;
            runtime.verified = false;
            self.vision_disabled.store(false, Ordering::Release);
        }
        self.report_setup(1, SetupPhase::Checking, 0, None);
        let runtime_present = self.installer.verified_library().is_ok();
        self.installer
            .install(&client, &mut |phase, bytes, total| {
                self.report_setup(1, phase, bytes, total);
            })?;
        self.report_setup(
            2,
            SetupPhase::Checking,
            0,
            Some(litert_install::MODEL_BYTES),
        );
        let model_present = litert_install::matches_checksum(&self.model_path(), MODEL_SHA)?;
        let already_present = model_present && runtime_present;
        if !model_present {
            fs::create_dir_all(&self.model_dir).map_err(|e| e.to_string())?;
            let partial = self.model_dir.join(format!("{MODEL_FILE}.partial"));
            self.report_setup(
                2,
                SetupPhase::Downloading,
                0,
                Some(litert_install::MODEL_BYTES),
            );
            let response = client
                .get(format!(
                    "https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REV}/{MODEL_FILE}"
                ))
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| e.to_string())?;
            litert_install::save_verified_with_progress(
                response,
                &partial,
                MODEL_SHA,
                400 * 1024 * 1024,
                Some(litert_install::MODEL_BYTES),
                &mut |phase, bytes, total| {
                    self.report_setup(2, phase, bytes, total);
                },
            )?;
            self.report_setup(
                2,
                SetupPhase::Installing,
                litert_install::MODEL_BYTES,
                Some(litert_install::MODEL_BYTES),
            );
            if self.model_path().exists() {
                fs::remove_file(self.model_path()).map_err(|e| e.to_string())?;
            }
            fs::rename(&partial, self.model_path()).map_err(|e| e.to_string())?;
        }
        self.report_setup(2, SetupPhase::Starting, 0, None);
        self.prepare()?;
        self.report_setup(2, SetupPhase::Complete, 0, None);
        Ok(SemanticModelDownloadResult {
            already_present,
            path: self.model_path().to_string_lossy().into_owned(),
        })
    }
    fn ensure_engine(&self, runtime: &mut Runtime, tokens: u16) -> Result<(), String> {
        if runtime.engine.is_some() && runtime.tokens == tokens {
            return Ok(());
        }
        if !self.available() {
            return Err(
                "Gemma search needs setup. Open Settings → Search and choose Set up local search."
                    .into(),
            );
        }
        let model = self.model_path();
        if !runtime.verified {
            if !litert_install::matches_checksum(&model, MODEL_SHA)? {
                return Err("Gemma model failed checksum verification; run setup again.".into());
            }
            let library = self.installer.verified_library()?;
            super::litert_ffi::verify_library(&library)?;
            runtime.verified = true;
        }
        let library = self
            .installer
            .library()
            .ok_or("LiteRT runtime is not installed.")?;
        // Release the old engine before allocating a replacement. Cache folders
        // include the budget; native compiled signatures are never mixed.
        runtime.engine.take();
        runtime.backend = None;
        let cache = self.model_dir.join(format!("litert-cache-{tokens}"));
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let started = Instant::now();
        let vision = cfg!(all(target_os = "macos", target_arch = "aarch64"))
            && !self.vision_disabled.load(Ordering::Acquire);
        let (engine, backend, degraded) = initialize_modalities(vision, |backend, vision| {
            Engine::new_with_vision(&library, &model, &cache, backend, tokens, vision)
        })?;
        self.vision_disabled.store(degraded, Ordering::Release);
        runtime.engine = Some(engine);
        runtime.backend = Some(backend);
        runtime.tokens = tokens;
        runtime.error = None;
        self.debug.record_timing(
            "runtime",
            "litert_ready",
            Some(format!("backend={backend} image_tokens={tokens}")),
            started.elapsed().as_millis() as u64,
            |m| {
                m.runtime_spawn_count += 1;
                m.runtime_ready_count += 1;
            },
        );
        Ok(())
    }
    fn embed_input(
        &self,
        bytes: &[u8],
        image: bool,
        text: Option<&str>,
    ) -> Result<Vec<f32>, String> {
        if bytes.is_empty()
            || bytes.len()
                > if image {
                    64 * 1024 * 1024
                } else {
                    4 * 1024 * 1024
                }
        {
            return Err("Embedding input is empty or exceeds its size limit.".into());
        }
        if text.is_some_and(|text| text.len() > 4096) {
            return Err("Image search refinement must be at most 4 KiB of text.".into());
        }
        let tokens = self.tokens()?;
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Gemma runtime lock poisoned")?;
        let result = self.ensure_engine(&mut runtime, tokens).and_then(|()| {
            if image && self.vision_disabled.load(Ordering::Acquire) {
                return Err("Vision could not initialize; text search remains available.".into());
            }
            runtime
                .engine
                .as_mut()
                .ok_or("Gemma engine unavailable")?
                .embed_with_text(bytes, image, tokens, text)
        });
        if let Err(error) = &result {
            runtime.error = Some(error.clone());
        }
        result
    }
}

/// Called only after artifact/cache admission. A failed GPU engine has already
/// released its settings/library before the CPU attempt. Input failures never
/// enter this function and cannot trigger a backend change.
fn initialize_with_fallback<T>(
    mut create: impl FnMut(&'static str) -> Result<T, String>,
) -> Result<(T, &'static str), String> {
    match create("gpu") {
        Ok(engine) => Ok((engine, "gpu")),
        Err(gpu) => create("cpu")
            .map(|engine| (engine, "cpu"))
            .map_err(|cpu| format!("Gemma could not start on GPU ({gpu}) or CPU ({cpu}).")),
    }
}

impl EmbeddingProvider for GemmaLiteRtEmbeddingProvider {
    fn minimum_edge_score(&self) -> f32 {
        0.75
    }
    fn minimum_text_score(&self) -> f32 {
        0.70
    }

    fn prepare(&self) -> Result<(), String> {
        let tokens = self.tokens()?;
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Gemma runtime lock poisoned")?;
        if self.vision_disabled.swap(false, Ordering::AcqRel)
            && cfg!(all(target_os = "macos", target_arch = "aarch64"))
        {
            runtime.engine.take();
            runtime.backend = None;
        }
        let result = self.ensure_engine(&mut runtime, tokens);
        if let Err(error) = &result {
            runtime.error = Some(error.clone());
        }
        result
    }
    fn embed_texts(
        &self,
        texts: &[String],
        kind: EmbeddingInputKind,
    ) -> Result<Vec<Vec<f32>>, String> {
        let start = Instant::now();
        let prefix = match kind {
            EmbeddingInputKind::Query => "task: search result | query: ",
            EmbeddingInputKind::Document => "title: none | text: ",
        };
        let result = texts
            .iter()
            .map(|text| self.embed_input(format!("{prefix}{text}").as_bytes(), false, None))
            .collect::<Result<Vec<_>, _>>();
        self.debug.record_timing(
            "embedding",
            "litert_texts",
            None,
            start.elapsed().as_millis() as u64,
            |m| {
                m.embedding_duration_total_millis += start.elapsed().as_millis() as u64;
                m.embedding_duration_max_millis = m
                    .embedding_duration_max_millis
                    .max(start.elapsed().as_millis() as u64);
                m.embedding_request_count += 1;
                m.embedding_text_count_total += texts.len() as u64;
                m.embedding_char_count_total +=
                    texts.iter().map(|t| t.chars().count() as u64).sum::<u64>();
                if result.is_err() {
                    m.embedding_request_failure_count += 1;
                }
            },
        );
        result
    }
    fn embed_image_query(&self, bytes: &[u8], text: Option<&str>) -> Result<Vec<f32>, String> {
        let text = text.map(str::trim).filter(|text| !text.is_empty());
        if self.image_representation().is_none() {
            return Err("Image search is unavailable; text search remains available.".into());
        }
        if text.is_some_and(|text| text.len() > 4096) {
            return Err("Image search refinement must be at most 4 KiB of text.".into());
        }
        let prepared = super::image_input::prepare(bytes)?;
        // Joint multimodal input carries plain context, not text-only task prompts.
        self.embed_input(&prepared, true, text)
    }
    fn embed_image(&self, bytes: &[u8]) -> Result<Vec<f32>, String> {
        self.embed_image_query(bytes, None)
    }

    fn image_capability(&self) -> &'static str {
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            "unsupported"
        } else if self.vision_disabled.load(Ordering::Acquire) {
            "failed"
        } else {
            "available"
        }
    }
    fn image_representation(&self) -> Option<String> {
        if self.vision_disabled.load(Ordering::Acquire) {
            return None;
        }
        // Vision parity/resource validation currently covers Apple Silicon.
        // Other packaged platforms expose text-only search until validated.
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            return None;
        }
        self.tokens().ok().map(|tokens| {
            format!(
                "{}-{MODEL_SHA}-{}-{tokens}",
                text_namespace(),
                super::image_input::POLICY
            )
        })
    }
    fn model_info(&self) -> ModelInfo {
        // Status commands may run on IPC threads. Never wait behind native
        // inference, checksum verification, or GPU compilation here.
        let (runtime, busy, poisoned) = match self.runtime.try_lock() {
            Ok(runtime) => (Some(runtime), false, false),
            Err(std::sync::TryLockError::WouldBlock) => (None, true, false),
            Err(std::sync::TryLockError::Poisoned(_)) => (None, false, true),
        };
        let backend = runtime.as_ref().and_then(|r| r.backend);
        ModelInfo {
            id: format!("{}-{MODEL_SHA}", text_namespace()),
            label: "EmbeddingGemma 2 · LiteRT · text + images".into(),
            dimensions: 768,
            runtime_binary_path: self
                .installer
                .library()
                .map(|p| p.to_string_lossy().into_owned()),
            model_path: self
                .model_path()
                .is_file()
                .then(|| self.model_path().to_string_lossy().into_owned()),
            model_repo_id: format!("{MODEL_REPO}@{MODEL_REV}"),
            available: self.available(),
            loading: busy,
            ready: runtime.as_ref().is_some_and(|r| r.engine.is_some()),
            status: backend
                .map(|b| {
                    format!(
                        "ready · {}{}",
                        b.to_uppercase(),
                        if self.vision_disabled.load(Ordering::Acquire) {
                            " · text only"
                        } else {
                            ""
                        }
                    )
                })
                .unwrap_or_else(|| {
                    if busy {
                        "Gemma is working".into()
                    } else {
                        "waiting for Gemma setup".into()
                    }
                }),
            error: if poisoned {
                Some("Gemma runtime lock poisoned".into())
            } else {
                runtime.as_ref().and_then(|r| r.error.clone())
            },
        }
    }
    fn shutdown(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.engine.take();
            runtime.backend = None;
        }
    }
    fn setup_progress(&self) -> Option<SemanticSetupProgress> {
        self.setup_progress.lock().ok().and_then(|p| p.clone())
    }
    fn download_model_if_needed(&self) -> Result<SemanticModelDownloadResult, String> {
        let _setup = self.setup.lock().map_err(|_| "Gemma setup lock poisoned")?;
        self.report_setup(1, SetupPhase::Checking, 0, None);
        let result = self.install_search_files();
        if let Err(error) = &result {
            if let Ok(mut progress) = self.setup_progress.lock() {
                if let Some(progress) = progress.as_mut() {
                    progress.failed_phase = Some(progress.phase);
                    progress.phase = SetupPhase::Failed;
                    progress.error = Some(error.clone());
                }
            }
        }
        result
    }
}

/// Input/artifact errors are checked before this engine-only downgrade path.
fn initialize_modalities<T>(
    vision: bool,
    mut create: impl FnMut(&str, bool) -> Result<T, String>,
) -> Result<(T, &'static str, bool), String> {
    match initialize_with_fallback(|backend| create(backend, vision)) {
        Ok((engine, backend)) => Ok((engine, backend, !vision)),
        Err(error) if vision => initialize_with_fallback(|backend| create(backend, false))
            .map(|(engine, backend)| (engine, backend, true))
            .map_err(|text_error| format!("{error}; text-only initialization: {text_error}")),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vision_initialization_failure_preserves_text_with_one_engine_at_a_time() {
        let mut attempts = Vec::new();
        let (engine, backend, degraded) = initialize_modalities(true, |backend, vision| {
            attempts.push((backend.to_string(), vision));
            if vision {
                Err("vision initialization failed".into())
            } else {
                Ok("text")
            }
        })
        .unwrap();
        assert_eq!(
            attempts,
            vec![
                ("gpu".into(), true),
                ("cpu".into(), true),
                ("gpu".into(), false)
            ]
        );
        assert_eq!((engine, backend, degraded), ("text", "gpu", true));
    }
    #[test]
    fn status_does_not_wait_for_native_work() {
        let temp = crate::test_support::TestDir::new("litert-status");
        let provider = GemmaLiteRtEmbeddingProvider::new(
            temp.path().to_path_buf(),
            Arc::new(Mutex::new(SemanticSettings::default())),
            Arc::new(SemanticDebugState::new()),
        );
        let _busy = provider.runtime.lock().unwrap();
        assert!(provider.model_info().loading);
        provider.report_setup(
            2,
            SetupPhase::Downloading,
            42,
            Some(litert_install::MODEL_BYTES),
        );
        let progress = provider.setup_progress().unwrap();
        assert_eq!(progress.downloaded_bytes, 42);
        let wire = serde_json::to_value(progress).unwrap();
        assert_eq!(wire["phase"], "downloading");
        assert_eq!(wire["fileName"], MODEL_FILE);
        assert_eq!(wire["downloadedBytes"], 42);
        assert_eq!(wire["totalBytes"], litert_install::MODEL_BYTES);
    }
    #[test]
    fn gpu_success_does_not_allocate_cpu_and_failure_falls_back_once() {
        let mut calls = Vec::new();
        let result = initialize_with_fallback(|backend| {
            calls.push(backend);
            Ok(())
        })
        .unwrap();
        assert_eq!(calls, ["gpu"]);
        assert_eq!(result.1, "gpu");
        calls.clear();
        let result = initialize_with_fallback(|backend| {
            calls.push(backend);
            if backend == "gpu" {
                Err("no GPU".into())
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(calls, ["gpu", "cpu"]);
        assert_eq!(result.1, "cpu");
    }
    /// Opt-in: uses only pinned artifacts supplied by the caller, never downloads.
    #[test]
    #[ignore = "requires local pinned LiteRT wheel/model and GPU access"]
    fn native_provider_and_cross_backend_retrieval() {
        use super::super::similarity::cosine_similarity;
        let fixture_root =
            PathBuf::from(std::env::var("GNEAUXGHTS_LITERT_FIXTURE").expect("fixture directory"));
        let temp = crate::test_support::TestDir::new("litert-native");
        let wheel = fixture_root.join("litert_lm_api-0.18.0-py3-none-macosx_12_0_arm64.whl");
        let library = litert_install::tests::install_fixture(temp.path(), &wheel);
        let model_dir = temp.path().join("semantic/models");
        fs::create_dir_all(&model_dir).unwrap();
        let model = model_dir.join(MODEL_FILE);
        fs::copy(fixture_root.join(MODEL_FILE), &model).unwrap();
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../scripts/fixtures/embedding-evaluation.json"
        ))
        .unwrap();
        let docs: Vec<String> = fixture["documents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| format!("title: none | text: {}", v.as_str().unwrap()))
            .collect();
        let queries: Vec<String> = fixture["queries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                format!(
                    "task: search result | query: {}",
                    v["text"].as_str().unwrap()
                )
            })
            .collect();
        let descriptions: Vec<String> = fixture["image_descriptions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| format!("task: search result | query: {}", v.as_str().unwrap()))
            .collect();
        let images: Vec<Vec<u8>> = ["rising", "falling", "circle", "square"]
            .iter()
            .map(|name| {
                super::super::image_input::prepare(
                    &fs::read(fixture_root.join(format!("{name}.png"))).unwrap(),
                )
                .unwrap()
            })
            .collect();
        let top = |query: &[f32], corpus: &[Vec<f32>]| {
            corpus
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| {
                    cosine_similarity(query, a).total_cmp(&cosine_similarity(query, b))
                })
                .unwrap()
                .0
        };
        for tokens in [70, 140] {
            let mut runs = Vec::new();
            // One engine at a time, including drop/reload of the native library.
            for backend in ["cpu", "gpu"] {
                let cache = temp.path().join(format!("{backend}-{tokens}"));
                fs::create_dir_all(&cache).unwrap();
                let mut engine = Engine::new(&library, &model, &cache, backend, tokens).unwrap();
                let mut vectors = Vec::new();
                for text in docs.iter().chain(queries.iter()).chain(descriptions.iter()) {
                    vectors.push(engine.embed(text.as_bytes(), false, tokens).unwrap());
                }
                for image in &images {
                    vectors.push(engine.embed(image, true, tokens).unwrap());
                }
                // Chunk-and-average must preserve long remembered text without a batch failure.
                let long = engine
                    .embed(
                        format!(
                            "title: none | text: {}",
                            "remembered packaging proof review ".repeat(1500)
                        )
                        .as_bytes(),
                        false,
                        tokens,
                    )
                    .unwrap();
                assert_eq!(long.len(), 768);
                runs.push(vectors);
            }
            let min_cosine = runs[0]
                .iter()
                .zip(&runs[1])
                .map(|(a, b)| cosine_similarity(a, b))
                .fold(1.0f32, f32::min);
            assert!(min_cosine >= 0.98, "{tokens} min cosine {min_cosine}");
            let mut agree = 0;
            let mut count = 0;
            let image_start = docs.len() + queries.len() + descriptions.len();
            for (own, other) in [(0, 1), (1, 0)] {
                for i in docs.len()..docs.len() + queries.len() {
                    count += 1;
                    agree += usize::from(
                        top(&runs[own][i], &runs[own][..docs.len()])
                            == top(&runs[own][i], &runs[other][..docs.len()]),
                    );
                }
                for i in docs.len() + queries.len()..image_start {
                    count += 1;
                    agree += usize::from(
                        top(&runs[own][i], &runs[own][image_start..])
                            == top(&runs[own][i], &runs[other][image_start..]),
                    );
                }
                for i in image_start..runs[own].len() {
                    count += 1;
                    agree += usize::from(
                        top(&runs[own][i], &runs[own][..docs.len()])
                            == top(&runs[own][i], &runs[other][..docs.len()]),
                    );
                    count += 1;
                    agree += usize::from(
                        top(&runs[own][i], &runs[own][image_start..])
                            == top(&runs[own][i], &runs[other][image_start..]),
                    );
                }
            }
            let agreement = agree as f32 / count as f32;
            println!("native {tokens}: cosine_min={min_cosine}, cross_index_top1={agree}/{count}");
            assert!(agreement >= 0.95);
        }
        let settings = Arc::new(Mutex::new(SemanticSettings::default()));
        let provider = GemmaLiteRtEmbeddingProvider::new(
            temp.path().to_path_buf(),
            settings.clone(),
            Arc::new(SemanticDebugState::new()),
        );
        provider.prepare().unwrap();
        assert_eq!(provider.model_info().status, "ready · GPU");
        let before = provider
            .embed_texts(&["a packaging proof".into()], EmbeddingInputKind::Query)
            .unwrap();
        let key = provider.image_representation().unwrap();
        settings.lock().unwrap().image_tokens = 140;
        let after = provider
            .embed_texts(&["a packaging proof".into()], EmbeddingInputKind::Query)
            .unwrap();
        assert!(cosine_similarity(&before[0], &after[0]) >= 0.98);
        assert_ne!(key, provider.image_representation().unwrap());
        assert_eq!(provider.embed_image(&images[0]).unwrap().len(), 768);
        provider.shutdown();
        assert!(!provider.model_info().ready);
    }
    #[test]
    #[ignore = "requires local pinned artifacts and native GPU access"]
    fn native_combined_image_query_probe() {
        use super::super::similarity::cosine_similarity;
        let root = PathBuf::from(std::env::var("GNEAUXGHTS_LITERT_FIXTURE").unwrap());
        let temp = crate::test_support::TestDir::new("gemma-combined-query");
        litert_install::tests::install_fixture(
            temp.path(),
            &root.join("litert_lm_api-0.18.0-py3-none-macosx_12_0_arm64.whl"),
        );
        let models = temp.path().join("semantic/models");
        fs::create_dir_all(&models).unwrap();
        fs::copy(root.join(MODEL_FILE), models.join(MODEL_FILE)).unwrap();
        let settings = Arc::new(Mutex::new(SemanticSettings::default()));
        let provider = GemmaLiteRtEmbeddingProvider::new(
            temp.path().to_path_buf(),
            settings.clone(),
            Arc::new(SemanticDebugState::new()),
        );
        let image = fs::read(root.join("visual-fixtures/privacy.png")).unwrap();
        let other = fs::read(root.join("visual-fixtures/network.png")).unwrap();
        for tokens in [70, 140] {
            settings.lock().unwrap().image_tokens = tokens;
            let indexed = [
                provider.embed_image(&image).unwrap(),
                provider.embed_image(&other).unwrap(),
            ];
            let plain = provider.embed_image_query(&image, None).unwrap();
            assert!(cosine_similarity(&plain, &indexed[0]) > 0.9999);
            let combined = provider
                .embed_image_query(
                    &image,
                    Some("Network Connection settings with proxy server and offline mode"),
                )
                .unwrap();
            assert_eq!(combined.len(), 768);
            assert!(
                cosine_similarity(&plain, &combined) < 0.9999,
                "text must affect the joint query"
            );
            assert!(
                cosine_similarity(&combined, &indexed[1])
                    > cosine_similarity(&combined, &indexed[0]),
                "network refinement should select the network screenshot"
            );
            let scores = |query: &[f32]| {
                indexed
                    .iter()
                    .map(|v| cosine_similarity(query, v))
                    .collect::<Vec<_>>()
            };
            println!(
                "COMBINED_QUERY {}",
                serde_json::json!({"tokens":tokens,"backend":provider.model_info().status,"image_only_scores":scores(&plain),"combined_scores":scores(&combined),"candidates":["privacy","network"]})
            );
            assert!(provider
                .embed_image_query(&image, Some(&"x".repeat(4097)))
                .is_err());
        }
        provider.shutdown();
    }

    #[test]
    #[ignore = "requires local pinned artifacts and generated visual fixtures"]
    fn native_visual_quality_probe() {
        use super::super::similarity::cosine_similarity;
        let root = PathBuf::from(std::env::var("GNEAUXGHTS_LITERT_FIXTURE").unwrap());
        let temp = crate::test_support::TestDir::new("gemma-visual-quality");
        let wheel = root.join("litert_lm_api-0.18.0-py3-none-macosx_12_0_arm64.whl");
        let library = litert_install::tests::install_fixture(temp.path(), &wheel);
        let cases = [
            ("privacy", "An application settings screenshot with Privacy and Sharing, public sharing and allow analytics toggles."),
            ("network", "An application settings screenshot with Network Connection, proxy server and offline mode."),
            ("search-diagram", "A Search Architecture diagram linking Database to Cache to Search Index to retrieve indexed note passages."),
            ("upload-diagram", "An Upload Pipeline diagram linking Upload to Virus Scan to File Storage."),
            ("revenue-growth", "A quarterly revenue line chart with revenue increasing from Q1 to Q4."),
            ("revenue-decline", "A quarterly revenue line chart with revenue decreasing from Q1 to Q4."),
            ("receipt-148", "A Corner Shop receipt with TOTAL $148.20, order number 148."),
            ("receipt-418", "A Corner Shop receipt with TOTAL $418.20, order number 418."),
        ];
        let mut reports = Vec::new();
        for tokens in [70, 140] {
            let cache = temp.path().join(format!("gpu-{tokens}"));
            fs::create_dir_all(&cache).unwrap();
            let mut engine =
                Engine::new(&library, &root.join(MODEL_FILE), &cache, "gpu", tokens).unwrap();
            let mut docs = Vec::new();
            let mut queries = Vec::new();
            let mut images = Vec::new();
            let mut variants = Vec::new();
            for (name, caption) in cases {
                docs.push(
                    engine
                        .embed(
                            format!("title: none | text: {caption}").as_bytes(),
                            false,
                            tokens,
                        )
                        .unwrap(),
                );
                queries.push(
                    engine
                        .embed(
                            format!("task: search result | query: {caption}").as_bytes(),
                            false,
                            tokens,
                        )
                        .unwrap(),
                );
                for (suffix, target) in [("", &mut images), ("-query", &mut variants)] {
                    let bytes =
                        fs::read(root.join(format!("visual-fixtures/{name}{suffix}.png"))).unwrap();
                    let prepared = super::super::image_input::prepare(&bytes).unwrap();
                    target.push(engine.embed(&prepared, true, tokens).unwrap());
                }
            }
            let matrix = |queries: &[Vec<f32>], corpus: &[Vec<f32>]| {
                queries
                    .iter()
                    .map(|q| {
                        corpus
                            .iter()
                            .map(|v| cosine_similarity(q, v))
                            .collect::<Vec<_>>()
                    })
                    .collect::<Vec<_>>()
            };
            let text_image = matrix(&queries, &images);
            let image_text = matrix(&images, &docs);
            let image_image = matrix(&variants, &images);
            let top1 = |m: &[Vec<f32>]| {
                m.iter()
                    .enumerate()
                    .filter(|(i, row)| {
                        row.iter()
                            .enumerate()
                            .max_by(|a, b| a.1.total_cmp(b.1))
                            .unwrap()
                            .0
                            == *i
                    })
                    .count()
            };
            let admit = |m: &[Vec<f32>], floor: f32| serde_json::json!({"positive_admitted":m.iter().enumerate().filter(|(i,row)| row[*i]>=floor).count(),"hard_negative_admitted":m.iter().enumerate().map(|(i,row)| row.iter().enumerate().filter(|(j,s)| *j != i && **s >=floor).count()).sum::<usize>(),"floor":floor});
            reports.push(serde_json::json!({"tokens":tokens,"cases":cases.iter().map(|(n,_)|n).collect::<Vec<_>>(),"text_image_top1":top1(&text_image),"image_text_top1":top1(&image_text),"image_image_top1":top1(&image_image),"count":cases.len(),"text_image_admission":admit(&text_image,0.70),"image_text_admission":admit(&image_text,0.75),"image_image_admission":admit(&image_image,0.80),"text_image_scores":text_image,"image_text_scores":image_text,"image_image_scores":image_image}));
        }
        println!(
            "NATIVE_VISUAL_QUALITY {}",
            serde_json::to_string(&reports).unwrap()
        );
        // A text-only native engine must preserve the compatible text space.
        let cache = temp.path().join("text-only");
        fs::create_dir_all(&cache).unwrap();
        let mut text =
            Engine::new_with_vision(&library, &root.join(MODEL_FILE), &cache, "gpu", 70, false)
                .unwrap();
        assert_eq!(
            text.embed(b"task: search result | query: privacy settings", false, 70)
                .unwrap()
                .len(),
            768
        );
    }

    #[test]
    #[ignore = "requires local pinned artifacts and macOS memory helper"]
    fn native_resource_probe() {
        let fixture = PathBuf::from(std::env::var("GNEAUXGHTS_LITERT_FIXTURE").unwrap());
        let tokens = std::env::var("GNEAUXGHTS_IMAGE_TOKENS")
            .unwrap_or("70".into())
            .parse::<u16>()
            .unwrap();
        let temp = crate::test_support::TestDir::new("litert-resources");
        litert_install::tests::install_fixture(
            temp.path(),
            &fixture.join("litert_lm_api-0.18.0-py3-none-macosx_12_0_arm64.whl"),
        );
        fs::create_dir_all(temp.path().join("semantic/models")).unwrap();
        fs::copy(
            fixture.join(MODEL_FILE),
            temp.path().join("semantic/models").join(MODEL_FILE),
        )
        .unwrap();
        let settings = Arc::new(Mutex::new(SemanticSettings {
            image_tokens: tokens,
            ..SemanticSettings::default()
        }));
        let provider = GemmaLiteRtEmbeddingProvider::new(
            temp.path().to_path_buf(),
            settings,
            Arc::new(SemanticDebugState::new()),
        );
        let helper =
            unsafe { libloading::Library::new(fixture.join("process-memory.dylib")).unwrap() };
        let sample = unsafe {
            *helper
                .get::<unsafe extern "C" fn(*mut u64) -> i32>(b"sample_process_memory\0")
                .unwrap()
        };
        let started = Instant::now();
        provider.prepare().unwrap();
        let startup = started.elapsed().as_secs_f64() * 1000.0;
        let image = fs::read(fixture.join("rising.png")).unwrap();
        provider.embed_image(&image).unwrap();
        let mut text_times = Vec::new();
        let mut image_times = Vec::new();
        for _ in 0..40 {
            let start = Instant::now();
            provider
                .embed_texts(
                    &["What ingredients go into the tomato dinner recipe?".into()],
                    EmbeddingInputKind::Query,
                )
                .unwrap();
            text_times.push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            provider.embed_image(&image).unwrap();
            image_times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        let mut memory = [0u64; 4];
        assert_eq!(unsafe { sample(memory.as_mut_ptr()) }, 0);
        text_times.sort_by(f64::total_cmp);
        image_times.sort_by(f64::total_cmp);
        println!(
            "NATIVE_RESOURCE {}",
            serde_json::json!({"tokens":tokens,"backend":provider.model_info().status,"startup_ms":startup,"text_p50_ms":text_times[19],"text_p95_ms":text_times[37],"image_p50_ms":image_times[19],"image_p95_ms":image_times[37],"rss_bytes":memory[0],"peak_rss_bytes":memory[1],"physical_bytes":memory[2],"peak_physical_bytes":memory[3]})
        );
        provider.shutdown();
        assert_eq!(unsafe { sample(memory.as_mut_ptr()) }, 0);
        println!("NATIVE_CLOSED rss={} physical={}", memory[0], memory[2]);
    }
}
