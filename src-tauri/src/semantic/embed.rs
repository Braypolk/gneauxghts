use super::{debug::SemanticDebugState, SemanticSettings};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, Read, Seek, SeekFrom, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const MODEL_REPO_ID: &str = "jinaai/jina-embeddings-v5-text-nano-retrieval";
const MODEL_FILENAME: &str = "jina-embeddings-v5-text-nano-retrieval-Q6_K.gguf";
/// File name on the Hugging Face repo `main` branch (llama.cpp `-hf` used a different naming scheme).
const HF_REPO_GGUF_FILE: &str = "v5-nano-retrieval-Q6_K.gguf";
const QUERY_PREFIX: &str = "Query: ";
const DOCUMENT_PREFIX: &str = "Document: ";

/// First load of a large GGUF on slower disks/CPUs can exceed tens of seconds.
const LLAMA_SERVER_READY_TIMEOUT: Duration = Duration::from_secs(240);
const LLAMA_SERVER_READY_POLL: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelInfo {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) dimensions: usize,
    pub(crate) local_only: bool,
    pub(crate) runtime_binary_path: Option<String>,
    pub(crate) model_path: Option<String>,
    pub(crate) model_repo_id: String,
    pub(crate) available: bool,
    pub(crate) loading: bool,
    pub(crate) ready: bool,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
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

pub(crate) struct JinaLlamaEmbeddingProvider {
    settings: Arc<Mutex<SemanticSettings>>,
    client: Client,
    model_dir: PathBuf,
    bundled_runtime_path: Option<PathBuf>,
    debug: Arc<SemanticDebugState>,
    runtime: Mutex<ProviderRuntimeState>,
    dimensions: usize,
}

#[derive(Default)]
struct ProviderRuntimeState {
    server: Option<Child>,
    port: Option<u16>,
    last_error: Option<String>,
    status: String,
    starting: bool,
}

#[derive(Deserialize)]
struct OpenAiEmbeddingsResponse {
    data: Vec<OpenAiEmbeddingItem>,
}

#[derive(Deserialize)]
struct OpenAiEmbeddingItem {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct SingleEmbeddingResponse {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct MultiEmbeddingResponse {
    embedding: Vec<Vec<f32>>,
}

enum ModelSource {
    LocalFile(PathBuf),
}

impl JinaLlamaEmbeddingProvider {
    pub(crate) fn new(
        app_data_dir: PathBuf,
        settings: Arc<Mutex<SemanticSettings>>,
        bundled_runtime_path: Option<PathBuf>,
        debug: Arc<SemanticDebugState>,
    ) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(240))
            .build()
            .map_err(|err| err.to_string())?;
        Ok(Self {
            settings,
            client,
            model_dir: app_data_dir.join("semantic").join("models"),
            bundled_runtime_path,
            debug,
            runtime: Mutex::new(ProviderRuntimeState {
                status: "waiting for local runtime".to_string(),
                ..ProviderRuntimeState::default()
            }),
            dimensions: 768,
        })
    }

