// THROWAWAY: temporarily included in agent_runtime.rs, test builds only.
// Deltas are synthetic answer payloads, never reasoning or executable tool arguments.
#[derive(Default)]
struct PrototypePreview {
    schema: serde_json::Value,
    formatter: Option<String>,
    names: std::collections::HashMap<String, String>,
    arguments: std::collections::HashMap<String, String>,
    preview: String,
    events: Vec<serde_json::Value>,
    started: Option<std::time::Instant>,
    attempts: usize,
}
static PROTOTYPE_PREVIEW: std::sync::Mutex<Option<PrototypePreview>> = std::sync::Mutex::new(None);

pub(crate) fn stream_prototype_begin(schema: serde_json::Value) {
    *PROTOTYPE_PREVIEW.lock().unwrap() = Some(PrototypePreview {
        schema, started: Some(std::time::Instant::now()), ..Default::default()
    });
}
pub(crate) fn stream_prototype_snapshot() -> serde_json::Value {
    let state = PROTOTYPE_PREVIEW.lock().unwrap();
    let state = state.as_ref().unwrap();
    serde_json::json!({"preview":state.preview,"events":state.events,"attempts":state.attempts,
        "argumentStreams":state.arguments,"formatter":state.formatter})
}
fn prototype_observe_wire(request: &rig_core::completion::CompletionRequest) {
    let mut state = PROTOTYPE_PREVIEW.lock().unwrap();
    let Some(state) = state.as_mut() else { return };
    state.attempts += 1;
    let now = state.started.unwrap().elapsed().as_millis();
    state.events.push(serde_json::json!({"type":"attemptReset","millis":now}));
    state.preview.clear();
    state.names.clear();
    state.arguments.clear();
    // Exact existing schema matching handles collision-renamed formatter names.
    state.formatter = usage_context::result_formatter_name(request, Some(&state.schema));
}
fn prototype_observe_item<R>(item: &rig_agent::agent::MultiTurnStreamItem<R>) {
    use rig_core::streaming::{StreamedAssistantContent, ToolCallDeltaContent};
    let rig_agent::agent::MultiTurnStreamItem::StreamAssistantItem(
        StreamedAssistantContent::ToolCallDelta { internal_call_id, content, .. }
    ) = item else { return };
    let mut state = PROTOTYPE_PREVIEW.lock().unwrap();
    let Some(state) = state.as_mut() else { return };
    let now = state.started.unwrap().elapsed().as_millis();
    match content {
        ToolCallDeltaContent::Name(name) => { state.names.insert(internal_call_id.clone(), name.clone()); },
        ToolCallDeltaContent::Delta(delta) => {
            if state.names.get(internal_call_id) != state.formatter.as_ref() || state.formatter.is_none() { return }
            let raw = state.arguments.entry(internal_call_id.clone()).or_default();
            raw.push_str(delta);
            let parsed = prototype_partial_text(raw);
            state.events.push(serde_json::json!({"type":"formatterDelta","millis":now,"delta":delta}));
            match parsed {
                Ok(text) if text != state.preview => {
                    let append = text.strip_prefix(&state.preview).map(str::to_string);
                    state.events.push(serde_json::json!({"type":"draftText","millis":now,
                        "text":text,"append":append,"links":[],"provisional":true}));
                    state.preview = text;
                },
                Err(()) => {
                    state.preview.clear();
                    state.events.push(serde_json::json!({"type":"draftRejected","millis":now,"links":[]}));
                },
                _ => {},
            }
        },
    }
}

