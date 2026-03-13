use super::SemanticSettings;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::Read,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

const MODEL_REPO_ID: &str = "jinaai/jina-embeddings-v5-text-nano-retrieval";
const MODEL_ID: &str = "jinaai/jina-embeddings-v5-text-nano-retrieval";
const MODEL_QUANT: &str = "Q6_K";
const MODEL_FILENAME: &str = "jina-embeddings-v5-text-nano-retrieval-Q6_K.gguf";
const QUERY_PREFIX: &str = "Query: ";
const DOCUMENT_PREFIX: &str = "Document: ";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelInfo {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) dimensions: usize,
    pub(crate) local_only: bool,
    pub(crate) auto_download_supported: bool,
    pub(crate) runtime_binary_path: Option<String>,
    pub(crate) model_path: Option<String>,
    pub(crate) model_repo_id: String,
    pub(crate) available: bool,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Copy)]
pub(crate) enum EmbeddingInputKind {
    Document,
    Query,
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
}

pub(crate) struct JinaLlamaEmbeddingProvider {
    settings: Arc<Mutex<SemanticSettings>>,
    client: Client,
    model_dir: PathBuf,
    bundled_runtime_path: Option<PathBuf>,
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
    HuggingFaceReference(String),
}

impl JinaLlamaEmbeddingProvider {
    pub(crate) fn new(
        app_data_dir: PathBuf,
        settings: Arc<Mutex<SemanticSettings>>,
        bundled_runtime_path: Option<PathBuf>,
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
                        return Ok(port);
                    } else {
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
        let stdout = fs::File::create(&stdout_path).map_err(|err| startup_error(err.to_string()))?;
        let stderr = fs::File::create(&stderr_path).map_err(|err| startup_error(err.to_string()))?;

        let mut command = Command::new(&runtime_binary);
        command.env("LLAMA_CACHE", &self.model_dir);
        if settings.local_only_mode {
            command.env("LLAMA_OFFLINE", "1");
        }
        match model_source {
            ModelSource::LocalFile(model_path) => {
                command.arg("-m").arg(model_path);
            }
            ModelSource::HuggingFaceReference(reference) => {
                command.arg("-hf").arg(reference);
            }
        }
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

        for _ in 0..60 {
            if self.server_ready(port) {
                let mut runtime = self
                    .runtime
                    .lock()
                    .map_err(|_| "Embedding runtime lock poisoned".to_string())?;
                runtime.starting = false;
                runtime.status = "ready".to_string();
                return Ok(port);
            }
            thread::sleep(Duration::from_millis(500));
        }

        self.update_runtime_error(format!(
            "Timed out waiting for llama-server. Check {}",
            stderr_path.display()
        ));
        self.shutdown_server();
        Err("Timed out waiting for local Jina embedding runtime".to_string())
    }

    fn shutdown_server(&self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            terminate_child(&mut runtime.server);
            runtime.port = None;
            runtime.starting = false;
            if runtime.last_error.is_none() {
                runtime.status = "stopped".to_string();
            }
        }
    }

    fn resolve_model_source(&self, settings: &SemanticSettings) -> Result<ModelSource, String> {
        if let Some(model_path) = self.cached_model_path() {
            return Ok(ModelSource::LocalFile(model_path));
        }

        if settings.local_only_mode {
            let error = format!(
                "Model file missing from {} and local-only mode is enabled. Place {} in the llama.cpp cache or disable local-only mode.",
                self.model_dir.display(),
                MODEL_FILENAME
            );
            self.update_runtime_error(error.clone());
            return Err(error);
        }

        if !settings.auto_download_model {
            let error = format!(
                "Model file missing from {}. Enable auto-download or place {} in the llama.cpp cache manually.",
                self.model_dir.display(),
                MODEL_FILENAME
            );
            self.update_runtime_error(error.clone());
            return Err(error);
        }

        fs::create_dir_all(&self.model_dir).map_err(|err| err.to_string())?;
        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| "Embedding runtime lock poisoned".to_string())?;
            runtime.status = format!("will download {MODEL_ID}:{MODEL_QUANT} into llama.cpp cache");
            runtime.last_error = None;
        }
        Ok(ModelSource::HuggingFaceReference(format!(
            "{MODEL_ID}:{MODEL_QUANT}"
        )))
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

        ["/opt/homebrew/bin/llama-server", "/usr/local/bin/llama-server"]
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
            .map_err(|err| err.to_string())?
            .text()
            .map_err(|err| err.to_string())?;

        if let Ok(response) = serde_json::from_str::<OpenAiEmbeddingsResponse>(&response_text) {
            return Ok(response
                .data
                .into_iter()
                .map(|item| item.embedding)
                .collect());
        }

        if let Ok(response) = serde_json::from_str::<SingleEmbeddingResponse>(&response_text) {
            return Ok(vec![response.embedding]);
        }

        if let Ok(response) = serde_json::from_str::<Vec<SingleEmbeddingResponse>>(&response_text) {
            return Ok(response.into_iter().map(|item| item.embedding).collect());
        }

        if let Ok(response) = serde_json::from_str::<MultiEmbeddingResponse>(&response_text) {
            return Ok(response.embedding);
        }

        Err(format!("Unexpected embedding response from local runtime: {response_text}"))
    }

    fn model_info(&self) -> ModelInfo {
        let settings = self
            .settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default();
        let runtime_binary_path = self.resolve_runtime_binary();
        let cached_model_path = self.cached_model_path();
        let runtime = self.runtime.lock().ok();
        let runtime_error = runtime.as_ref().and_then(|state| state.last_error.clone());
        let status = runtime
            .as_ref()
            .map(|state| state.status.clone())
            .filter(|status| !status.is_empty())
            .unwrap_or_else(|| {
                if !runtime_binary_path.is_some() {
                    "llama-server runtime not installed".to_string()
                } else if cached_model_path.is_none() {
                    if settings.local_only_mode {
                        "model missing from llama.cpp cache and local-only mode blocks download"
                            .to_string()
                    } else if settings.auto_download_model {
                        "model will download into llama.cpp cache on first semantic use"
                            .to_string()
                    } else {
                        "model missing from llama.cpp cache".to_string()
                    }
                } else {
                    "ready".to_string()
                }
            });

        ModelInfo {
            id: MODEL_ID.to_string(),
            label: "Jina Embeddings v5 Text Nano Retrieval".to_string(),
            dimensions: self.dimensions,
            local_only: settings.local_only_mode,
            auto_download_supported: true,
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
            status,
            error: runtime_error,
        }
    }

    fn prepare(&self) -> Result<(), String> {
        self.ensure_server_ready().map(|_| ())
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
                    file_names.iter().any(|candidate| name == *candidate)
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
