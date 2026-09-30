//! Run-local model references. Durable destinations remain app-owned ChatSources.
use super::ChatSource;
use pulldown_cmark::{BrokenLink, CowStr, Event, LinkType, Options, Parser, Tag};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Admission and persistence share one source per stable passage identity.
pub(crate) fn admit_passage(
    sources: &mut Vec<ChatSource>,
    citation: crate::services::evidence::PassageCitation,
    note_path: String,
    title: String,
) {
    if let Some(prior) = sources
        .iter_mut()
        .filter_map(|s| s.passage.as_mut())
        .find(|p| p.id == citation.id)
    {
        // Each provenance page adds evidence to the same durable source. A later
        // plain read must not erase dates already used in the answer.
        for proof in citation.revisions {
            if !prior.revisions.contains(&proof) {
                prior.revisions.push(proof);
            }
        }
        return;
    }
    sources.push(ChatSource {
        kind: "passage".into(),
        note_id: Some(citation.note_id.clone()),
        note_path: Some(note_path),
        title,
        excerpt: citation.excerpt.clone(),
        url: None,
        anchor: Some(citation.id.clone()),
        revision: None,
        passage: Some(citation),
    });
}

#[derive(Default)]
pub(crate) struct PassageReferences {
    ids: Vec<String>,
    references: HashMap<String, usize>,
}

impl PassageReferences {
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
                let source = sources
                    .iter()
                    .find_map(|s| s.passage.as_ref().filter(|p| p.id == id))
                    .ok_or("Passage was not delivered")?;
                if item["excerpt"].as_str() != Some(source.excerpt.as_str()) {
                    return Err("Passage bytes do not match the delivered source".into());
                }
                let reference = self.register(id);
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
                historical: None,
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
    fn read_references_require_exact_delivered_text_for_every_answer() {
        let mut refs = PassageReferences::default();
        let sources = [source("proof")];
        for item in [
            json!({"evidenceId":"proof"}),
            json!({"evidenceId":"proof","excerpt":"Invented quote"}),
            json!({"evidenceId":"unread","excerpt":"Evidence"}),
        ] {
            assert!(refs
                .prepare(&mut json!({"items":[item]}), &sources)
                .is_err());
        }
        let mut payload = json!({"items":[{"evidenceId":"proof","excerpt":"Evidence"}]});
        refs.prepare(&mut payload, &sources).unwrap();
        assert_eq!(payload["items"][0]["citation"], "[S1]");
        assert_eq!(payload["items"][0]["excerpt"], "Evidence");
        assert!(payload["items"][0].get("clauses").is_none());
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
        let mut payload = json!({"items":[{"evidenceId":"worker-selected","excerpt":"Evidence","citation":"[S1]"}]});
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
