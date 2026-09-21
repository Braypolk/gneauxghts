//! Run-local model references. Durable destinations remain app-owned ChatSources.
use super::ChatSource;
use pulldown_cmark::{BrokenLink, CowStr, Event, LinkType, Options, Parser, Tag};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub(crate) struct PassageReferences {
    preview: Option<super::source_first::Catalog>,
    ids: Vec<String>,
    references: HashMap<String, usize>,
}

impl PassageReferences {
    pub(crate) fn render_inventory(
        &self,
        result: &crate::services::evidence::InventoryResult,
        sources: &[ChatSource],
    ) -> Result<String, String> {
        let literal = |s: &str| {
            s.chars()
                .flat_map(|c| {
                    if c.is_ascii_punctuation() {
                        vec!['\\', c]
                    } else {
                        vec![c]
                    }
                })
                .collect::<String>()
        };
        let period = &result.query.periods[0];
        let zone: chrono_tz::Tz = period
            .timezone
            .parse()
            .map_err(|_| "Inventory timezone unavailable")?;
        let date = |ms: u64| {
            chrono::DateTime::from_timestamp_millis(ms as i64)
                .map(|d| {
                    d.with_timezone(&zone)
                        .format("%b %-d, %Y %H:%M %Z")
                        .to_string()
                })
                .unwrap_or_else(|| "Unknown date".into())
        };
        let definite = result.rows.iter().filter(|r| !r.uncertain).count();
        let mut out = format!("**Notes with recorded editing activity**\n\n{}\n\n{}{} notes with definite matching evidence; {} with uncertain timing.\n\n", period.label, if result.page_offset > 0 { "On this continuation page, " } else if result.complete { "" } else { "At least " }, definite, result.rows.len()-definite);
        if result.rows.is_empty() {
            out.push_str(if result.complete {
                "No matching surviving edit evidence was found.\n\n"
            } else {
                "No matching evidence could be delivered; coverage is incomplete.\n\n"
            });
        }
        let delivered: HashSet<_> = sources
            .iter()
            .filter_map(|s| s.passage.as_ref().map(|p| p.id.as_str()))
            .collect();
        for row in &result.rows {
            if !sources.iter().any(|s| {
                s.passage
                    .as_ref()
                    .is_some_and(|p| p.id == row.evidence_id && p.excerpt.starts_with(&row.excerpt))
            }) || !self.references.contains_key(&row.evidence_id)
            {
                return Err("Inventory evidence changed or is unavailable".into());
            }
            out.push_str(&format!(
                "**[{}](passage:{})**{}\n\n",
                literal(&row.title),
                row.evidence_id,
                if row.uncertain {
                    " — timing uncertain"
                } else {
                    ""
                }
            ));
            let mut dates = Vec::new();
            for t in &row.activity {
                let source = match t.source {
                    crate::services::note_timeline::MutationSource::Editor => "editor",
                    crate::services::note_timeline::MutationSource::TaskAction => "task action",
                    crate::services::note_timeline::MutationSource::AcceptedChatProposal => {
                        "accepted proposal"
                    }
                    crate::services::note_timeline::MutationSource::ExternalEdit => {
                        "external observation"
                    }
                    crate::services::note_timeline::MutationSource::VersionRestore => "restore",
                    crate::services::note_timeline::MutationSource::NoteCreation => "note creation",
                    _ => "recorded change",
                };
                if !delivered.contains(t.evidence_id.as_str()) {
                    return Err("Inventory date evidence is unavailable".into());
                }
                let label = format!(
                    "{}{} ({source}){}{}",
                    date(t.start),
                    if t.end != t.start {
                        format!(" – {}", date(t.end))
                    } else {
                        String::new()
                    },
                    if t.clock_uncertain {
                        "; recorded clock timing is uncertain"
                    } else {
                        ""
                    },
                    if t.boundary_overlap {
                        "; interval crosses the requested date boundary"
                    } else {
                        ""
                    }
                );
                if !dates.contains(&label) {
                    dates.push(label);
                }
            }
            out.push_str("Example recorded edit: ");
            out.push_str(&dates.join("; "));
            out.push_str("\n\n");
            // Context helps identify tiny edits without asserting that the
            // surrounding unchanged words were edited in this period.
            let (label, excerpt) = if row.supporting_context.is_empty() {
                ("Edited text (preview):", &row.excerpt)
            } else {
                (
                    "Current context (may include unchanged text):",
                    &row.supporting_context,
                )
            };
            out.push_str(label);
            out.push_str("\n\n");
            for line in excerpt.lines() {
                out.push_str(&format!("> {}\n", literal(line)));
            }
            out.push_str("\n");
        }
        if !result.complete {
            if result
                .gaps
                .iter()
                .any(|gap| gap.contains("history") || gap.contains("pending or unavailable"))
            {
                out.push_str("Some note history is unavailable or still recovering, so this inventory may omit matching notes.\n\n");
            }
            out.push_str(if result.continuation.is_some() {
                "Coverage is partial. Ask to continue for more notes.\n\n"
            } else {
                "Coverage is partial. Narrow the date range or folder for more detail.\n\n"
            });
        }
        out.push_str("Based on surviving current-content edit evidence; deleted or superseded edits may be absent. Recorded change sources do not independently prove who performed the work.");
        Ok(out)
    }
    pub(crate) fn enable_source_first(&mut self) {
        self.preview = Some(Default::default());
    }

