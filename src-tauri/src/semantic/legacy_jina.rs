//! Retained Jina/llama.cpp provider for next-launch recovery and regression controls.
use super::debug::SemanticDebugState;
use super::embed::{EmbeddingInputKind, EmbeddingProvider, ModelInfo, SemanticModelDownloadResult};
use super::owned_process::OwnedProcess;
use super::runtime_install::RuntimeInstaller;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::{
    env, fs,
    io::{self, BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, ExitStatus},
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

/// Texts per llama-server HTTP call. Larger batches keep `--threads-batch`
/// busy inside one request; concurrent HTTP calls rarely help on Metal.

/// Default llama-server context window. The Jina runtime's resident memory is
/// dominated by this KV-cache allocation, so it is the main lever for the
/// embedding process's footprint. Operators can override it via
/// `GNEAUXGHTS_LLAMA_CTX_SIZE` to trade context length for memory; the default
/// is unchanged so out-of-the-box embedding quality is not affected.
const DEFAULT_LLAMA_CTX_SIZE: u32 = 8192;
const MIN_LLAMA_CTX_SIZE: u32 = 512;

/// Maximum size (bytes) the llama-server stdout/stderr logs may reach before the
/// active file is rotated to a `.1` sibling. Overridable via
/// `GNEAUXGHTS_LLAMA_LOG_MAX_BYTES`. Default 5 MiB keeps logs useful for
/// debugging while preventing the verbose runtime chatter from growing
/// unbounded across a long-running session.
const DEFAULT_LLAMA_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// First load of a large GGUF on slower disks/CPUs can exceed tens of seconds.
const LLAMA_SERVER_READY_TIMEOUT: Duration = Duration::from_secs(240);
const LLAMA_SERVER_READY_POLL: Duration = Duration::from_millis(500);

pub(crate) struct JinaLlamaEmbeddingProvider {
    // `reqwest::blocking::Client` owns an internal Tokio runtime. Its final
    // drop must not happen on a Tokio worker, so Drop moves it to a plain OS
    // thread. Keep this optional solely to permit that ownership transfer.
    client: Option<Client>,
    model_dir: PathBuf,
    bundled_runtime_path: Option<PathBuf>,
    runtime_installer: RuntimeInstaller,
    setup: Mutex<()>,
    debug: Arc<SemanticDebugState>,
    runtime: Mutex<ProviderRuntimeState>,
    dimensions: usize,
}

#[derive(Default)]
struct ProviderRuntimeState {
    server: Option<OwnedProcess>,
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
        bundled_runtime_path: Option<PathBuf>,
        debug: Arc<SemanticDebugState>,
    ) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(240))
            .build()
            .map_err(|err| err.to_string())?;
        Ok(Self {
            client: Some(client),
            model_dir: app_data_dir.join("semantic").join("models"),
            runtime_installer: RuntimeInstaller::new(&app_data_dir),
            setup: Mutex::new(()),
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
        let model_source = self.resolve_model_source()?;
        let runtime_binary = self.resolve_runtime_binary().ok_or_else(|| {
            "Local search needs setup. Open Settings → Search and choose Set up local search."
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

        let mut command = Command::new(&runtime_binary);
        command.env("LLAMA_CACHE", &self.model_dir);
        if let Some(backend_path) = bundled_backend_plugin_path(&runtime_binary) {
            command.env("GGML_BACKEND_PATH", backend_path);
        }
        let ModelSource::LocalFile(model_path) = model_source;
        let thread_count = resolve_llama_thread_count();
        let parallel_slots = resolve_llama_parallel_slots(thread_count);
        eprintln!(
            "[embed] spawning llama-server threads={thread_count} parallel_slots={parallel_slots}"
        );
        command.arg("-m").arg(model_path);
        command
            .arg("--embeddings")
            .arg("--pooling")
            .arg("last")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ctx-size")
            .arg(resolve_llama_ctx_size().to_string())
            // Use all cores for both decode and prompt/embed batch work.
            .arg("--threads")
            .arg(thread_count.to_string())
            .arg("--threads-batch")
            .arg(thread_count.to_string())
            // Slots for concurrent HTTP; labeler prefers one large batch at a
            // time so this mainly helps search/index overlap.
            .arg("--parallel")
            .arg(parallel_slots.to_string())
            // Prefer GPU offload on Apple Silicon / CUDA hosts. Harmless no-op
            // when no accelerator is available (falls back to CPU threads).
            .arg("-ngl")
            .arg("99")
            // Suppress llama-server's debug-level chatter (the per-request
            // `srv update:` prompt-cache dumps that otherwise dominate the log).
            // Warnings, errors and the request log are still emitted.
            .arg("--log-verbosity")
            .arg("0");
        let mut child =
            OwnedProcess::spawn(&command).map_err(|err| startup_error(err.to_string()))?;

        // Drain the child's stdout/stderr through size-capped rotating sinks so
        // the logs stay useful for debugging without growing without bound. The
        // reader threads exit on their own when the child is terminated and its
        // pipes close (EOF), so there is nothing extra to track for shutdown.
        if let Some(out) = child.take_stdout() {
            spawn_rotating_log_drain(out, stdout_path.clone());
        }
        if let Some(err) = child.take_stderr() {
            spawn_rotating_log_drain(err, stderr_path.clone());
        }

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

    fn resolve_model_source(&self) -> Result<ModelSource, String> {
        if let Some(model_path) = self.cached_model_path() {
            return Ok(ModelSource::LocalFile(model_path));
        }

        Err(
            "Local search needs its model. Open Settings → Search and choose Set up local search."
                .to_string(),
        )
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
            self.client()
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

        if let Some(installed) = self.runtime_installer.installed_binary() {
            return Some(installed);
        }

        let env_candidate = env::var_os("GNEAUXGHTS_LLAMA_SERVER_BIN")
            .map(PathBuf::from)
            .filter(|path| path.is_file());
        if env_candidate.is_some() {
            return env_candidate;
        }

        let path_candidate = env::var_os("PATH").and_then(|raw_path| {
            env::split_paths(&raw_path)
                .map(|directory| {
                    directory.join(if cfg!(windows) {
                        "llama-server.exe"
                    } else {
                        "llama-server"
                    })
                })
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

    fn client(&self) -> &Client {
        self.client
            .as_ref()
            .expect("embedding HTTP client is available until provider drop")
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
            .client()
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
        } else if runtime_binary_path.is_none() {
            "local search needs setup in Settings → Search".to_string()
        } else if cached_model_path.is_none() {
            "model missing; use Set up local search in Settings → Search".to_string()
        } else if !runtime_status.is_empty() {
            runtime_status
        } else {
            "waiting for local runtime".to_string()
        };

        ModelInfo {
            id: MODEL_REPO_ID.to_string(),
            label: "Jina Embeddings v5 Text Nano Retrieval".to_string(),
            dimensions: self.dimensions,
            runtime_bundled: false,
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
        let _setup = self
            .setup
            .lock()
            .map_err(|_| "Local search setup lock poisoned".to_string())?;
        self.shutdown_server();
        if self.resolve_runtime_binary().is_none() {
            let download_client = Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .timeout(Duration::from_secs(600))
                .user_agent(concat!("Gneauxghts/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|err| err.to_string())?;
            self.runtime_installer.install(&download_client)?;
        }
        // A previous failed start must not make completed setup unavailable.
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.last_error = None;
            runtime.status = "waiting for local runtime".to_string();
        }
        if let Some(path) = self.cached_model_path() {
            return Ok(SemanticModelDownloadResult {
                already_present: true,
                path: path.to_string_lossy().into_owned(),
            });
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
        if let Some(client) = self.client.take() {
            // Tokio rejects dropping a runtime from one of its async workers.
            // A blocking reqwest client owns such a runtime internally. Always
            // perform its final drop on an ordinary thread; joining keeps app
            // shutdown deterministic and prevents a detached cleanup thread.
            if let Ok(drop_thread) = thread::Builder::new()
                .name("embedding-http-drop".to_string())
                .spawn(move || drop(client))
            {
                let _ = drop_thread.join();
            }
        }
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

fn with_prefix(text: &str, prefix: &str) -> String {
    if text.starts_with(prefix) {
        return text.to_string();
    }

    format!("{prefix}{text}")
}

/// Resolve the per-file byte cap for the llama-server logs, honoring the
/// `GNEAUXGHTS_LLAMA_LOG_MAX_BYTES` override when it parses to a non-zero value.
fn resolve_llama_log_max_bytes() -> u64 {
    env::var("GNEAUXGHTS_LLAMA_LOG_MAX_BYTES")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|bytes| *bytes > 0)
        .unwrap_or(DEFAULT_LLAMA_LOG_MAX_BYTES)
}

/// Spawn a detached thread that copies everything the child writes on `reader`
/// (its piped stdout or stderr) into `path`, rotating the file to a single `.1`
/// backup whenever it would exceed the configured byte cap. This bounds total
/// on-disk log usage to ~2x the cap (current + one rotated generation) no matter
/// how long the runtime stays up. The thread ends naturally at EOF, i.e. when
/// the child process is terminated and its pipe closes.
fn spawn_rotating_log_drain<R: Read + Send + 'static>(reader: R, path: PathBuf) {
    thread::spawn(move || {
        let max_bytes = resolve_llama_log_max_bytes();
        let mut reader = BufReader::new(reader);
        let mut writer = match RotatingLogWriter::open(path, max_bytes) {
            Ok(writer) => writer,
            Err(_) => return,
        };
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) => break, // EOF: child exited / pipe closed.
                Ok(_) => {
                    if writer.write_all(&line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = writer.flush();
    });
}

/// A minimal size-capped, single-backup rotating log sink. When a write would
/// push the active file past `max_bytes`, the current file is renamed to
/// `<path>.1` (replacing any prior backup) and a fresh file is started.
struct RotatingLogWriter {
    path: PathBuf,
    max_bytes: u64,
    written: u64,
    file: BufWriter<fs::File>,
}

impl RotatingLogWriter {
    fn open(path: PathBuf, max_bytes: u64) -> io::Result<Self> {
        let file = fs::File::create(&path)?;
        Ok(Self {
            path,
            max_bytes,
            written: 0,
            file: BufWriter::new(file),
        })
    }

    fn rotate(&mut self) -> io::Result<()> {
        self.file.flush()?;
        let backup = self.path.with_extension("log.1");
        // Best-effort rotation: if the rename fails we just keep appending to a
        // fresh file rather than letting a logging hiccup take down embedding.
        let _ = fs::rename(&self.path, &backup);
        self.file = BufWriter::new(fs::File::create(&self.path)?);
        self.written = 0;
        Ok(())
    }
}

impl Write for RotatingLogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.written.saturating_add(buf.len() as u64) > self.max_bytes && self.written > 0 {
            self.rotate()?;
        }
        let n = self.file.write(buf)?;
        self.written = self.written.saturating_add(n as u64);
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
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

/// Resolve the llama-server `--ctx-size`, honoring the `GNEAUXGHTS_LLAMA_CTX_SIZE`
/// override when it parses to a sane value. Falls back to `DEFAULT_LLAMA_CTX_SIZE`
/// for unset, empty, non-numeric, or too-small values so a typo can never shrink
/// the window below something the model can use.
fn resolve_llama_ctx_size() -> u32 {
    parse_llama_ctx_size(env::var("GNEAUXGHTS_LLAMA_CTX_SIZE").ok().as_deref())
}

fn parse_llama_ctx_size(value: Option<&str>) -> u32 {
    value
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|size| *size >= MIN_LLAMA_CTX_SIZE)
        .unwrap_or(DEFAULT_LLAMA_CTX_SIZE)
}

/// CPU threads for llama-server (`--threads` / `--threads-batch`). Defaults to
/// all logical cores; override with `GNEAUXGHTS_LLAMA_THREADS`.
fn resolve_llama_thread_count() -> usize {
    parse_llama_thread_count(
        env::var("GNEAUXGHTS_LLAMA_THREADS").ok().as_deref(),
        std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1),
    )
}

fn parse_llama_thread_count(value: Option<&str>, available: usize) -> usize {
    value
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|threads| *threads >= 1)
        .unwrap_or(available.max(1))
}

/// Concurrent request slots (`--parallel`). Defaults to `min(4, threads)` so
/// embed HTTP batches can overlap without exploding memory; override with
/// `GNEAUXGHTS_LLAMA_PARALLEL`.
fn resolve_llama_parallel_slots(thread_count: usize) -> usize {
    parse_llama_parallel_slots(
        env::var("GNEAUXGHTS_LLAMA_PARALLEL").ok().as_deref(),
        thread_count,
    )
}

fn parse_llama_parallel_slots(value: Option<&str>, thread_count: usize) -> usize {
    value
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|slots| *slots >= 1)
        .unwrap_or_else(|| thread_count.clamp(1, 4))
}

fn find_open_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|err| err.to_string())?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|err| err.to_string())
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

fn terminate_child(child: &mut Option<OwnedProcess>) {
    drop(child.take());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_http_client_can_be_released_from_async_context() {
        let provider = JinaLlamaEmbeddingProvider::new(
            std::env::temp_dir().join("gneauxghts-embedding-drop-test"),
            None,
            Arc::new(SemanticDebugState::new()),
        )
        .expect("provider");

        tauri::async_runtime::block_on(async move {
            drop(provider);
        });
    }

    #[test]
    fn llama_configuration_parsing_preserves_defaults_and_valid_overrides() {
        for value in [None, Some(""), Some("not-a-number"), Some("0")] {
            assert_eq!(parse_llama_ctx_size(value), DEFAULT_LLAMA_CTX_SIZE);
            assert_eq!(parse_llama_thread_count(value, 8), 8);
            assert_eq!(parse_llama_parallel_slots(value, 8), 4);
        }
        assert_eq!(parse_llama_ctx_size(Some("4096")), 4096);
        assert_eq!(parse_llama_ctx_size(Some(" 2048 ")), 2048);
        assert_eq!(
            parse_llama_ctx_size(Some(&(MIN_LLAMA_CTX_SIZE - 1).to_string())),
            DEFAULT_LLAMA_CTX_SIZE
        );
        assert_eq!(
            parse_llama_ctx_size(Some(&MIN_LLAMA_CTX_SIZE.to_string())),
            MIN_LLAMA_CTX_SIZE
        );
        assert_eq!(parse_llama_thread_count(Some("6"), 1), 6);
        assert_eq!(parse_llama_thread_count(None, 0), 1);
        assert_eq!(parse_llama_parallel_slots(Some("3"), 6), 3);
        assert_eq!(parse_llama_parallel_slots(None, 2), 2);
    }
}
