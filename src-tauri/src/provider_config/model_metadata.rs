//! Bounded, nonredirecting transport for native model metadata.
use futures_util::StreamExt;
use serde_json::Value;

pub(crate) struct ModelMetadataClient {
    client: Option<reqwest::Client>,
}

impl ModelMetadataClient {
    pub(crate) fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok(),
        }
    }

    pub(crate) async fn fetch(&self, base: &str, key: Option<&str>) -> Option<Value> {
        let mut url = url::Url::parse(base).ok()?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return None;
        }
        url.set_path("/api/v1/models");
        url.set_query(None);
        url.set_fragment(None);
        let mut request = self.client.as_ref()?.get(url);
        if let Some(key) = key {
            request = request.bearer_auth(key);
        }
        let mut stream = request
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.ok()?;
            if body.len().saturating_add(chunk.len()) > 256_000 {
                return None;
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).ok()
    }
}
