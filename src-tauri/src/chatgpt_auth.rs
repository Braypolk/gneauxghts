//! Pi owns OAuth; this native owner serializes credential changes and keeps
//! access/refresh tokens out of WebView state, vaults, logs, and process arguments.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

const ACCOUNT: &str = "provider.openai.chatgpt";
const SIGN_IN_REQUIRED: &str = "ChatGPT access expired or was removed. Sign in again in Settings.";
#[derive(Default)]
pub(crate) struct ChatGptAuth {
    gate: tokio::sync::Mutex<()>,
    login: Mutex<Option<CancellationToken>>,
    progress: Mutex<LoginProgress>,
    input: Mutex<Option<tokio::sync::mpsc::Sender<String>>>,
}
#[derive(Default, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum LoginPhase {
    #[default]
    Idle,
    Starting,
    WaitingForBrowser,
    Completing,
    Saving,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginProgress {
    phase: LoginPhase,
    browser_url: Option<String>,
    manual_input: bool,
    error: Option<String>,
}
fn update_progress(app: &AppHandle, change: impl FnOnce(&mut LoginProgress)) {
    if let Ok(mut progress) = app.state::<ChatGptAuth>().progress.lock() {
        change(&mut progress);
    }
}
#[derive(Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AuthMethod {
    #[default]
    ApiKey,
    Chatgpt,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    method: AuthMethod,
    device_id: Option<String>,
    // Registration survives disconnect; tokens remain exclusively in the keyring.
    client_id: Option<String>,
}
impl Preferences {
    fn remember_registration(&mut self, credential: &Value) -> Result<(), String> {
        let id = credential["clientId"]
            .as_str()
            .filter(|id| !id.trim().is_empty() && *id != "dynamic_agent_client")
            .ok_or("ChatGPT registration is invalid")?;
        if self.client_id.as_deref().is_some_and(|saved| saved != id) {
            return Err("ChatGPT sign-in changed the saved app registration".into());
        }
        self.client_id = Some(id.into());
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthStatus {
    pub(crate) method: AuthMethod,
    connected: bool,
    supported: bool,
    login: LoginProgress,
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "Device settings are unavailable")?
        .join("chatgpt-auth.json"))
}
fn preferences(app: &AppHandle) -> Result<Preferences, String> {
    match fs::read(preferences_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "ChatGPT device settings are unreadable".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(_) => Err("ChatGPT device settings are unavailable".into()),
    }
}
fn save_preferences(app: &AppHandle, value: &Preferences) -> Result<(), String> {
    let path = preferences_path(app)?;
    fs::create_dir_all(path.parent().unwrap())
        .map_err(|_| "Unable to save ChatGPT device settings")?;
    let temporary = path.with_extension(format!(
        "{}.tmp",
        crate::pi_chat::authority::opaque_id().map_err(|_| "Unable to save device settings")?
    ));
    let result = (|| {
        use std::io::Write;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Unable to save device settings")?;
        file.write_all(&serde_json::to_vec(value).map_err(|_| "Unable to encode device settings")?)
            .map_err(|_| "Unable to save device settings")?;
        file.sync_all()
            .map_err(|_| "Unable to save device settings")?;
        fs::rename(&temporary, &path).map_err(|_| "Unable to publish device settings")
    })();
    let _ = fs::remove_file(temporary);
    result.map_err(String::from)
}
pub(crate) fn method(app: &AppHandle) -> Result<AuthMethod, String> {
    Ok(preferences(app)?.method)
}
#[tauri::command]
pub(crate) fn chat_openai_auth_method(app: AppHandle) -> Result<AuthMethod, String> {
    method(&app)
}
fn credential(app: &AppHandle) -> Result<Option<Value>, String> {
    crate::secrets::read_account(app, ACCOUNT)
        .map_err(|_| "Unable to read ChatGPT credentials".to_string())?
        .map(|value| {
            serde_json::from_str(&value).map_err(|_| {
                "ChatGPT credentials are unreadable; reconnect in Settings".to_string()
            })
        })
        .transpose()
}
fn store(app: &AppHandle, value: &Value) -> Result<(), String> {
    validate_credential(value)?;
    crate::secrets::write_account(app, ACCOUNT, Some(&value.to_string()))
        .map_err(|_| "Unable to securely save ChatGPT credentials".into())
}
// Adopt credentials saved before registration retention was introduced. Do this
// before sign-in or deleting tokens so neither path loses the existing client.
fn registered_preferences(app: &AppHandle) -> Result<Preferences, String> {
    let mut prefs = preferences(app)?;
    if prefs.client_id.is_none() {
        if let Some(value) = credential(app)? {
            prefs.remember_registration(&value)?;
            save_preferences(app, &prefs)?;
        }
    }
    Ok(prefs)
}
fn validate_credential(value: &Value) -> Result<(), String> {
    if value["type"] != "oauth"
        || ["access", "refresh", "clientId"]
            .iter()
            .any(|key| value[key].as_str().is_none_or(str::is_empty))
        || value["expires"]
            .as_f64()
            .is_none_or(|n| !n.is_finite() || n <= 0.0)
        || !value["scopes"].as_array().is_some_and(|scopes| {
            scopes
                .iter()
                .any(|scope| scope == "chatgpt.tokens.use.direct")
        })
    {
        return Err("ChatGPT did not authorize subscription usage".into());
    }
    Ok(())
}
fn device_id(app: &AppHandle) -> Result<String, String> {
    let mut prefs = preferences(app)?;
    if let Some(id) = prefs.device_id {
        return Ok(id);
    }
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Unable to create a ChatGPT device identity")?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let id = format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    );
    prefs.device_id = Some(id.clone());
    save_preferences(app, &prefs)?;
    Ok(id)
}
fn helper_directory(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(any(target_os = "ios", target_os = "android")) {
        return Err("ChatGPT sign-in is available on desktop".into());
    }
    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/chatgpt-auth");
        if path.join("auth.mjs").is_file() {
            return Ok(path);
        }
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(|_| "ChatGPT sign-in helper is unavailable")?
        .join("chatgpt-auth"))
}
async fn run_helper(
    app: &AppHandle,
    request: Value,
    cancel: CancellationToken,
    login: bool,
    mut manual_input: Option<tokio::sync::mpsc::Receiver<String>>,
) -> Result<Value, String> {
    let directory = helper_directory(app)?;
    let operation = async {
        let mut child = tokio::process::Command::new(directory.join(if cfg!(windows) {
            "node.exe"
        } else {
            "node"
        }))
        .arg(directory.join("auth.mjs"))
        .env_clear()
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "ChatGPT sign-in helper could not start. Rebuild the desktop app.")?;
        let mut input = child
            .stdin
            .take()
            .ok_or("ChatGPT sign-in helper is unavailable")?;
        input
            .write_all(format!("{request}\n").as_bytes())
            .await
            .map_err(|_| "ChatGPT sign-in helper disconnected")?;
        let mut output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or("ChatGPT sign-in helper is unavailable")?,
        );
        let mut result = None;
        let mut line = Vec::new();
        loop {
            // Bound untrusted helper output, including unexpectedly large credentials.
            let bytes = tokio::select! {
                result = async { tokio::io::AsyncReadExt::take(&mut output, 1_048_577).read_until(b'\n', &mut line).await } => result.map_err(|_| "ChatGPT sign-in helper disconnected")?,
                Some(value) = async { match manual_input.as_mut() { Some(receiver) => receiver.recv().await, None => std::future::pending().await } } => {
                    input.write_all(format!("{}\n", json!({"action":"manual_input", "value":value})).as_bytes()).await.map_err(|_| "ChatGPT sign-in helper disconnected")?;
                    continue;
                }
            };
            if bytes == 0 {
                break;
            }
            if line.len() > 1_048_576 {
                return Err("ChatGPT sign-in response exceeded its limit".to_string());
            }
            let event: Value = serde_json::from_slice(&line)
                .map_err(|_| "ChatGPT sign-in helper returned an invalid response")?;
            line.clear();
            match event["type"].as_str() {
                Some("auth_url") if login => {
                    let url = event["url"]
                        .as_str()
                        .ok_or("ChatGPT sign-in link is missing")?;
                    let parsed =
                        url::Url::parse(url).map_err(|_| "ChatGPT sign-in link is invalid")?;
                    if parsed.scheme() != "https"
                        || parsed.host_str() != Some("auth.openai.com")
                        || parsed.path() != "/api/accounts/authorize"
                    {
                        return Err("ChatGPT sign-in link is invalid".into());
                    }
                    update_progress(app, |progress| {
                        progress.phase = LoginPhase::WaitingForBrowser;
                        progress.browser_url = Some(url.into());
                    });
                    if app.opener().open_url(url, None::<&str>).is_err() {
                        update_progress(app, |progress| {
                            progress.error = Some(
                                "Unable to open your browser. Use Open sign-in page to try again."
                                    .into(),
                            )
                        });
                    }
                }
                Some("progress") if login => update_progress(app, |progress| {
                    progress.phase = LoginPhase::Completing;
                    progress.manual_input = false;
                }),
                Some("manual_input") if login => {
                    update_progress(app, |progress| progress.manual_input = true)
                }
                Some("credential") => {
                    validate_credential(&event["credential"])?;
                    result = Some(event["credential"].clone());
                }
                Some("error") if event["code"] == "port_in_use" => return Err(
                    "Port 1455 is in use by another sign-in. Cancel that sign-in and try again."
                        .into(),
                ),
                Some("error") if !login && event["code"] == "reauthorization_required" => {
                    return Err(SIGN_IN_REQUIRED.into());
                }
                Some("error") => {
                    return Err(if login {
                        "ChatGPT authentication did not complete. Try signing in again."
                    } else {
                        "Unable to refresh ChatGPT access. Try again."
                    }
                    .into())
                }
                _ => return Err("ChatGPT sign-in helper returned an invalid response".into()),
            }
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "ChatGPT sign-in helper disconnected")?;
        drop(input);
        if !status.success() {
            return Err("ChatGPT authentication did not complete. Try signing in again.".into());
        }
        result.ok_or_else(|| "ChatGPT sign-in did not return credentials".into())
    };
    tokio::select! {
        _ = cancel.cancelled() => Err("ChatGPT sign-in cancelled".into()),
        result = tokio::time::timeout(if login { Duration::from_secs(300) } else { Duration::from_secs(30) }, operation) => result.map_err(|_| "ChatGPT authentication timed out. Try again.".to_string())?,
    }
}

