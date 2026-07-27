//! Application-owned access to credentials kept in the operating system keyring.
//!
//! Keep this module deliberately narrow: the webview can ask whether the OpenAI
//! key exists or replace it through the chat commands, but it can never read the
//! credential back over IPC.

use tauri::AppHandle;
use tauri_plugin_keyring_store::KeyringExt;

pub(crate) const KEYRING_SERVICE: &str = "com.braypolkinghorne.gneauxghts.credentials";
const OPENAI_API_KEY_ACCOUNT: &str = "provider.openai.api-key";

/// Reports whether an OpenAI credential is configured without returning its
/// secret value. On macOS this performs a metadata-only Keychain query, so
/// opening Settings does not request permission to decrypt the credential.
pub(crate) fn has_openai_api_key(_app: &AppHandle) -> Result<bool, String> {
    if development_api_key_override().is_some() {
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        return has_openai_api_key_macos();
    }

    #[cfg(not(target_os = "macos"))]
    _app
        .keyring()
        .store
        .exists_nonempty(OPENAI_API_KEY_ACCOUNT)
        .map_err(|error| format!("Unable to inspect secure credential storage: {error}"))
}

#[cfg(target_os = "macos")]
fn has_openai_api_key_macos() -> Result<bool, String> {
    use security_framework::item::{ItemClass, ItemSearchOptions};
    use security_framework_sys::base::errSecItemNotFound;

    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(KEYRING_SERVICE)
        .account(OPENAI_API_KEY_ACCOUNT)
        .limit(1_i64);

    match query.search() {
        Ok(_) => Ok(true),
        Err(error) if error.code() == errSecItemNotFound => Ok(false),
        Err(error) => Err(format!(
            "Unable to inspect secure credential storage: {error}"
        )),
    }
}

pub(crate) fn read_openai_api_key(app: &AppHandle) -> Result<Option<String>, String> {
    if let Some(key) = development_api_key_override() {
        return Ok(Some(key));
    }

    app.keyring()
        .store
        .get_password(OPENAI_API_KEY_ACCOUNT)
        .map(|value| value.filter(|key| !key.trim().is_empty()))
        .map_err(|error| format!("Unable to access secure credential storage: {error}"))
}

pub(crate) fn set_openai_api_key(app: &AppHandle, value: &str) -> Result<(), String> {
    let value = value.trim();
    let store = &app.keyring().store;
    if value.is_empty() {
        return store
            .delete(OPENAI_API_KEY_ACCOUNT)
            .map_err(|error| format!("Unable to remove API key from secure storage: {error}"));
    }

    store
        .set_password(OPENAI_API_KEY_ACCOUNT, value)
        .map_err(|error| format!("Unable to store API key securely: {error}"))
}

#[cfg(debug_assertions)]
fn development_api_key_override() -> Option<String> {
    std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[cfg(not(debug_assertions))]
fn development_api_key_override() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_and_account_are_namespaced() {
        assert!(KEYRING_SERVICE.contains("gneauxghts"));
        assert!(OPENAI_API_KEY_ACCOUNT.starts_with("provider."));
    }
}