    fn ensure_server_ready(&self) -> Result<u16, String> {
        let settings = self
            .settings
            .lock()
            .map_err(|_| "Semantic settings lock poisoned".to_string())?
            .clone();
        let model_source = self.resolve_model_source(&settings)?;
        let runtime_binary = self.resolve_runtime_binary().ok_or_else(|| {
            "Missing `llama-server`. Install llama.cpp or set GNEAUXGHTS_LLAMA_SERVER_BIN."
                .to_string()
        })?;

        loop {
            let maybe_wait_port = {
                let mut runtime = self
                    .runtime
                    .lock()
                    .map_err(|_| "Embedding runtime lock poisoned".to_string())?;

                if let Some(port) = runtime.port {
                    if runtime.starting {
                        Some(port)
                    } else if self.server_ready(port) {
                        runtime.status = "ready".to_string();
                        self.debug.record_with_metrics(
                            "runtime",
                            "runtime_ready",
                            Some(format!("port={port}")),
                            None,
                            |metrics| metrics.runtime_ready_count += 1,
                        );
                        return Ok(port);
                    } else {
                        self.debug.record_with_metrics(
                            "runtime",
                            "runtime_restart",
                            Some(format!("port={port}")),
                            None,
                            |metrics| metrics.runtime_restart_count += 1,
                        );
                        terminate_child(&mut runtime.server);
                        runtime.port = None;
                        runtime.starting = false;
                        None
                    }
                } else if runtime.starting {
                    Some(0)
                } else {
                    runtime.starting = true;
                    runtime.last_error = None;
                    runtime.status = "starting local Jina runtime".to_string();
                    None
                }
            };

            if maybe_wait_port.is_some() {
                thread::sleep(Duration::from_millis(250));
                continue;
            }

            break;
        }

        let startup_error = |error: String| {
            self.update_runtime_error(error.clone());
            self.shutdown_server();
            error
        };

        let port = find_open_port().map_err(startup_error)?;
        fs::create_dir_all(&self.model_dir).map_err(|err| startup_error(err.to_string()))?;
        let stdout_path = self.model_dir.join("llama-server.stdout.log");
        let stderr_path = self.model_dir.join("llama-server.stderr.log");
        let stdout =
            fs::File::create(&stdout_path).map_err(|err| startup_error(err.to_string()))?;
        let stderr =
            fs::File::create(&stderr_path).map_err(|err| startup_error(err.to_string()))?;

        let mut command = Command::new(&runtime_binary);
        command.env("LLAMA_CACHE", &self.model_dir);
        if let Some(backend_path) = bundled_backend_plugin_path(&runtime_binary) {
            command.env("GGML_BACKEND_PATH", backend_path);
        }
        if settings.local_only_mode {
            command.env("LLAMA_OFFLINE", "1");
        }
        let ModelSource::LocalFile(model_path) = model_source;
        command.arg("-m").arg(model_path);
        let child = command
            .arg("--embeddings")
            .arg("--pooling")
            .arg("last")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ctx-size")
            .arg("8192")
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|err| startup_error(err.to_string()))?;

        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "Embedding runtime lock poisoned".to_string())?;
            runtime.server = Some(child);
            runtime.port = Some(port);
            runtime.last_error = None;
            runtime.starting = false;
            runtime.status = format!("starting local Jina runtime on port {port}");
        }
        self.debug.record_with_metrics(
            "runtime",
            "runtime_spawned",
            Some(format!("port={port}")),
            None,
            |metrics| metrics.runtime_spawn_count += 1,
        );

        let ready_deadline = Instant::now() + LLAMA_SERVER_READY_TIMEOUT;
        loop {
            if self.server_ready(port) {
                let mut runtime = self
                    .runtime
                    .lock()
                    .map_err(|_| "Embedding runtime lock poisoned".to_string())?;
                runtime.starting = false;
                runtime.status = "ready".to_string();
                self.debug.record_with_metrics(
                    "runtime",
                    "runtime_ready",
                    Some(format!("port={port}")),
                    None,
                    |metrics| metrics.runtime_ready_count += 1,
                );
                return Ok(port);
            }

            if Instant::now() >= ready_deadline {
                break;
            }

            let exited_early = {
                let mut runtime = self
                    .runtime
                    .lock()
                    .map_err(|_| "Embedding runtime lock poisoned".to_string())?;
                match runtime.server.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => Some(status),
                        Ok(None) | Err(_) => None,
                    },
                    None => None,
                }
            };
            if let Some(status) = exited_early {
                let detail = format_llama_server_exit(&stderr_path, status);
                self.update_runtime_error(detail.clone());
                self.debug.record_with_metrics(
                    "runtime",
                    "runtime_child_exited_early",
                    Some(detail.clone()),
                    None,
                    |_| {},
                );
                self.shutdown_server();
                return Err(detail);
            }

            thread::sleep(LLAMA_SERVER_READY_POLL);
        }

        let stderr_tail = read_tail_utf8_lossy(&stderr_path, 6000);
        let timeout_msg = if stderr_tail.trim().is_empty() {
            format!(
                "Timed out after {}s waiting for llama-server on port {port} (model load can be slow on older hardware). Full log: {}. If this repeats, confirm `llama-server` matches your machine (Apple Silicon vs Intel) and that the GGUF is not on a very slow or remote disk.",
                LLAMA_SERVER_READY_TIMEOUT.as_secs(),
                stderr_path.display()
            )
        } else {
            format!(
                "Timed out after {}s waiting for llama-server on port {port}. Last stderr output:\n{stderr_tail}",
                LLAMA_SERVER_READY_TIMEOUT.as_secs()
            )
        };
        self.update_runtime_error(timeout_msg.clone());
        self.debug.record_with_metrics(
            "runtime",
            "runtime_timeout",
            Some(stderr_path.display().to_string()),
            None,
            |metrics| metrics.runtime_timeout_count += 1,
        );
        self.shutdown_server();
        Err(timeout_msg)
    }

    fn shutdown_server(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            let had_runtime = runtime.server.is_some() || runtime.port.is_some();
            let detail = runtime.port.map(|port| format!("port={port}"));
            terminate_child(&mut runtime.server);
            runtime.port = None;
            runtime.starting = false;
            if runtime.last_error.is_none() {
                runtime.status = "stopped".to_string();
            }
            if had_runtime {
                self.debug.record_with_metrics(
                    "runtime",
                    "runtime_shutdown",
                    detail,
                    None,
                    |metrics| metrics.runtime_shutdown_count += 1,
                );
            }
        }
    }

    fn resolve_model_source(&self, settings: &SemanticSettings) -> Result<ModelSource, String> {
        if let Some(model_path) = self.cached_model_path() {
            return Ok(ModelSource::LocalFile(model_path));
        }

        let error = if settings.local_only_mode {
            format!(
                "Model file missing from {}. Local-only mode blocks network download. Turn off local-only mode and use Download embedding model in Settings, or place {} in this folder.",
                self.model_dir.display(),
                MODEL_FILENAME
            )
        } else {
            format!(
                "Model file missing from {}. Use Download embedding model in Settings (Search), or place {} in this folder.",
                self.model_dir.display(),
                MODEL_FILENAME
            )
        };
        self.update_runtime_error(error.clone());
        Err(error)
    }

    fn download_gguf_from_huggingface(&self) -> Result<(), String> {
        fs::create_dir_all(&self.model_dir).map_err(|err| err.to_string())?;
        let dest = self.model_path();
        let partial = self.model_dir.join(format!("{MODEL_FILENAME}.partial"));
        if partial.exists() {
            let _ = fs::remove_file(&partial);
        }

        let url =
            format!("https://huggingface.co/{MODEL_REPO_ID}/resolve/main/{HF_REPO_GGUF_FILE}");
        self.debug.record_with_metrics(
            "runtime",
            "model_download_started",
            Some(url.clone()),
            None,
            |_| {},
        );

        let download_client = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(7200))
            .user_agent(concat!("Gneauxghts/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|err| err.to_string())?;

        let mut response = download_client
            .get(&url)
            .send()
            .map_err(|err| format!("Failed to reach Hugging Face: {err}"))?
            .error_for_status()
            .map_err(|err| format!("Model download request failed: {err}"))?;

        let mut partial_file = fs::File::create(&partial)
            .map_err(|err| format!("Could not write download file: {err}"))?;
        io::copy(&mut response, &mut partial_file)
            .map_err(|err| format!("Failed while saving the model file: {err}"))?;
        partial_file
            .flush()
            .map_err(|err| format!("Could not finish writing the model file: {err}"))?;
        drop(partial_file);

        if !is_valid_gguf_file(&partial) {
            let _ = fs::remove_file(&partial);
            return Err(
                "Downloaded data is not a valid GGUF model (file too small or corrupt)."
                    .to_string(),
            );
        }

        fs::rename(&partial, &dest).map_err(|err| {
            let _ = fs::remove_file(&partial);
            format!("Could not install the model file: {err}")
        })?;

        self.debug.record_with_metrics(
            "runtime",
            "model_download_completed",
            Some(dest.display().to_string()),
            None,
            |_| {},
        );
        Ok(())
    }

    fn server_ready(&self, port: u16) -> bool {
        let health_urls = [
            format!("http://127.0.0.1:{port}/health"),
            format!("http://127.0.0.1:{port}/v1/models"),
        ];

        health_urls.iter().any(|url| {
            self.client
                .get(url)
                .send()
                .map(|response| response.status().is_success())
                .unwrap_or(false)
        })
    }

    fn resolve_runtime_binary(&self) -> Option<PathBuf> {
        if self
            .bundled_runtime_path
            .as_ref()
            .is_some_and(|path| path.is_file())
        {
            return self.bundled_runtime_path.clone();
        }

        let env_candidate = env::var_os("GNEAUXGHTS_LLAMA_SERVER_BIN")
            .map(PathBuf::from)
            .filter(|path| path.is_file());
        if env_candidate.is_some() {
            return env_candidate;
        }

        let path_candidate = env::var_os("PATH").and_then(|raw_path| {
            env::split_paths(&raw_path)
                .map(|directory| directory.join("llama-server"))
                .find(|candidate| candidate.is_file())
        });
        if path_candidate.is_some() {
            return path_candidate;
        }

        [
            "/opt/homebrew/bin/llama-server",
            "/usr/local/bin/llama-server",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.is_file())
    }

    fn model_path(&self) -> PathBuf {
        self.model_dir.join(MODEL_FILENAME)
    }

    fn cached_model_path(&self) -> Option<PathBuf> {
        let direct_model_path = self.model_path();
        if is_valid_gguf_file(&direct_model_path) {
            return Some(direct_model_path);
        }

        find_model_file(
            &self.model_dir,
            &[
                MODEL_FILENAME,
                "jinaai_jina-embeddings-v5-text-nano-retrieval_v5-nano-retrieval-Q6_K.gguf",
            ],
            4,
        )
    }

    fn update_runtime_error(&self, error: String) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.last_error = Some(error.clone());
            runtime.status = error;
        }
    }

    fn readiness_snapshot(&self) -> (Option<u16>, bool, Option<String>, String) {
        match self.runtime.lock() {
            Ok(runtime) => (
                runtime.port,
                runtime.starting,
                runtime.last_error.clone(),
                runtime.status.clone(),
            ),
            Err(_) => (
                None,
                false,
                Some("Embedding runtime lock poisoned".to_string()),
                String::new(),
            ),
        }
    }
}