    pub(crate) fn render_source_first(
        &self,
        text: &str,
        sources: &[ChatSource],
    ) -> Result<String, String> {
        let catalog = self
            .preview
            .as_ref()
            .ok_or("Source-first preview is unavailable")?;
        Ok(self.render(&catalog.render(text, sources)?, sources))
    }

    pub(crate) fn register(&mut self, id: &str) -> String {
        let next = self.ids.len();
        let index = *self.references.entry(id.into()).or_insert_with(|| {
            self.ids.push(id.into());
            next
        });
        format!("[S{}]", index + 1)
    }

    pub(crate) fn prepare(
        &mut self,
        payload: &mut Value,
        sources: &[ChatSource],
    ) -> Result<(), String> {
        if let Some(items) = payload["items"].as_array_mut() {
            for item in items {
                let id = item["evidenceId"]
                    .as_str()
                    .ok_or("Passage identity unavailable")?;
                if !sources
                    .iter()
                    .any(|s| s.passage.as_ref().is_some_and(|p| p.id == id))
                {
                    return Err("Passage was not delivered".into());
                }
                let reference = self.register(id);
                if let Some(catalog) = self.preview.as_mut() {
                    let source = sources
                        .iter()
                        .find_map(|s| s.passage.as_ref().filter(|p| p.id == id))
                        .ok_or("Passage was not delivered")?;
                    if item["excerpt"].as_str() != Some(source.excerpt.as_str()) {
                        return Err("Passage bytes do not match the delivered source".into());
                    }
                    item["clauses"] = catalog.prepare(id, &reference, &source.excerpt);
                }
                item["citation"] = json!(reference);
            }
        }
        Ok(())
    }

    /// Only references issued to this run AND delivered as sources may become links.
    /// Parse Markdown so examples, fenced code, escapes and link definitions are respected.
    pub(crate) fn render(&self, text: &str, sources: &[ChatSource]) -> String {
        let delivered: HashSet<_> = sources
            .iter()
            .filter_map(|s| s.passage.as_ref().map(|p| p.id.as_str()))
            .collect();
        let mut callback = |link: BrokenLink<'_>| {
            is_reference(&link.reference).then(|| {
                (
                    CowStr::from(format!("source:{}", link.reference)),
                    CowStr::from(""),
                )
            })
        };
        let parser = Parser::new_with_broken_link_callback(
            text,
            Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH,
            Some(&mut callback),
        );
        let mut edits = Vec::new();
        for (event, range) in parser.into_offset_iter() {
            let Event::Start(Tag::Link {
                dest_url,
                link_type,
                ..
            }) = event
            else {
                continue;
            };
            let raw = &text[range.clone()];
            let label = raw
                .strip_prefix('[')
                .and_then(|s| s.split_once(']').map(|p| p.0));
            let reference = if !matches!(
                link_type,
                LinkType::Inline | LinkType::Autolink | LinkType::Email
            ) {
                label.filter(|s| is_reference(s))
            } else {
                None
            }
            .or_else(|| dest_url.strip_prefix("source:"));
            // CommonMark parses adjacent [S1][S2] as one full reference link.
            // They are two independent citation selections in our model contract.
            if label.is_some_and(is_reference)
                && !matches!(
                    link_type,
                    LinkType::Inline | LinkType::Autolink | LinkType::Email
                )
            {
                let mut rest = raw;
                let mut replacement = String::new();
                while let Some((marker, tail)) =
                    rest.strip_prefix('[').and_then(|s| s.split_once(']'))
                {
                    if !is_reference(marker) {
                        break;
                    }
                    replacement.push_str(&self.render_reference(marker, &delivered));
                    rest = tail;
                }
                replacement.push_str(rest);
                edits.push((range, replacement));
                continue;
            }
            let replacement = if let Some(reference) = reference {
                self.render_reference(reference, &delivered)
            } else if let Some(id) = dest_url.strip_prefix("passage:") {
                self.render_id(id, &delivered)
            } else {
                continue;
            };
            edits.push((range, replacement));
        }
        let mut output = text.to_string();
        for (range, replacement) in edits.into_iter().rev() {
            output.replace_range(range, &replacement);
        }
        output
    }

    fn render_reference(&self, reference: &str, delivered: &HashSet<&str>) -> String {
        reference
            .strip_prefix('S')
            .and_then(|n| n.parse::<usize>().ok())
            .and_then(|n| n.checked_sub(1))
            .and_then(|i| self.ids.get(i).map(|id| (i, id)))
            .filter(|(i, _)| format!("S{}", i + 1) == reference)
            .map(|(_, id)| self.render_id(id, delivered))
            .unwrap_or_else(|| "[citation unavailable]".into())
    }

    fn render_id(&self, id: &str, delivered: &HashSet<&str>) -> String {
        self.references
            .get(id)
            .filter(|_| delivered.contains(id))
            .map(|i| format!("[Source {}](passage:{id})", i + 1))
            .unwrap_or_else(|| "[citation unavailable]".into())
    }
}

