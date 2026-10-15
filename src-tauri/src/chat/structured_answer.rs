//! Run-local literal drafts and strict final answers. No draft is durable evidence.
use super::{citations::PassageReferences, ChatSource};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
const MAX_BYTES: usize = 65_536;

#[derive(Default)]
pub(super) struct Draft {
    attempt: usize,
    raw: String,
    text: String,
    rejected: bool,
}
impl Draft {
    pub(super) fn update(&mut self, attempt: usize, delta: Option<&str>) -> Option<String> {
        if attempt < self.attempt || attempt == 0 {
            return None;
        }
        if delta.is_none() || attempt > self.attempt {
            *self = Self {
                attempt,
                ..Default::default()
            };
            if delta.is_none() {
                return Some(String::new());
            }
        }
        if self.rejected {
            return None;
        }
        let delta = delta.unwrap_or_default();
        if self.raw.len().saturating_add(delta.len()) > MAX_BYTES {
            self.rejected = true;
            self.text.clear();
            return Some(String::new());
        }
        self.raw.push_str(delta);
        match partial_text(&self.raw) {
            Ok(text) if text != self.text => {
                self.text = text.clone();
                Some(text)
            }
            Ok(_) => None,
            Err(()) => {
                self.rejected = true;
                self.text.clear();
                Some(String::new())
            }
        }
    }
}

// Readable schema; source identities are issued by reads later in the same run.
pub(crate) fn schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["segments"],"properties":{
    "segments":{"type":"array","minItems":1,"maxItems":24,"items":{"type":"object",
    "additionalProperties":false,"required":["text","sources"],"properties":{
        "text":{"type":"string","minLength":1},
        "sources":{"type":"array","maxItems":24,"uniqueItems":true,
            "items":{"type":"string","pattern":"^S[1-9][0-9]*$"}}
    }}}}})
}
pub(super) const INSTRUCTIONS: &str = "Return the final answer as segments. Each segment has Markdown text and sources: an array copied exactly from evidence reads' sourceId fields. Only the current formatter's allowed source IDs are selectable. Discovery evidenceId and noteId fields are retrieval selectors, never answer source IDs. Put each note-supported claim beside its supporting sources; use separate segments for claims with different support. Put no note citation markers or note links inside text. Use sources: [] for conversation-only text, uncertainty, or text supported by web links. Keep web citations as Markdown HTTPS links beside their claims. Do not invent or renumber source IDs. Return no text outside the result formatter.";

/// Constrain the app's answer formatter, never a worker's selection schema or
/// executable tool. Empty arrays remain valid before evidence has been read.
pub(crate) fn constrain_sources(parameters: &mut Value, ids: Vec<String>) {
    let sources = &mut parameters["properties"]["segments"]["items"]["properties"]["sources"];
    sources["items"].as_object_mut().unwrap().remove("enum");
    sources["maxItems"] = json!(if ids.is_empty() { 0 } else { 24 });
    if !ids.is_empty() {
        sources["items"]["enum"] = json!(ids);
    }
}

/// Strip only our run-local selection annotation when matching the static
/// formatter or fingerprinting configuration across context compactions.
pub(crate) fn unconstrained_schema(parameters: &Value) -> Option<Value> {
    let mut original = parameters.clone();
    let sources = original
        .get_mut("properties")?
        .get_mut("segments")?
        .get_mut("items")?
        .get_mut("properties")?
        .get_mut("sources")?;
    sources.get_mut("items")?.as_object_mut()?.remove("enum");
    if sources.get("maxItems") == Some(&json!(0)) {
        sources["maxItems"] = json!(24);
    }
    (original == schema()).then_some(original)
}