impl EmbeddingProvider for JinaLlamaEmbeddingProvider {
    fn embed_texts(
        &self,
        texts: &[String],
        kind: EmbeddingInputKind,
    ) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        let started_at = Instant::now();
        let text_count = texts.len() as u64;
        let char_count = texts
            .iter()
            .map(|text| text.chars().count() as u64)
            .sum::<u64>();
        let port = self.ensure_server_ready()?;
        let input = texts
            .iter()
            .map(|text| match kind {
                EmbeddingInputKind::Document => with_prefix(text, DOCUMENT_PREFIX),
                EmbeddingInputKind::Query => with_prefix(text, QUERY_PREFIX),
            })
            .collect::<Vec<_>>();
        let url = format!("http://127.0.0.1:{port}/v1/embeddings");
        let response_text = self
            .client
            .post(&url)
            .json(&serde_json::json!({ "input": input }))
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|err| {
                let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                self.debug.record_timing(
                    "embedding",
                    "request_failed",
                    Some(err.to_string()),
                    elapsed,
                    |metrics| {
                        metrics.embedding_request_count += 1;
                        metrics.embedding_request_failure_count += 1;
                        metrics.embedding_text_count_total += text_count;
                        metrics.embedding_char_count_total += char_count;
                        metrics.embedding_duration_total_millis += elapsed;
                        metrics.embedding_duration_max_millis =
                            metrics.embedding_duration_max_millis.max(elapsed);
                    },
                );
                err.to_string()
            })?
            .text()
            .map_err(|err| {
                let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                self.debug.record_timing(
                    "embedding",
                    "request_failed",
                    Some(err.to_string()),
                    elapsed,
                    |metrics| {
                        metrics.embedding_request_count += 1;
                        metrics.embedding_request_failure_count += 1;
                        metrics.embedding_text_count_total += text_count;
                        metrics.embedding_char_count_total += char_count;
                        metrics.embedding_duration_total_millis += elapsed;
                        metrics.embedding_duration_max_millis =
                            metrics.embedding_duration_max_millis.max(elapsed);
                    },
                );
                err.to_string()
            })?;

        let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

        if let Ok(response) = serde_json::from_str::<OpenAiEmbeddingsResponse>(&response_text) {
            self.debug.record_timing(
                "embedding",
                "request_completed",
                Some(format!("kind={}", kind.label())),
                elapsed,
                |metrics| {
                    metrics.embedding_request_count += 1;
                    metrics.embedding_request_success_count += 1;
                    metrics.embedding_text_count_total += text_count;
                    metrics.embedding_char_count_total += char_count;
                    metrics.embedding_duration_total_millis += elapsed;
                    metrics.embedding_duration_max_millis =
                        metrics.embedding_duration_max_millis.max(elapsed);
                },
            );
            return Ok(response
                .data
                .into_iter()
                .map(|item| item.embedding)
                .collect());
        }

        if let Ok(response) = serde_json::from_str::<SingleEmbeddingResponse>(&response_text) {
            self.debug.record_timing(
                "embedding",
                "request_completed",
                Some(format!("kind={}", kind.label())),
                elapsed,
                |metrics| {
                    metrics.embedding_request_count += 1;
                    metrics.embedding_request_success_count += 1;
                    metrics.embedding_text_count_total += text_count;
                    metrics.embedding_char_count_total += char_count;
                    metrics.embedding_duration_total_millis += elapsed;
                    metrics.embedding_duration_max_millis =
                        metrics.embedding_duration_max_millis.max(elapsed);
                },
            );
            return Ok(vec![response.embedding]);
        }

        if let Ok(response) = serde_json::from_str::<Vec<SingleEmbeddingResponse>>(&response_text) {
            self.debug.record_timing(
                "embedding",
                "request_completed",
                Some(format!("kind={}", kind.label())),
                elapsed,
                |metrics| {
                    metrics.embedding_request_count += 1;
                    metrics.embedding_request_success_count += 1;
                    metrics.embedding_text_count_total += text_count;
                    metrics.embedding_char_count_total += char_count;
                    metrics.embedding_duration_total_millis += elapsed;
                    metrics.embedding_duration_max_millis =
                        metrics.embedding_duration_max_millis.max(elapsed);
                },
            );
            return Ok(response.into_iter().map(|item| item.embedding).collect());
        }

        if let Ok(response) = serde_json::from_str::<MultiEmbeddingResponse>(&response_text) {
            self.debug.record_timing(
                "embedding",
                "request_completed",
                Some(format!("kind={}", kind.label())),
                elapsed,
                |metrics| {
                    metrics.embedding_request_count += 1;
                    metrics.embedding_request_success_count += 1;
                    metrics.embedding_text_count_total += text_count;
                    metrics.embedding_char_count_total += char_count;
                    metrics.embedding_duration_total_millis += elapsed;
                    metrics.embedding_duration_max_millis =
                        metrics.embedding_duration_max_millis.max(elapsed);
                },
            );
            return Ok(response.embedding);
        }

        self.debug.record_timing(
            "embedding",
            "request_failed",
            Some("unexpected_response".to_string()),
            elapsed,
            |metrics| {
                metrics.embedding_request_count += 1;
                metrics.embedding_request_failure_count += 1;
                metrics.embedding_text_count_total += text_count;
                metrics.embedding_char_count_total += char_count;
                metrics.embedding_duration_total_millis += elapsed;
                metrics.embedding_duration_max_millis =
                    metrics.embedding_duration_max_millis.max(elapsed);
            },
        );
        Err(format!(
            "Unexpected embedding response from local runtime: {response_text}"
        ))
    }

    fn model_info(&self) -> ModelInfo {
        let settings = self
            .settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default();
        let runtime_binary_path = self.resolve_runtime_binary();
        let cached_model_path = self.cached_model_path();
        let (runtime_port, runtime_starting, runtime_error, runtime_status) =
            self.readiness_snapshot();
        let can_prepare = runtime_binary_path.is_some() && cached_model_path.is_some();
        let ready = runtime_error.is_none()
            && !runtime_starting
            && runtime_port.is_some_and(|port| self.server_ready(port));
        let loading = !ready && runtime_error.is_none() && can_prepare;
        let status = if ready {
            "ready".to_string()
        } else if !runtime_status.is_empty() {
            runtime_status
        } else if runtime_binary_path.is_none() {
            "llama-server runtime not installed".to_string()
        } else if cached_model_path.is_none() {
            if settings.local_only_mode {
                "model missing; turn off local-only mode to download, or add the GGUF file manually"
                    .to_string()
            } else {
                "model missing; use Download embedding model in Settings".to_string()
            }
        } else {
            "waiting for local runtime".to_string()
        };

        ModelInfo {
            id: MODEL_REPO_ID.to_string(),
            label: "Jina Embeddings v5 Text Nano Retrieval".to_string(),
            dimensions: self.dimensions,
            local_only: settings.local_only_mode,
            runtime_binary_path: runtime_binary_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            model_path: Some(
                cached_model_path
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|| self.model_dir.clone())
                    .to_string_lossy()
                    .into_owned(),
            ),
            model_repo_id: MODEL_REPO_ID.to_string(),
            available: runtime_binary_path.is_some()
                && cached_model_path.is_some()
                && runtime_error.is_none(),
            loading,
            ready,
            status,
            error: runtime_error,
        }
    }

    fn prepare(&self) -> Result<(), String> {
        let started_at = Instant::now();
        self.debug
            .record_with_metrics("runtime", "prepare_started", None, None, |metrics| {
                metrics.model_prepare_count += 1;
            });
        match self.ensure_server_ready() {
            Ok(_) => {
                let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                self.debug.record_timing(
                    "runtime",
                    "prepare_completed",
                    None,
                    elapsed,
                    |metrics| {
                        metrics.model_prepare_success_count += 1;
                        metrics.model_prepare_last_millis = Some(elapsed);
                    },
                );
                Ok(())
            }
            Err(error) => {
                let elapsed = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                self.debug.record_timing(
                    "runtime",
                    "prepare_failed",
                    Some(error.clone()),
                    elapsed,
                    |metrics| {
                        metrics.model_prepare_failure_count += 1;
                        metrics.model_prepare_last_millis = Some(elapsed);
                    },
                );
                Err(error)
            }
        }
    }

    fn download_model_if_needed(&self) -> Result<SemanticModelDownloadResult, String> {
        self.shutdown_server();
        if let Some(path) = self.cached_model_path() {
            return Ok(SemanticModelDownloadResult {
                already_present: true,
                path: path.to_string_lossy().into_owned(),
            });
        }

        let settings = self
            .settings
            .lock()
            .map_err(|_| "Semantic settings lock poisoned".to_string())?
            .clone();
        if settings.local_only_mode {
            return Err(
                "Local-only mode is on. Turn it off in Semantic Layer settings to download from Hugging Face, or add the GGUF file manually."
                    .to_string(),
            );
        }

        match self.download_gguf_from_huggingface() {
            Ok(()) => {
                let path = self.cached_model_path().ok_or_else(|| {
                    "Download reported success but the model file is still missing.".to_string()
                })?;
                Ok(SemanticModelDownloadResult {
                    already_present: false,
                    path: path.to_string_lossy().into_owned(),
                })
            }
            Err(err) => {
                self.debug.record_with_metrics(
                    "runtime",
                    "model_download_failed",
                    Some(err.clone()),
                    None,
                    |_| {},
                );
                Err(err)
            }
        }
    }

    fn shutdown(&self) {
        self.shutdown_server();
    }
}

