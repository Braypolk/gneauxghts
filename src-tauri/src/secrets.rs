//! Application-owned access to credentials kept in the operating system keyring.
//!
//! Keep this module deliberately narrow: the webview can ask whether a provider
//! key exists or replace it through the chat commands, but it can never read the
//! credential back over IPC.

use tauri::AppHandle;
use tauri_plugin_keyring_store::KeyringExt;

#[cfg(not(feature = "e2e-wdio"))]
pub(crate) const KEYRING_SERVICE: &str = "com.braypolkinghorne.gneauxghts.credentials";
#[cfg(feature = "e2e-wdio")]
const E2E_KEYRING_SERVICE: &str = "com.braypolkinghorne.gneauxghts-e2e.credentials";

pub(crate) fn keyring_service() -> &'static str {
    #[cfg(feature = "e2e-wdio")]
    {
        return E2E_KEYRING_SERVICE;
    }

    #[cfg(not(feature = "e2e-wdio"))]
    KEYRING_SERVICE
}

fn api_key_account(provider: &str) -> Result<&'static str, String> {
    match provider.trim() {
        // Keep the existing OpenAI account name so current installations do not
        // need a credential migration.
        "openai" => Ok("provider.openai.api-key"),
        "local" => Ok("provider.local.api-key"),
        other => Err(format!("Unsupported chat provider '{other}'")),
    }
}

/// Reports whether a provider credential is configured without returning its
/// secret value. On macOS this performs a metadata-only Keychain query, so
/// opening Settings does not request permission to decrypt the credential.
pub(crate) fn has_provider_api_key(_app: &AppHandle, provider: &str) -> Result<bool, String> {
    let account = api_key_account(provider)?;
    if development_api_key_override(provider).is_some() {
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        has_provider_api_key_macos(account)
    }

    #[cfg(not(target_os = "macos"))]
    _app.keyring()
        .store
        .exists_nonempty(account)
        .map_err(|error| format!("Unable to inspect secure credential storage: {error}"))
}

#[cfg(target_os = "macos")]
fn has_provider_api_key_macos(account: &str) -> Result<bool, String> {
    use security_framework::item::{ItemClass, ItemSearchOptions};
    use security_framework_sys::base::errSecItemNotFound;

    let mut query = ItemSearchOptions::new();
    query
        .class(ItemClass::generic_password())
        .service(keyring_service())
        .account(account)
        .limit(1_i64);

    match query.search() {
        Ok(_) => Ok(true),
        Err(error) if error.code() == errSecItemNotFound => Ok(false),
        Err(error) => Err(format!(
            "Unable to inspect secure credential storage: {error}"
        )),
    }
}

pub(crate) fn read_provider_api_key(
    app: &AppHandle,
    provider: &str,
) -> Result<Option<String>, String> {
    let account = api_key_account(provider)?;
    if let Some(key) = development_api_key_override(provider) {
        return Ok(Some(key));
    }

    app.keyring()
        .store
        .get_password(account)
        .map(|value| value.filter(|key| !key.trim().is_empty()))
        .map_err(|error| format!("Unable to access secure credential storage: {error}"))
}

pub(crate) fn set_provider_api_key(
    app: &AppHandle,
    provider: &str,
    value: &str,
) -> Result<(), String> {
    let account = api_key_account(provider)?;
    let value = value.trim();
    let store = &app.keyring().store;
    if value.is_empty() {
        return store
            .delete(account)
            .map_err(|error| format!("Unable to remove API key from secure storage: {error}"));
    }

    store
        .set_password(account, value)
        .map_err(|error| format!("Unable to store API key securely: {error}"))
}

#[cfg(debug_assertions)]
fn development_api_key_override(provider: &str) -> Option<String> {
    let variable = match provider {
        "openai" => "OPENAI_API_KEY",
        "local" => "GNEAUXGHTS_LOCAL_API_KEY",
        _ => return None,
    };
    std::env::var(variable)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[cfg(not(debug_assertions))]
fn development_api_key_override(_provider: &str) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_and_accounts_are_namespaced() {
        assert!(keyring_service().contains("gneauxghts"));
        assert_eq!(
            api_key_account("openai").unwrap(),
            "provider.openai.api-key"
        );
        assert_eq!(api_key_account("local").unwrap(), "provider.local.api-key");
    }

    #[test]
    fn unsupported_provider_has_no_credential_account() {
        assert!(api_key_account("unknown").is_err());
    }
}