#[tauri::command]
pub(crate) fn chat_chatgpt_status(app: AppHandle) -> Result<AuthStatus, String> {
    Ok(AuthStatus {
        method: method(&app)?,
        connected: crate::secrets::has_account(&app, ACCOUNT)?,
        supported: !cfg!(any(target_os = "ios", target_os = "android")),
        login: app
            .state::<ChatGptAuth>()
            .progress
            .lock()
            .map_err(|_| "ChatGPT sign-in is unavailable")?
            .clone(),
    })
}
#[tauri::command]
pub(crate) async fn chat_chatgpt_login(app: AppHandle) -> Result<AuthStatus, String> {
    let state = app.state::<ChatGptAuth>();
    let _guard = state
        .gate
        .try_lock()
        .map_err(|_| "ChatGPT authentication is already in progress")?;
    // Repeated callers must not start OAuth for an existing connection. Invalid
    // refresh credentials are removed only after native confirmation below.
    if crate::secrets::has_account(&app, ACCOUNT)? {
        return chat_chatgpt_status(app.clone());
    }
    let cancel = CancellationToken::new();
    let (sender, receiver) = tokio::sync::mpsc::channel(1);
    *state
        .input
        .lock()
        .map_err(|_| "ChatGPT sign-in is unavailable")? = Some(sender);
    update_progress(&app, |progress| {
        *progress = LoginProgress {
            phase: LoginPhase::Starting,
            ..Default::default()
        }
    });
    *state
        .login
        .lock()
        .map_err(|_| "ChatGPT sign-in is unavailable")? = Some(cancel.clone());
    let result = async {
        let prefs = registered_preferences(&app)?;
        let value = run_helper(
            &app,
            json!({"action":"login", "deviceId":device_id(&app)?, "clientId":prefs.client_id}),
            cancel,
            true,
            Some(receiver),
        )
        .await?;
        update_progress(&app, |progress| {
            progress.phase = LoginPhase::Saving;
            progress.manual_input = false;
        });
        let mut prefs = preferences(&app)?;
        prefs.remember_registration(&value)?;
        // Retain the issued ID even if secure token storage fails. Retrying must
        // reauthorize this registration instead of creating another app entry.
        save_preferences(&app, &prefs)?;
        store(&app, &value)?;
        prefs.method = AuthMethod::Chatgpt;
        save_preferences(&app, &prefs)?;
        Ok::<(), String>(())
    }
    .await;
    update_progress(&app, |progress| {
        *progress = LoginProgress {
            error: result
                .as_ref()
                .err()
                .filter(|error| error.as_str() != "ChatGPT sign-in cancelled")
                .cloned(),
            ..Default::default()
        }
    });
    *state
        .input
        .lock()
        .map_err(|_| "ChatGPT sign-in is unavailable")? = None;
    *state
        .login
        .lock()
        .map_err(|_| "ChatGPT sign-in is unavailable")? = None;
    result?;
    chat_chatgpt_status(app.clone())
}
#[tauri::command]
pub(crate) fn chat_chatgpt_open_browser(app: AppHandle) -> Result<(), String> {
    let state = app.state::<ChatGptAuth>();
    let url = state
        .progress
        .lock()
        .map_err(|_| "ChatGPT sign-in is unavailable")?
        .browser_url
        .clone()
        .ok_or("Start ChatGPT sign-in first")?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Unable to open ChatGPT sign-in in your browser")?;
    update_progress(&app, |progress| progress.error = None);
    Ok(())
}
#[tauri::command]
pub(crate) fn chat_chatgpt_manual_input(app: AppHandle, value: String) -> Result<(), String> {
    let state = app.state::<ChatGptAuth>();
    if value.trim().is_empty() || value.len() > 8192 {
        return Err("Paste the callback URL from your browser".into());
    }
    if !state
        .progress
        .lock()
        .map_err(|_| "ChatGPT sign-in is unavailable")?
        .manual_input
    {
        return Err("ChatGPT is not waiting for a callback".into());
    }
    state
        .input
        .lock()
        .map_err(|_| "ChatGPT sign-in is unavailable")?
        .as_ref()
        .ok_or("Start ChatGPT sign-in first")?
        .try_send(value)
        .map_err(|_| "ChatGPT sign-in input is unavailable".to_string())?;
    update_progress(&app, |progress| progress.manual_input = false);
    Ok(())
}
#[tauri::command]
pub(crate) fn chat_chatgpt_cancel(app: AppHandle) {
    if let Ok(login) = app.state::<ChatGptAuth>().login.lock() {
        if let Some(token) = login.as_ref() {
            token.cancel();
        }
    }
}
#[tauri::command]
pub(crate) async fn chat_set_openai_auth(
    app: AppHandle,
    method: AuthMethod,
) -> Result<AuthStatus, String> {
    let state = app.state::<ChatGptAuth>();
    let _guard = state.gate.lock().await;
    if method == AuthMethod::Chatgpt && !crate::secrets::has_account(&app, ACCOUNT)? {
        return Err("Sign in with ChatGPT first".into());
    }
    let mut prefs = preferences(&app)?;
    prefs.method = method;
    save_preferences(&app, &prefs)?;
    chat_chatgpt_status(app.clone())
}
#[tauri::command]
pub(crate) async fn chat_chatgpt_disconnect(app: AppHandle) -> Result<AuthStatus, String> {
    chat_chatgpt_cancel(app.clone());
    let state = app.state::<ChatGptAuth>();
    let _guard = state.gate.lock().await;
    // Switch explicitly to API-key mode before deleting the independent OAuth record.
    let mut prefs = registered_preferences(&app)?;
    prefs.method = AuthMethod::ApiKey;
    save_preferences(&app, &prefs)?;
    crate::secrets::write_account(&app, ACCOUNT, None)
        .map_err(|_| "Unable to remove ChatGPT credentials")?;
    chat_chatgpt_status(app.clone())
}
/// No fallback between billing methods. Refresh is serialized with login/logout
/// and the rotated token is durably saved before any inference can use it.
pub(crate) async fn resolve(app: &AppHandle) -> Result<(Option<String>, AuthMethod), String> {
    let state = app.state::<ChatGptAuth>();
    let _guard = state.gate.lock().await;
    let selected = method(app)?;
    if selected == AuthMethod::ApiKey {
        return Ok((
            crate::secrets::read_provider_api_key(app, "openai")?,
            selected,
        ));
    }
    let mut value = credential(app)?.ok_or("Sign in with ChatGPT in Settings")?;
    validate_credential(&value)?;
    if value["expires"].as_f64().unwrap_or(0.0) <= chrono::Utc::now().timestamp_millis() as f64 {
        value = refresh_and_store(app, value).await?;
    }
    Ok((
        Some(
            value["access"]
                .as_str()
                .ok_or("ChatGPT credential is invalid")?
                .into(),
        ),
        selected,
    ))
}