impl Drop for JinaLlamaEmbeddingProvider {
    fn drop(&mut self) {
        self.shutdown_server();
    }
}

impl EmbeddingInputKind {
    fn label(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Query => "query",
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

fn with_prefix(text: &str, prefix: &str) -> String {
    if text.starts_with(prefix) {
        return text.to_string();
    }

    format!("{prefix}{text}")
}

fn read_tail_utf8_lossy(path: &Path, max_bytes: usize) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let Ok(meta) = file.metadata() else {
        return String::new();
    };
    let len = meta.len();
    let start = len.saturating_sub(max_bytes as u64);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&buf).into_owned()
}

fn format_llama_server_exit(stderr_path: &Path, status: ExitStatus) -> String {
    let tail = read_tail_utf8_lossy(stderr_path, 6000);
    let code = status
        .code()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "(terminated by signal)".to_string());
    let mut message = if tail.trim().is_empty() {
        format!(
            "llama-server exited with status {code} before the HTTP API was ready. See {}",
            stderr_path.display()
        )
    } else {
        format!(
            "llama-server exited with status {code} before the HTTP API was ready. Stderr tail:\n{tail}"
        )
    };

    #[cfg(target_os = "macos")]
    if status.code().is_none() && tail.trim().is_empty() {
        message.push_str(
            "\n\nOn macOS, release builds use the bundled llama-server under Resources/bin. Empty logs usually mean the process was killed before it ran (unsigned nested binary after install_name_tool). Rebuild so build.rs can ad-hoc codesign the staged binaries, or set GNEAUXGHTS_LLAMA_SERVER_BIN to a working llama-server (e.g. from Homebrew). Check Console.app for AMFI or kernel messages.",
        );
    }

    message
}