fn is_reference(text: &str) -> bool {
    text.starts_with('S') && text.as_bytes().get(1).is_some_and(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn preview_source(id: &str, text: &str) -> ChatSource {
        let mut source = source(id);
        source.excerpt = text.into();
        let passage = source.passage.as_mut().unwrap();
        passage.excerpt = text.into();
        passage.end = text.len();
        source
    }

    fn preview_read(refs: &mut PassageReferences, sources: &[ChatSource]) -> Value {
        let mut payload = json!({"items": sources.iter().map(|s| json!({
            "evidenceId":s.passage.as_ref().unwrap().id, "excerpt":s.excerpt,
            "supportingContext":"Context is not selectable activity"
        })).collect::<Vec<_>>()});
        refs.prepare(&mut payload, sources).unwrap();
        payload
    }

    #[test]
    fn source_first_keeps_ids_across_reads_and_quotes_only_selected_clauses() {
        let mut refs = PassageReferences::default();
        refs.enable_source_first();
        let invoice = preview_source("invoice", "Invoice 42 paid; receipt filed by me.");
        let drill = preview_source("drill", "No route B drill result is recorded.");
        let first = preview_read(&mut refs, &[invoice.clone()]);
        let second = preview_read(&mut refs, &[drill.clone()]);
        assert_eq!(first["items"][0]["clauses"][1]["id"], "C2");
        assert_eq!(second["items"][0]["clauses"][0]["id"], "C3");
        assert_eq!(preview_read(&mut refs, &[invoice.clone()]), first);
        let answer = refs
            .render_source_first(
                r#"{"confirmed":["C2"],"related":["C1","C3"]}"#,
                &[invoice, drill],
            )
            .unwrap();
        assert!(answer.contains("> receipt filed by me\\.\n\n[Source 1](passage:invoice)"));
        assert!(answer.contains("Related evidence — doesn’t confirm the answer"));
        assert!(!answer.contains("Context is not selectable activity"));
        assert!(!answer.contains("I paid"));
    }

    #[test]
    fn source_first_rejects_invalid_json_ids_duplicates_extra_prose_and_stale_sources() {
        let mut refs = PassageReferences::default();
        refs.enable_source_first();
        let source = preview_source("valid", "Élodie completed the review.");
        preview_read(&mut refs, &[source.clone()]);
        for raw in [
            "I completed it.",
            r#"{"confirmed":["C99"],"related":[]}"#,
            r#"{"confirmed":["C01"],"related":[]}"#,
            r#"{"confirmed":["C1"],"related":["C1"]}"#,
            r#"{"confirmed":["C1"],"related":[],"answer":"It is done"}"#,
        ] {
            assert!(
                refs.render_source_first(raw, &[source.clone()]).is_err(),
                "{raw}"
            );
        }
        let raw = r#"{"confirmed":["C1"],"related":[]}"#;
        assert!(refs.render_source_first(raw, &[]).is_err());
        assert!(refs
            .render_source_first(raw, &[preview_source("valid", "Élodie plans the review.")])
            .is_err());
        assert!(PassageReferences::default()
            .render_source_first(raw, &[source])
            .is_err());
    }

    #[test]
    fn source_first_quotes_markdown_as_literal_text_and_preserves_date_wording() {
        let mut refs = PassageReferences::default();
        refs.enable_source_first();
        let original = "September 10 retrospective: review happened July 8 [S99](https://example.com) <img> & café `code`.";
        let source = preview_source("date", original);
        preview_read(&mut refs, &[source.clone()]);
        let answer = refs
            .render_source_first(r#"{"confirmed":["C1"],"related":[]}"#, &[source])
            .unwrap();
        let mut quoted_text = String::new();
        let mut in_quote = false;
        let mut links = Vec::new();
        for event in Parser::new(&answer) {
            match event {
                Event::Start(Tag::BlockQuote(_)) => in_quote = true,
                Event::End(pulldown_cmark::TagEnd::BlockQuote(_)) => in_quote = false,
                Event::Text(text) if in_quote => quoted_text.push_str(&text),
                Event::Start(Tag::Link { dest_url, .. }) => links.push(dest_url.to_string()),
                Event::Html(_) | Event::InlineHtml(_) => panic!("Source HTML escaped quotation"),
                _ => {}
            }
        }
        assert_eq!(quoted_text, original);
        assert_eq!(links, vec!["passage:date"]);
    }

    #[test]
    fn source_first_empty_selection_does_not_assert_absence_or_completion() {
        let mut refs = PassageReferences::default();
        refs.enable_source_first();
        let answer = refs
            .render_source_first(r#"{"confirmed":[],"related":[]}"#, &[])
            .unwrap();
        assert!(answer.contains("No supporting passages selected."));
        assert!(answer.contains("Selection may be incomplete."));
        assert!(!answer.contains("passage:"));
    }

    #[test]
    fn source_first_requires_an_explicit_current_turn_command() {
        use crate::chat::source_first::question;
        assert_eq!(
            question(" /sources what happened? "),
            Some("what happened?")
        );
        assert_eq!(question("/sources"), Some(""));
        for text in [
            "sources please",
            "/sourcesElse",
            "Quote /sources what happened?",
        ] {
            assert_eq!(question(text), None);
        }
    }

    fn source(id: &str) -> ChatSource {
        ChatSource {
            kind: "passage".into(),
            note_id: Some("note-1".into()),
            note_path: Some("note.md".into()),
            title: "Title with ] and (punctuation)".into(),
            excerpt: "Evidence".into(),
            url: None,
            anchor: Some(id.into()),
            revision: None,
            passage: Some(crate::services::evidence::PassageCitation {
                id: id.into(),
                note_id: "note-1".into(),
                content_hash: "hash".into(),
                location: "body".into(),
                start: 0,
                end: 8,
                excerpt: "Evidence".into(),
                revisions: vec![],
            }),
        }
    }

    #[test]
    fn inventory_links_once_and_separates_context_and_uncertainty() {
        use crate::services::evidence::{
            inventory::{InventoryActivity, InventoryResult, InventoryRow},
            query::{QueryAnchor, QueryIntent},
        };
        let mut refs = PassageReferences::default();
        let sources = vec![source("proof")];
        refs.register("proof");
        let intent: QueryIntent = serde_json::from_value(json!({"target":"notes","operation":"list","time":[{"role":"text_activity","relation":"within","period":{"kind":"dates","start":"2026-09-07","end":"2026-09-14"}}]})).unwrap();
        let query = QueryAnchor::default().normalize(&intent).unwrap();
        let mut result = InventoryResult {
            query,
            rows: vec![InventoryRow {
                evidence_id: "proof".into(),
                title: sources[0].title.clone(),
                excerpt: "Evidence".into(),
                supporting_context: "[fake](https://example.test) is unchanged context".into(),
                uncertain: true,
                activity: vec![InventoryActivity {
                    evidence_id: "proof".into(),
                    start: 1789120800000,
                    end: 1789120860000,
                    uncertain: true,
                    clock_uncertain: true,
                    boundary_overlap: false,
                    source: crate::services::note_timeline::MutationSource::Editor,
                }],
            }],
            page_offset: 0,
            complete: true,
            gaps: vec![],
            continuation: None,
            budgets: json!({}),
        };
        let rendered = refs.render_inventory(&result, &sources).unwrap();
        let links: Vec<_> = Parser::new(&rendered)
            .filter_map(|event| match event {
                Event::Start(Tag::Link { dest_url, .. }) => Some(dest_url.to_string()),
                _ => None,
            })
            .collect();
        assert_eq!(links, vec!["passage:proof"]);
        assert!(rendered.contains("Current context (may include unchanged text)"));
        assert!(rendered.contains("Example recorded edit:"));
        assert!(rendered.contains("recorded clock timing is uncertain"));
        assert!(!rendered.contains("crosses the requested date boundary"));
        result.rows[0].activity[0].clock_uncertain = false;
        result.rows[0].activity[0].boundary_overlap = true;
        let rendered = refs.render_inventory(&result, &sources).unwrap();
        assert!(!rendered.contains("recorded clock timing is uncertain"));
        assert!(rendered.contains("crosses the requested date boundary"));
        assert!(refs.render_inventory(&result, &[]).is_err());
    }

    #[test]
    fn passage_references_construct_links_from_delivered_sources() {
        let mut refs = PassageReferences::default();
        assert_eq!(refs.register("durable-one"), "[S1]");
        assert_eq!(refs.register("durable-two"), "[S2]");
        assert_eq!(refs.register("durable-one"), "[S1]");
        assert_eq!(refs.render("First [S1]. Second [S2][S1].", &[source("durable-one"), source("durable-two")]),
            "First [Source 1](passage:durable-one). Second [Source 2](passage:durable-two)[Source 1](passage:durable-one).");
    }

    #[test]
    fn passage_references_reject_the_observed_shortened_identity() {
        let id = "ca013df8a6857cc5f8f068522bb8a946803d1487145e6fcd3d1db22a92255bd1";
        let broken = "ca013df8a6857cc5f8f068522bb8a946803d1db22a92255bd1";
        let mut refs = PassageReferences::default();
        refs.register(id);
        assert_eq!(
            refs.render(&format!("Held [Meeting](passage:{broken})."), &[source(id)]),
            "Held [citation unavailable]."
        );
    }

    #[test]
    fn passage_references_cannot_resolve_undelivered_or_other_run_sources() {
        let mut refs = PassageReferences::default();
        refs.register("worker-only");
        assert_eq!(
            refs.render("A [S1], B [S99].", &[]),
            "A [citation unavailable], B [citation unavailable]."
        );
        assert_eq!(
            PassageReferences::default().render("A [S1].", &[source("worker-only")]),
            "A [citation unavailable]."
        );
    }

    #[test]
    fn passage_references_preserve_code_escapes_and_ordinary_links() {
        let mut refs = PassageReferences::default();
        refs.register("durable-one");
        let input = "`[S1]` \\[S1] [site](https://example.com)\n\n```md\n[S1]\n```\n\nReal [S1].";
        assert_eq!(
            refs.render(input, &[source("durable-one")]),
            input.replace("Real [S1]", "Real [Source 1](passage:durable-one)")
        );
    }

    #[test]
    fn passage_references_do_not_allow_markdown_definitions_to_redirect_sources() {
        let mut refs = PassageReferences::default();
        refs.register("durable-one");
        let output = refs.render(
            "Fact [S1].\n\n[S1]: https://example.com/other",
            &[source("durable-one")],
        );
        assert!(output.starts_with("Fact [Source 1](passage:durable-one)."));
    }
    #[test]
    fn passage_references_remap_worker_results_without_exporting_worker_aliases() {
        let mut parent = PassageReferences::default();
        parent.register("parent-first");
        let mut payload = json!({"items":[{"evidenceId":"worker-selected","citation":"[S1]"}]});
        parent
            .prepare(&mut payload, &[source("worker-selected")])
            .unwrap();
        assert_eq!(payload["items"][0]["citation"], "[S2]");
        assert_eq!(payload["items"][0]["evidenceId"], "worker-selected");
        assert_eq!(
            parent.render("Found [S2].", &[source("worker-selected")]),
            "Found [Source 2](passage:worker-selected)."
        );
        assert!(parent
            .prepare(
                &mut json!({"items":[{"evidenceId":"unselected"}]}),
                &[source("worker-selected")]
            )
            .is_err());
    }

    #[test]
    fn passage_references_accept_named_markdown_references_without_title_matching() {
        let mut refs = PassageReferences::default();
        refs.register("durable-one");
        assert_eq!(
            refs.render("Fact [the meeting][S1].", &[source("durable-one")]),
            "Fact [Source 1](passage:durable-one)."
        );
    }

    #[test]
    fn passage_references_reject_malformed_markers_and_preserve_tables() {
        let mut refs = PassageReferences::default();
        refs.register("durable-one");
        assert_eq!(refs.render("[S0] [S01] [S1oops] [label](source:S99)", &[source("durable-one")]),
            "[citation unavailable] [citation unavailable] [citation unavailable] [citation unavailable]");
        assert!(refs
            .render(
                "| Event | Source |\n| --- | --- |\n| Review | [S1] |",
                &[source("durable-one")]
            )
            .contains("| Review | [Source 1](passage:durable-one) |"));
    }
}