// Caller holds the auth gate. Never discard credentials for a temporary failure.
async fn refresh_and_store(app: &AppHandle, value: Value) -> Result<Value, String> {
    match run_helper(
        app,
        json!({"action":"refresh", "credential":value}),
        CancellationToken::new(),
        false,
        None,
    )
    .await
    {
        Ok(refreshed) => {
            store(app, &refreshed)?;
            Ok(refreshed)
        }
        Err(error) => {
            if error == SIGN_IN_REQUIRED {
                registered_preferences(app)?;
                crate::secrets::write_account(app, ACCOUNT, None)
                    .map_err(|_| "Unable to remove expired ChatGPT credentials")?;
            }
            Err(error)
        }
    }
}

/// A rejected access token alone is not proof of revocation. Confirm by refresh
/// under the same gate as login/logout, and ignore a stale response after rotation.
pub(crate) async fn recover_rejected_access(app: &AppHandle, rejected: &str) -> Result<(), String> {
    let state = app.state::<ChatGptAuth>();
    let _guard = state.gate.lock().await;
    let Some(value) = credential(app)? else {
        return Err(SIGN_IN_REQUIRED.into());
    };
    if value["access"].as_str() != Some(rejected) {
        return Ok(());
    }
    refresh_and_store(app, value).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registration_survives_disconnect_and_preferences_reload_without_tokens() {
        // Preferences saved before this fix have no clientId. Adopt the issued
        // registration from the old keyring record before that record is removed.
        let mut prefs: Preferences = serde_json::from_value(json!({
            "method":"chatgpt", "deviceId":"stable-host"
        }))
        .unwrap();
        assert!(prefs.client_id.is_none());
        let value =
            json!({"clientId":"issued", "access":"private-access", "refresh":"private-refresh"});
        prefs.remember_registration(&value).unwrap();
        prefs.method = AuthMethod::ApiKey;
        let saved = serde_json::to_string(&prefs).unwrap();
        assert!(!saved.contains("private-access"));
        assert!(!saved.contains("private-refresh"));
        let mut restarted: Preferences = serde_json::from_str(&saved).unwrap();
        assert_eq!(restarted.client_id.as_deref(), Some("issued"));
        assert_eq!(restarted.device_id.as_deref(), Some("stable-host"));
        assert!(restarted.method == AuthMethod::ApiKey);
        restarted.remember_registration(&value).unwrap();
        restarted.method = AuthMethod::Chatgpt;
        assert_eq!(restarted.client_id.as_deref(), Some("issued"));
    }

    #[test]
    fn sign_in_cannot_replace_or_forget_an_existing_registration() {
        let mut prefs = Preferences::default();
        for id in ["", " ", "dynamic_agent_client"] {
            assert!(prefs
                .remember_registration(&json!({"clientId":id}))
                .is_err());
            assert!(prefs.client_id.is_none());
        }
        prefs
            .remember_registration(&json!({"clientId":"original"}))
            .unwrap();
        assert!(prefs
            .remember_registration(&json!({"clientId":"different"}))
            .is_err());
        assert_eq!(prefs.client_id.as_deref(), Some("original"));
    }

    #[test]
    fn only_complete_subscription_credentials_are_accepted() {
        let value = json!({"type":"oauth","access":"secret","refresh":"rotating","clientId":"issued","expires":1234,"scopes":["chatgpt.tokens.use.direct"]});
        assert!(validate_credential(&value).is_ok());
        for key in ["access", "refresh", "clientId", "expires", "scopes", "type"] {
            let mut missing = value.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(validate_credential(&missing).is_err(), "{key}");
        }
        assert_eq!(
            serde_json::to_string(&AuthMethod::ApiKey).unwrap(),
            "\"apiKey\""
        );
        assert_eq!(
            serde_json::to_string(&AuthMethod::Chatgpt).unwrap(),
            "\"chatgpt\""
        );
    }
}