// Prefix parser for the prototype's known JSON shape. Strings are decoded before
// exposure, including split escapes and UTF-16 surrogate pairs. Keys/source IDs
// never become draft text. Reparsing is deliberately simple and prototype-only.
pub(crate) fn prototype_partial_text(raw: &str) -> Result<String, ()> {
    #[derive(Clone)] enum Part { Key(String), Index }
    struct Prefix<'a> { raw: &'a str, pos: usize, texts: Vec<String> }
    impl Prefix<'_> {
        fn whitespace(&mut self) { while self.raw.as_bytes().get(self.pos).is_some_and(u8::is_ascii_whitespace) { self.pos += 1; } }
        fn string(&mut self) -> Result<(String, bool), ()> {
            if self.raw.as_bytes().get(self.pos) != Some(&b'"') { return Err(()) }
            self.pos += 1;
            let mut decoded = String::new();
            while let Some(&byte) = self.raw.as_bytes().get(self.pos) {
                if byte == b'"' { self.pos += 1; return Ok((decoded, true)) }
                if byte < 0x20 { return Err(()) }
                if byte == b'\\' {
                    let start = self.pos;
                    let Some(&escape) = self.raw.as_bytes().get(start + 1) else { return Ok((decoded, false)) };
                    let mut length = if escape == b'u' { 6 } else { 2 };
                    if start + length > self.raw.len() { return Ok((decoded, false)) }
                    if escape == b'u' {
                        let code = u16::from_str_radix(self.raw.get(start+2..start+6).ok_or(())?,16).map_err(|_| ())?;
                        if (0xD800..=0xDBFF).contains(&code) {
                            length = 12;
                            if start + length > self.raw.len() { return Ok((decoded, false)) }
                        }
                    }
                    let chunk = self.raw.get(start..start+length).ok_or(())?;
                    decoded.push_str(&serde_json::from_str::<String>(&format!("\"{chunk}\"")).map_err(|_| ())?);
                    self.pos += length;
                } else {
                    let ch = self.raw[self.pos..].chars().next().ok_or(())?;
                    decoded.push(ch); self.pos += ch.len_utf8();
                }
            }
            Ok((decoded, false))
        }
        fn value(&mut self, path: &mut Vec<Part>) -> Result<bool, ()> {
            self.whitespace();
            let Some(&byte) = self.raw.as_bytes().get(self.pos) else { return Ok(false) };
            match byte {
                b'"' => {
                    let (text, complete) = self.string()?;
                    if matches!(path.as_slice(), [Part::Key(root), Part::Index, Part::Key(key)] if root=="segments" && key=="text") { self.texts.push(text); }
                    Ok(complete)
                },
                b'{' => {
                    self.pos += 1; self.whitespace();
                    if self.raw.as_bytes().get(self.pos)==Some(&b'}') { self.pos+=1; return Ok(true) }
                    loop {
                        self.whitespace(); if self.pos==self.raw.len() { return Ok(false) }
                        let (key,complete)=self.string()?; if !complete { return Ok(false) }
                        self.whitespace(); if self.pos==self.raw.len() { return Ok(false) }
                        if self.raw.as_bytes()[self.pos]!=b':' { return Err(()) } self.pos+=1;
                        path.push(Part::Key(key)); let complete=self.value(path)?; path.pop();
                        if !complete { return Ok(false) } self.whitespace();
                        match self.raw.as_bytes().get(self.pos) { Some(b',')=>self.pos+=1, Some(b'}')=>{self.pos+=1;return Ok(true)},None=>return Ok(false),_=>return Err(()) }
                    }
                },
                b'[' => {
                    self.pos+=1; self.whitespace();
                    if self.raw.as_bytes().get(self.pos)==Some(&b']') {self.pos+=1;return Ok(true)}
                    loop {
                        path.push(Part::Index);let complete=self.value(path)?;path.pop();
                        if !complete{return Ok(false)}self.whitespace();
                        match self.raw.as_bytes().get(self.pos){Some(b',')=>self.pos+=1,Some(b']')=>{self.pos+=1;return Ok(true)},None=>return Ok(false),_=>return Err(())}
                    }
                },
                // Primitive non-string values are not answer text. A partial
                // primitive remains pending; full validation rejects wrong types.
                _ => {
                    let start=self.pos;
                    while self.raw.as_bytes().get(self.pos).is_some_and(|b| !b",]} \t\r\n".contains(b)){self.pos+=1;}
                    if self.pos==self.raw.len(){return Ok(false)}
                    serde_json::from_str::<serde_json::Value>(&self.raw[start..self.pos]).map_err(|_| ())?;
                    Ok(true)
                },
            }
        }
    }
    let mut parser=Prefix{raw,pos:0,texts:vec![]};
    let complete=parser.value(&mut vec![])?;
    if complete {parser.whitespace();if parser.pos!=raw.len(){return Err(())}}
    Ok(parser.texts.join("\n\n"))
}
