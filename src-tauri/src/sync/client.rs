use super::{SYNC_HTTP_CONNECT_TIMEOUT, SYNC_HTTP_REQUEST_TIMEOUT};
use reqwest::blocking::Client;

pub(super) fn build_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(SYNC_HTTP_CONNECT_TIMEOUT)
        .timeout(SYNC_HTTP_REQUEST_TIMEOUT)
        .build()
        .map_err(|err| err.to_string())
}

pub(super) fn authorized_client(
    sync_base_url: &str,
    session_token: &str,
) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(SYNC_HTTP_CONNECT_TIMEOUT)
        .timeout(SYNC_HTTP_REQUEST_TIMEOUT)
        .default_headers(
            [(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&format!("Bearer {session_token}"))
                    .map_err(|err| err.to_string())?,
            )]
            .into_iter()
            .collect(),
        )
        .build()
        .map_err(|err| err.to_string())
        .map(|client| {
            let _ = sync_base_url;
            client
        })
}

pub(super) fn sync_url(sync_base_url: &str, path: &str) -> Result<String, String> {
    Ok(format!("{}{}", normalize_base_url(sync_base_url)?, path))
}

pub(super) fn normalize_base_url(sync_base_url: &str) -> Result<String, String> {
    let trimmed = sync_base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Sync server URL is required".to_string());
    }
    Ok(trimmed.to_string())
}