pub(crate) fn normalize_source_choices(configuration: &mut Value) -> u64 {
    let Some(tool) = configuration
        .get_mut("tools")
        .and_then(Value::as_array_mut)
        .and_then(|tools| tools.last_mut())
    else {
        return 0;
    };
    let Some(schema) = unconstrained_schema(&tool["parameters"]) else {
        return 0;
    };
    let added_bytes = tool["parameters"]
        .to_string()
        .len()
        .saturating_sub(schema.to_string().len()) as u64;
    tool["parameters"] = schema;
    added_bytes
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Answer {
    segments: Vec<Segment>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Segment {
    text: String,
    sources: Vec<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CitationAssociation {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) links: Vec<String>,
}

#[cfg(test)]
pub(crate) fn render(
    raw: &str,
    references: &PassageReferences,
    sources: &[ChatSource],
) -> Result<(String, Vec<ChatSource>), String> {
    render_with_associations(raw, references, sources).map(|(text, sources, _)| (text, sources))
}

pub(crate) fn render_with_associations(
    raw: &str,
    references: &PassageReferences,
    sources: &[ChatSource],
) -> Result<(String, Vec<ChatSource>, Vec<CitationAssociation>), String> {
    if raw.len() > MAX_BYTES {
        return Err("Structured answer exceeds the size limit".into());
    }
    let answer: Answer =
        serde_json::from_str(raw).map_err(|_| "The model returned an invalid structured answer")?;
    if answer.segments.is_empty() || answer.segments.len() > 24 {
        return Err("Invalid answer segment count".into());
    }
    let mut selected = Vec::new();
    let mut delivered = HashMap::new();
    let mut blocks = Vec::new();
    let mut associations = Vec::new();
    let mut offset = 0;
    for segment in answer.segments {
        if segment.text.trim().is_empty() || segment.sources.len() > 24 {
            return Err("Invalid answer segment".into());
        }
        if references.render(&segment.text, &[]) != segment.text {
            return Err("Note citations must be selected in segment sources".into());
        }
        let mut ids = HashSet::new();
        let mut links = Vec::new();
        let mut unavailable = false;
        for id in segment.sources {
            if !ids.insert(id.clone()) {
                return Err("Duplicate answer source".into());
            }
            let number = id.strip_prefix('S').and_then(|n| n.parse::<usize>().ok());
            if !number.is_some_and(|n| n > 0 && id == format!("S{n}")) {
                return Err("Invalid answer source ID".into());
            }
            if references.passage_id(&id).is_none() {
                // An invented selection grants no source authority. Match the
                // ordinary-text citation path's visible unavailable marker
                // instead of discarding every valid segment in the answer.
                unavailable = true;
                continue;
            }
            let source = references
                .source(&id, sources)
                .ok_or("An answer source is stale or no longer allowed")?;
            let number = delivered.entry(id).or_insert_with(|| {
                selected.push(source.clone());
                selected.len()
            });
            let passage = source
                .passage
                .as_ref()
                .ok_or("Passage identity unavailable")?;
            links.push(format!("[Source {number}](passage:{})", passage.id));
        }
        if unavailable {
            links.push("[citation unavailable]".into());
        }
        let mut text = segment.text.trim().to_string();
        if !links.is_empty() {
            // Preserve block Markdown (lists, tables, code) rather than append a
            // citation inside the last list item, table cell, or fenced block.
            text.push_str(
                if text.contains('\n')
                    || ["- ", "* ", "+ ", ">", "#"]
                        .iter()
                        .any(|prefix| text.starts_with(prefix))
                    || text.starts_with("1.")
                {
                    "\n\n"
                } else {
                    " "
                },
            );
            text.push_str(&links.join(" "));
        }
        associations.push(CitationAssociation {
            start: offset,
            end: offset + segment.text.trim().len(),
            links,
        });
        offset += text.len() + 2;
        blocks.push(text);
    }
    Ok((blocks.join("\n\n"), selected, associations))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> ChatSource {
        ChatSource {
            kind: "passage".into(),
            note_id: Some("note".into()),
            note_path: Some("Note.md".into()),
            title: "Note".into(),
            excerpt: "Verified bytes".into(),
            url: None,
            anchor: Some("proof".into()),
            revision: None,
            passage: Some(crate::services::evidence::PassageCitation {
                id: "proof".into(),
                note_id: "note".into(),
                content_hash: "hash".into(),
                location: "body".into(),
                start: 0,
                end: 14,
                excerpt: "Verified bytes".into(),
                revisions: vec![],
                historical: None,
            }),
        }
    }
    #[test]
    fn structured_answer_validates_ids_and_preserves_markdown_blocks() {
        let mut refs = PassageReferences::default();
        refs.register("proof");
        let sources = [source()];
        let raw = json!({"segments":[
            {"text":"**Confirmed**","sources":["S1"]},
            {"text":"| Task | Status |\n| --- | --- |\n| Deploy | Done |","sources":["S1"]},
            {"text":"- First\n- Second","sources":[]},
            {"text":"I cannot establish a date.","sources":[]}
        ]})
        .to_string();
        let (text, selected) = render(&raw, &refs, &sources).unwrap();
        assert!(text.starts_with("**Confirmed** [Source 1](passage:proof)"));
        assert!(text.contains("| Deploy | Done |\n\n[Source 1](passage:proof)"));
        assert!(text.contains("- First\n- Second\n\nI cannot establish a date."));
        assert_eq!(selected.len(), 1);
        for invalid in [
            json!({"segments":[]}),
            json!({"segments":[{"text":"Answer","sources":["[S1]"]}]}),
            json!({"segments":[{"text":"Answer","sources":["S01"]}]}),
            json!({"segments":[{"text":"Answer","sources":["S1","S1"]}]}),
            json!({"segments":[{"text":"Answer [S1]","sources":["S1"]}]}),
            json!({"segments":[{"text":"Answer","sources":[],"extra":true}]}),
            json!({"segments":[{"text":" ","sources":[]}]}),
        ] {
            assert!(
                render(&invalid.to_string(), &refs, &sources).is_err(),
                "{invalid}"
            );
        }
        assert!(render(&raw, &refs, &[]).is_err());
        assert!(render(r#"{"segments":[],"segments":[]}"#, &refs, &sources).is_err());
        assert!(render("broken JSON", &refs, &sources).is_err());
    }
    #[test]
    fn unissued_selections_keep_text_and_valid_sources_without_inventing_links() {
        let mut refs = PassageReferences::default();
        refs.register("proof");
        let raw = json!({"segments":[
            {"text":"Conversation context","sources":[]},
            {"text":"First claim","sources":["S999","S1","S998"]},
            {"text":"Unverified claim","sources":["S999"]},
            {"text":"Last claim","sources":["S1"]}
        ]})
        .to_string();
        let (text, selected) = render(&raw, &refs, &[source()]).unwrap();
        assert_eq!(text, "Conversation context\n\nFirst claim [Source 1](passage:proof) [citation unavailable]\n\nUnverified claim [citation unavailable]\n\nLast claim [Source 1](passage:proof)");
        assert_eq!(selected.len(), 1);
        // Losing an actually issued passage still blocks delivery, even when
        // another selection in the same answer was invented.
        assert_eq!(
            render(&raw, &refs, &[]).unwrap_err(),
            "An answer source is stale or no longer allowed"
        );
    }
    #[test]
    fn structured_answer_numbers_only_selected_sources_in_display_order() {
        let mut refs = PassageReferences::default();
        refs.register("unused");
        refs.register("proof");
        let (text, sources) = render(
            r#"{"segments":[{"text":"Claim","sources":["S2"]}]}"#,
            &refs,
            &[source()],
        )
        .unwrap();
        assert_eq!(text, "Claim [Source 1](passage:proof)");
        assert_eq!(sources.len(), 1);
    }
    #[test]
    fn structured_draft_rejects_malformed_oversized_and_deep_prefixes_until_reset() {
        for raw in [
            "{oops".to_string(),
            "[".repeat(20),
            "x".repeat(MAX_BYTES + 1),
        ] {
            let mut draft = Draft::default();
            draft.update(1, None);
            assert_eq!(draft.update(1, Some(&raw)), Some(String::new()));
            assert_eq!(draft.update(1, Some("late")), None);
            assert_eq!(draft.update(2, None), Some(String::new()));
            assert_eq!(
                draft.update(2, Some(r#"{"segments":[{"text":"Retry","sources":[]}]}"#)),
                Some("Retry".into())
            );
        }
    }
    #[test]
    fn structured_draft_decodes_split_escapes_without_exposing_keys_or_source_ids() {
        let mut draft = Draft::default();
        assert_eq!(draft.update(1, None), Some(String::new()));
        assert_eq!(
            draft.update(
                1,
                Some(r#"{"segments":[{"sources":["S999"],"text":"Hello \uD83D"#)
            ),
            Some("Hello ".into())
        );
        assert_eq!(
            draft.update(1, Some(r#"\uDE00\n\"quoted\""}]}"#)),
            Some("Hello 😀\n\"quoted\"".into())
        );
        assert_eq!(draft.update(2, None), Some(String::new()));
        assert_eq!(draft.update(1, Some("late")), None);
        assert_eq!(
            draft.update(
                2,
                Some(r#"{"segments":[{"text":"Replacement","sources":[]}] }"#)
            ),
            Some("Replacement".into())
        );
    }
}

// Bounded JSON-prefix decoding. Only segments[*].text is exposed. Escapes can
// straddle provider fragments; the final document is independently deserialized.
// Reparse at most 64 KiB with depth capped at 8, keeping work and stack bounded.
fn partial_text(raw: &str) -> Result<String, ()> {
    #[derive(Clone)]
    enum Part {
        Key(String),
        Index,
    }
    struct Prefix<'a> {
        raw: &'a str,
        pos: usize,
        texts: Vec<String>,
    }
    impl Prefix<'_> {
        fn whitespace(&mut self) {
            while self
                .raw
                .as_bytes()
                .get(self.pos)
                .is_some_and(u8::is_ascii_whitespace)
            {
                self.pos += 1;
            }
        }
        fn string(&mut self) -> Result<(String, bool), ()> {
            if self.raw.as_bytes().get(self.pos) != Some(&b'"') {
                return Err(());
            }
            self.pos += 1;
            let mut decoded = String::new();
            while let Some(&byte) = self.raw.as_bytes().get(self.pos) {
                if byte == b'"' {
                    self.pos += 1;
                    return Ok((decoded, true));
                }
                if byte < 0x20 {
                    return Err(());
                }
                if byte == b'\\' {
                    let start = self.pos;
                    let Some(&escape) = self.raw.as_bytes().get(start + 1) else {
                        return Ok((decoded, false));
                    };
                    let mut length = if escape == b'u' { 6 } else { 2 };
                    if start + length > self.raw.len() {
                        return Ok((decoded, false));
                    }
                    if escape == b'u' {
                        let code =
                            u16::from_str_radix(self.raw.get(start + 2..start + 6).ok_or(())?, 16)
                                .map_err(|_| ())?;
                        if (0xD800..=0xDBFF).contains(&code) {
                            length = 12;
                            if start + length > self.raw.len() {
                                return Ok((decoded, false));
                            }
                        }
                    }
                    let chunk = self.raw.get(start..start + length).ok_or(())?;
                    decoded.push_str(
                        &serde_json::from_str::<String>(&format!("\"{chunk}\"")).map_err(|_| ())?,
                    );
                    self.pos += length;
                } else {
                    let ch = self.raw[self.pos..].chars().next().ok_or(())?;
                    decoded.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
            Ok((decoded, false))
        }
        fn value(&mut self, path: &mut Vec<Part>) -> Result<bool, ()> {
            if path.len() > 8 {
                return Err(());
            }
            self.whitespace();
            let Some(&byte) = self.raw.as_bytes().get(self.pos) else {
                return Ok(false);
            };
            match byte {
                b'"' => {
                    let (text, complete) = self.string()?;
                    if matches!(path.as_slice(), [Part::Key(root), Part::Index, Part::Key(key)] if root=="segments" && key=="text")
                    {
                        self.texts.push(text);
                    }
                    Ok(complete)
                }
                b'{' => {
                    self.pos += 1;
                    self.whitespace();
                    if self.raw.as_bytes().get(self.pos) == Some(&b'}') {
                        self.pos += 1;
                        return Ok(true);
                    }
                    loop {
                        self.whitespace();
                        if self.pos == self.raw.len() {
                            return Ok(false);
                        }
                        let (key, complete) = self.string()?;
                        if !complete {
                            return Ok(false);
                        }
                        self.whitespace();
                        if self.pos == self.raw.len() {
                            return Ok(false);
                        }
                        if self.raw.as_bytes()[self.pos] != b':' {
                            return Err(());
                        }
                        self.pos += 1;
                        path.push(Part::Key(key));
                        let complete = self.value(path)?;
                        path.pop();
                        if !complete {
                            return Ok(false);
                        }
                        self.whitespace();
                        match self.raw.as_bytes().get(self.pos) {
                            Some(b',') => self.pos += 1,
                            Some(b'}') => {
                                self.pos += 1;
                                return Ok(true);
                            }
                            None => return Ok(false),
                            _ => return Err(()),
                        }
                    }
                }
                b'[' => {
                    self.pos += 1;
                    self.whitespace();
                    if self.raw.as_bytes().get(self.pos) == Some(&b']') {
                        self.pos += 1;
                        return Ok(true);
                    }
                    loop {
                        path.push(Part::Index);
                        let complete = self.value(path)?;
                        path.pop();
                        if !complete {
                            return Ok(false);
                        }
                        self.whitespace();
                        match self.raw.as_bytes().get(self.pos) {
                            Some(b',') => self.pos += 1,
                            Some(b']') => {
                                self.pos += 1;
                                return Ok(true);
                            }
                            None => return Ok(false),
                            _ => return Err(()),
                        }
                    }
                }
                // Primitive non-string values are not answer text. A partial
                // primitive remains pending; full validation rejects wrong types.
                _ => {
                    let start = self.pos;
                    while self
                        .raw
                        .as_bytes()
                        .get(self.pos)
                        .is_some_and(|b| !b",]} \t\r\n".contains(b))
                    {
                        self.pos += 1;
                    }
                    if self.pos == self.raw.len() {
                        return Ok(false);
                    }
                    serde_json::from_str::<serde_json::Value>(&self.raw[start..self.pos])
                        .map_err(|_| ())?;
                    Ok(true)
                }
            }
        }
    }
    let mut parser = Prefix {
        raw,
        pos: 0,
        texts: vec![],
    };
    let complete = parser.value(&mut vec![])?;
    if complete {
        parser.whitespace();
        if parser.pos != raw.len() {
            return Err(());
        }
    }
    Ok(parser.texts.join("\n\n"))
}