fn find_open_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|err| err.to_string())?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|err| err.to_string())
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

fn find_model_file(directory: &Path, file_names: &[&str], depth: usize) -> Option<PathBuf> {
    if depth == 0 || !directory.is_dir() {
        return None;
    }

    for entry in fs::read_dir(directory).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_file() {
            let matches_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    file_names.contains(&name)
                        || (name.contains("jina-embeddings-v5-text-nano-retrieval")
                            && name.ends_with("Q6_K.gguf"))
                })
                .unwrap_or(false);
            if matches_name && is_valid_gguf_file(&path) {
                return Some(path);
            }
        }

        if path.is_dir() {
            if let Some(found_path) = find_model_file(&path, file_names, depth.saturating_sub(1)) {
                return Some(found_path);
            }
        }
    }

    None
}

fn terminate_child(child: &mut Option<Child>) {
    let Some(mut child) = child.take() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) | Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn bundled_backend_plugin_path(runtime_binary: &Path) -> Option<PathBuf> {
    let bin_dir = runtime_binary.parent()?;
    if bin_dir.file_name().and_then(|name| name.to_str()) != Some("bin") {
        return None;
    }
    let backend_dir = bin_dir.parent()?.join("lib");
    [
        "libggml-cpu-apple_m1.so",
        "libggml-metal.so",
        "libggml-blas.so",
    ]
    .into_iter()
    .map(|file_name| backend_dir.join(file_name))
    .find(|path| path.is_file())
}

fn is_valid_gguf_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    if metadata.len() < 1024 * 1024 {
        return false;
    }

    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut header = [0_u8; 4];
    if file.read_exact(&mut header).is_err() {
        return false;
    }

    header == *b"GGUF"
}

#[allow(dead_code)]
fn _debug_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
