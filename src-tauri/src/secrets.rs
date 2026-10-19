//! Application-owned access to credentials kept in the operating system keyring.
//!
//! Keep this module deliberately narrow: the webview can ask whether a provider
//! key exists or replace it through the chat commands, but it can never read the
//! credential back over IPC.

use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_keyring_store::KeyringExt;

/// One lazy native cache per application process. The OS store remains durable
/// authority; successful writes update this cache only after persistence. Holding
/// the lock across store access coalesces concurrent cold reads and prevents a
/// late read from resurrecting a removed/replaced credential.
#[derive(Default)]
pub(crate) struct CredentialStore(Mutex<HashMap<String, Option<String>>>);

impl CredentialStore {
    fn read(
        &self,
        account: &str,
        load: impl FnOnce() -> Result<Option<String>, String>,
    ) -> Result<Option<String>, String> {
        let mut cache = self
            .0
            .lock()
            .map_err(|_| "Secure credential access is unavailable")?;
        if let Some(value) = cache.get(account) {
            return Ok(value.clone());
        }
        let value = load()?;
        cache.insert(account.into(), value.clone());
        Ok(value)
    }

    fn write(
        &self,
        account: &str,
        value: Option<String>,
        persist: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut cache = self
            .0
            .lock()
            .map_err(|_| "Secure credential access is unavailable")?;
        // A failed removal/replacement must not leave a stale cached secret.
        cache.remove(account);
        persist()?;
        cache.insert(account.into(), value);
        Ok(())
    }
}

pub(crate) fn read_account(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
    let load = || {
        app.keyring()
            .store
            .get_password(account)
            .map_err(|_| "Unable to access secure credential storage".into())
    };
    // Mobile retains its existing per-read protected-storage policy (including
    // iOS WhenUnlockedThisDeviceOnly); this session cache is a desktop behavior.
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        load()
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        app.state::<CredentialStore>().read(account, load)
    }
}

pub(crate) fn write_account(
    app: &AppHandle,
    account: &str,
    value: Option<&str>,
) -> Result<(), String> {
    let persist = || {
        match value {
            Some(value) => app.keyring().store.set_password(account, value),
            None => app.keyring().store.delete(account),
        }
        .map_err(|_| "Unable to update secure credential storage".into())
    };
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        persist()
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        app.state::<CredentialStore>()
            .write(account, value.map(String::from), persist)
    }
}

#[cfg(not(feature = "e2e-wdio"))]
pub(crate) const KEYRING_SERVICE: &str = "com.braypolkinghorne.gneauxghts.credentials";
#[cfg(feature = "e2e-wdio")]
const E2E_KEYRING_SERVICE: &str = "com.braypolkinghorne.gneauxghts-e2e.credentials";

pub(crate) fn keyring_service() -> &'static str {
    #[cfg(feature = "e2e-wdio")]
    {
        E2E_KEYRING_SERVICE
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

    has_account(_app, account)
}

pub(crate) fn has_account(_app: &AppHandle, account: &str) -> Result<bool, String> {
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

    read_account(app, account).map(|value| value.filter(|key| !key.trim().is_empty()))
}

pub(crate) fn set_provider_api_key(
    app: &AppHandle,
    provider: &str,
    value: &str,
) -> Result<(), String> {
    let account = api_key_account(provider)?;
    let value = value.trim();
    write_account(app, account, (!value.is_empty()).then_some(value))
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
    fn concurrent_requests_unlock_each_account_only_once_per_process() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Barrier,
        };
        let cache = Arc::new(CredentialStore::default());
        let reads = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let (cache, reads, start) = (cache.clone(), reads.clone(), start.clone());
                std::thread::spawn(move || {
                    start.wait();
                    for _ in 0..3 {
                        assert_eq!(
                            cache
                                .read("subscription", || {
                                    reads.fetch_add(1, Ordering::SeqCst);
                                    Ok(Some("test-access".into()))
                                })
                                .unwrap()
                                .as_deref(),
                            Some("test-access")
                        );
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        assert_eq!(
            cache
                .read("api-key", || {
                    reads.fetch_add(1, Ordering::SeqCst);
                    Ok(Some("independent".into()))
                })
                .unwrap()
                .as_deref(),
            Some("independent")
        );
        assert_eq!(reads.load(Ordering::SeqCst), 2);
        // Restart must re-enter OS storage; this cache is never persisted.
        CredentialStore::default()
            .read("subscription", || {
                reads.fetch_add(1, Ordering::SeqCst);
                Ok(None)
            })
            .unwrap();
        assert_eq!(reads.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn rotation_removal_and_denied_access_do_not_reuse_stale_credentials() {
        let cache = CredentialStore::default();
        assert!(cache
            .read("subscription", || Err("access denied".into()))
            .is_err());
        assert_eq!(
            cache
                .read("subscription", || Ok(Some("old".into())))
                .unwrap()
                .as_deref(),
            Some("old")
        );
        cache
            .write("subscription", Some("rotated".into()), || Ok(()))
            .unwrap();
        assert_eq!(
            cache
                .read("subscription", || panic!(
                    "rotation must reuse the newly persisted value"
                ))
                .unwrap()
                .as_deref(),
            Some("rotated")
        );
        cache.write("subscription", None, || Ok(())).unwrap();
        assert_eq!(
            cache
                .read("subscription", || panic!(
                    "deleted credentials must stay absent"
                ))
                .unwrap(),
            None
        );
        assert!(cache
            .write("subscription", Some("unsaved".into()), || Err(
                "store denied".into()
            ))
            .is_err());
        assert_eq!(cache.read("subscription", || Ok(None)).unwrap(), None);
    }

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
