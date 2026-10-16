//! Explicit generated-fixture crashes at native command/transport boundaries.
//! No Pi lifecycle state, credentials, or upstream hooks live here.

pub(crate) fn armed(boundary: &str, content: &str) -> Option<String> {
    #[cfg(feature = "e2e-wdio")]
    {
        if !matches!(boundary, "prepared-review" | "transport-completed")
            || std::env::var("PI_PROTOTYPE_INTERACTIVE_GATE").as_deref() != Ok("true")
            || std::env::var("PI_PROTOTYPE_E2E_CRASH_BOUNDARY").as_deref() != Ok(boundary)
        { return None; }
        let fixture = std::env::var("PI_PROTOTYPE_HTTP_FIXTURE").ok()?;
        let endpoint = url::Url::parse(&fixture).ok()?;
        if endpoint.scheme() != "http" || endpoint.host_str() != Some("127.0.0.1")
            || !endpoint.username().is_empty() || endpoint.password().is_some()
            || endpoint.query().is_some() || endpoint.fragment().is_some()
        { return None; }
        let scope = std::env::var("PI_PROTOTYPE_E2E_CRASH_SCOPE").ok()?;
        if !(8..=64).contains(&scope.len()) || !scope.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || !content.contains(&format!("PI_E2E_CRASH_{scope}"))
        { return None; }
        Some(scope)
    }
    #[cfg(not(feature = "e2e-wdio"))]
    { let _ = (boundary, content); None }
}

pub(crate) fn crash(boundary: &str, scope: &str, detail: serde_json::Value) -> Result<(), String> {
    #[cfg(feature = "e2e-wdio")]
    {
        use std::io::Write;
        // Revalidate at the actual crash, not only when transport was admitted.
        if armed(boundary, &format!("PI_E2E_CRASH_{scope}")).as_deref() != Some(scope) {
            return Err("Synthetic crash scope changed before native boundary".into());
        }
        let directory = crate::state::app_data_dir()?.join("PROTOTYPE-wipe-me");
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let receipt = serde_json::json!({"boundary":boundary,"scope":scope,"pid":std::process::id(),
            "atMillis":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|error|error.to_string())?.as_millis(),
            "detail":detail});
        let mut file = std::fs::File::create(directory.join(format!("e2e-crash-{boundary}.json"))).map_err(|error|error.to_string())?;
        file.write_all(serde_json::to_string_pretty(&receipt).map_err(|error|error.to_string())?.as_bytes()).map_err(|error|error.to_string())?;
        file.sync_all().map_err(|error|error.to_string())?;
        std::process::exit(86);
    }
    #[cfg(not(feature = "e2e-wdio"))]
    { let _ = (boundary, scope, detail); Err("Native crash fixture requires e2e-wdio".into()) }
}

/// Scoped synthetic transport only: withhold protocol terminal events while
/// releasing complete ordinary SSE events. EOF is then an observable native
/// completion boundary before the webview can persist a terminal Pi result.
#[derive(Default)]
pub(crate) struct TerminalBarrier {
    pending: Vec<u8>,
    pub(crate) withheld_events: usize,
}
impl TerminalBarrier {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() > 262_144 { return Err("Synthetic terminal barrier exceeds bound".into()); }
        let mut released = Vec::new();
        while let Some(end) = self.pending.windows(2).position(|bytes| bytes == b"\n\n") {
            let event: Vec<u8> = self.pending.drain(..end + 2).collect();
            let text = std::str::from_utf8(&event).map_err(|_| "Synthetic SSE is not UTF-8")?;
            let terminal = text.lines().filter_map(|line| line.strip_prefix("data: ")).any(|data| {
                if data.trim() == "[DONE]" { return true; }
                let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else { return false; };
                matches!(value["type"].as_str(), Some("response.completed" | "response.output_item.done"))
                    || value["choices"].as_array().is_some_and(|choices| choices.iter().any(|choice| !choice["finish_reason"].is_null()))
            });
            if terminal { self.withheld_events += 1; } else { released.push(event); }
        }
        Ok(released)
    }
    pub(crate) fn is_complete(&self) -> bool { self.pending.is_empty() && self.withheld_events > 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_sse_releases_partial_events_and_withholds_terminal_events() {
        let mut barrier = TerminalBarrier::default();
        assert!(barrier.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n").unwrap().is_empty());
        let frames = barrier.push(b"\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").unwrap();
        assert_eq!(frames.len(), 1); assert_eq!(barrier.withheld_events, 2); assert!(barrier.is_complete());
    }
    #[test]
    fn responses_output_and_terminal_completion_cannot_escape_barrier() {
        let mut barrier = TerminalBarrier::default();
        let frames = barrier.push(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: {\"type\":\"response.output_item.done\"}\n\ndata: {\"type\":\"response.completed\"}\n\n").unwrap();
        assert_eq!(frames.len(), 1); assert_eq!(barrier.withheld_events, 2); assert!(barrier.is_complete());
    }
}
