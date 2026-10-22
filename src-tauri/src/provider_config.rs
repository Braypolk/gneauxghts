//! Provider routing and metadata; contains no model execution.
use url::Url;
pub(crate) mod connection_failure;
pub(crate) mod local_reasoning;
pub(crate) mod model_metadata;
pub(crate) fn ensure_compatible_chat_supported() -> Result<(), String> {
    if cfg!(target_os = "android") {
        Err("OpenAI-compatible server chat is available on desktop and iOS".to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn openai_api_base_url() -> Result<String, String> {
    // A separate opt-in test build can exercise the Responses wire protocol
    // without live credentials. Ordinary and release builds always use OpenAI.
    #[cfg(all(debug_assertions, feature = "e2e-chat-fixture"))]
    if let Ok(value) = std::env::var("GNEAUXGHTS_OPENAI_FIXTURE_URL") {
        validate_openai_fixture_url(&value)?;
        return Ok(value);
    }
    Ok("https://api.openai.com/v1".to_string())
}

#[cfg(all(debug_assertions, feature = "e2e-chat-fixture"))]
pub(crate) fn validate_openai_fixture_url(value: &str) -> Result<(), String> {
    validate_local_base_url(value)?;
    let parsed = Url::parse(value).map_err(|_| "Invalid fixture URL".to_string())?;
    let loopback = match parsed.host() {
        Some(url::Host::Domain(host)) => host == "localhost",
        Some(url::Host::Ipv4(host)) => host.is_loopback(),
        Some(url::Host::Ipv6(host)) => host.is_loopback(),
        None => false,
    };
    if !loopback {
        return Err("OpenAI protocol fixtures must use a loopback address".to_string());
    }
    Ok(())
}

pub(crate) fn validate_local_base_url(value: &str) -> Result<(), String> {
    let parsed = Url::parse(value.trim())
        .map_err(|_| "Enter a valid OpenAI-compatible base URL".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Local model URLs cannot contain credentials".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Local model URLs cannot contain a query or fragment".to_string());
    }
    parsed
        .host_str()
        .ok_or_else(|| "Local model URL must include a host".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Local model URL must use HTTP or HTTPS".to_string());
    }
    Ok(())
}
