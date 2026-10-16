//! Deterministic review validation without durable lifecycle ownership.
use serde::Deserialize;
use serde_json::Value;
pub(crate) fn validate_decisions(decisions: &Value, markdown: &str) -> Result<(), String> {
    let hunks = decisions.as_array().ok_or("Invalid review decisions")?;
    let mut ids = std::collections::HashSet::new();
    let length = markdown.encode_utf16().count();
    for h in hunks {
        let id = h["id"].as_str().ok_or("Invalid review hunk identity")?;
        let from = h["from"].as_u64().ok_or("Invalid review range")? as usize;
        let to = h["to"].as_u64().ok_or("Invalid review range")? as usize;
        if !ids.insert(id)
            || from > to
            || to > length
            || !matches!(
                h["status"].as_str(),
                Some("pending" | "kept" | "undone" | "modified")
            )
        {
            return Err("Invalid review decisions".into());
        }
        for field in ["baseFrom", "baseTo", "proposedFrom", "proposedTo"] {
            if h[field].as_u64().is_none() {
                return Err("Invalid review hunk".into());
            }
        }
        for field in ["oldText", "newText"] {
            if h[field].as_str().is_none() {
                return Err("Invalid review hunk".into());
            }
        }
    }
    Ok(())
}

use crate::chat::structured_answer;

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveSelection {
    pub(crate) markdown: String,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) occurrence: Option<usize>,
}

pub(crate) fn first_heading(markdown: &str) -> Option<String> {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};
    let mut heading = None;
    for event in Parser::new(markdown) {
        match event {
            Event::Start(Tag::Heading { .. }) => heading = Some(String::new()),
            Event::Text(text) | Event::Code(text) if heading.is_some() => {
                heading.as_mut().unwrap().push_str(&text)
            }
            Event::End(TagEnd::Heading(_)) => return heading.filter(|s| !s.trim().is_empty()),
            _ => {}
        }
    }
    None
}

pub(crate) fn place_addition(
    base: &str,
    addition: &str,
    heading: Option<&str>,
) -> Result<(String, String, String), String> {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};
    let mut headings = Vec::new();
    let mut current = None;
    for (event, range) in Parser::new(base).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current = Some((level as usize, range.start, String::new()))
            }
            Event::Text(t) | Event::Code(t) if current.is_some() => {
                current.as_mut().unwrap().2.push_str(&t)
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(h) = current.take() {
                    headings.push(h);
                }
            }
            _ => {}
        }
    }
    let at = if let Some(wanted) = heading {
        let found = headings
            .iter()
            .enumerate()
            .filter(|(_, h)| h.2 == wanted)
            .collect::<Vec<_>>();
        if found.len() != 1 {
            return Err(
                "The destination heading is missing or ambiguous; specify a unique heading.".into(),
            );
        }
        let (index, h) = found[0];
        headings
            .iter()
            .skip(index + 1)
            .find(|next| next.0 <= h.0)
            .map(|h| h.1)
            .unwrap_or(base.len())
    } else {
        base.len()
    };
    let prefix = base[..at].to_string();
    let suffix = base[at..].to_string();
    let before = if prefix.is_empty() || prefix.ends_with("\n\n") {
        ""
    } else if prefix.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    let after = if suffix.is_empty() { "" } else { "\n\n" };
    Ok((
        format!("{prefix}{before}{addition}{after}{suffix}"),
        prefix,
        suffix,
    ))
}

// Normalize rendered author text while retaining source offsets. Citation labels
// are controls, not selected author text. Contiguous matching rejects loose
// token subsequences and repeated text requires a more specific selection.
fn highlight_ranges(markdown: &str) -> Vec<std::ops::Range<usize>> {
    use pulldown_cmark::{Event, Parser};
    let mut spans: Vec<std::ops::Range<usize>> = Vec::new();
    let mut in_code_block = false;
    let mut opaque_link = false;
    for (event, range) in
        Parser::new_ext(markdown, pulldown_cmark::Options::all()).into_offset_iter()
    {
        match event {
            Event::Start(pulldown_cmark::Tag::Link { link_type, .. }) => {
                opaque_link = matches!(
                    link_type,
                    pulldown_cmark::LinkType::Autolink
                        | pulldown_cmark::LinkType::Email
                        | pulldown_cmark::LinkType::WikiLink { .. }
                );
            }
            Event::End(pulldown_cmark::TagEnd::Link) => opaque_link = false,
            Event::Start(pulldown_cmark::Tag::CodeBlock(_)) => in_code_block = true,
            Event::End(pulldown_cmark::TagEnd::CodeBlock) => in_code_block = false,
            _ => {}
        }
        if in_code_block || opaque_link || !matches!(event, Event::Text(_)) {
            continue;
        }
        for (relative, _) in markdown[range.clone()].match_indices("==") {
            let start = range.start + relative;
            if spans.last().is_some_and(|span| start < span.end) {
                continue;
            }
            if markdown[..start]
                .bytes()
                .rev()
                .take_while(|b| *b == b'\\')
                .count()
                % 2
                == 1
            {
                continue;
            }
            if let Some(close) = markdown[start + 2..].find("==") {
                let end = start + 2 + close;
                if close > 0 && !markdown[start + 2..end].contains('\n') {
                    spans.push(start..end + 2);
                }
            }
        }
    }
    spans
}

fn fragment_text(markdown: &str) -> String {
    let trimmed = markdown.trim();
    if trimmed.is_empty() {
        return markdown.into();
    }
    let leading = markdown.len() - markdown.trim_start().len();
    let trailing = markdown.trim_end().len();
    let inner: String = pulldown_cmark::Parser::new_ext(trimmed, pulldown_cmark::Options::all())
        .filter_map(|event| match event {
            pulldown_cmark::Event::Text(text) | pulldown_cmark::Event::Code(text) => {
                Some(text.into_string())
            }
            pulldown_cmark::Event::SoftBreak | pulldown_cmark::Event::HardBreak => Some(" ".into()),
            _ => None,
        })
        .collect();
    format!("{}{}{}", &markdown[..leading], inner, &markdown[trailing..])
}

pub(crate) fn rendered_text(markdown: &str) -> (String, Vec<std::ops::Range<usize>>) {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};
    let mut text = String::new();
    let mut offsets = Vec::new();
    let mut citation = false;
    let highlights = highlight_ranges(markdown);
    let unavailable = markdown.match_indices("[citation unavailable]")
        .map(|(at, marker)| at..at + marker.len()).collect::<Vec<_>>();
    let mut emitted_highlight = None;
    let mut push = |value: &str, range: std::ops::Range<usize>| {
        let exact = markdown.get(range.clone()) == Some(value);
        for (at, c) in value.char_indices() {
            let range = if exact {
                range.start + at..range.start + at + c.len_utf8()
            } else {
                range.clone()
            };
            if unavailable.iter().any(|marker| marker.start < range.end && range.start < marker.end) {
                continue;
            }
            if c.is_whitespace() {
                if !text.ends_with(' ') && !text.is_empty() {
                    text.push(' ');
                    offsets.push(range.clone());
                }
            } else {
                text.push(c);
                for _ in 0..c.len_utf8() {
                    offsets.push(range.clone());
                }
            }
        }
    };
    for (event, range) in
        Parser::new_ext(markdown, pulldown_cmark::Options::all()).into_offset_iter()
    {
        let overlapping = highlights
            .iter()
            .filter(|span| span.start < range.end && range.start < span.end)
            .collect::<Vec<_>>();
        if !citation && !overlapping.is_empty() && matches!(event, Event::Text(_) | Event::Code(_))
        {
            let mut cursor = range.start;
            for span in overlapping {
                if cursor < span.start {
                    let prefix = fragment_text(&markdown[cursor..span.start]);
                    push(&prefix, cursor..span.start);
                }
                if emitted_highlight != Some(span.start) {
                    push(
                        &markdown[span.start + 2..span.end - 2],
                        span.start + 2..span.end - 2,
                    );
                    emitted_highlight = Some(span.start);
                }
                cursor = span.end;
            }
            if cursor < range.end {
                let suffix = fragment_text(&markdown[cursor..range.end]);
                push(&suffix, cursor..range.end);
            }
            continue;
        }
        match event {
            Event::Start(Tag::Link { dest_url, .. }) if dest_url.starts_with("passage:") => {
                citation = true
            }
            Event::End(TagEnd::Link) => citation = false,
            Event::Text(t) | Event::Code(t) if !citation => push(&t, range),
            Event::SoftBreak
            | Event::HardBreak
            | Event::End(
                TagEnd::Paragraph
                | TagEnd::Heading(_)
                | TagEnd::Item
                | TagEnd::CodeBlock
                | TagEnd::TableCell,
            ) => push(" ", range),
            _ => {}
        }
    }
    (text.trim_end().to_string(), offsets)
}

fn selected_markdown(markdown:&str)->String {
    use pulldown_cmark::{Event,Parser,Tag};
    let mut result=markdown.to_string();
    let controls=Parser::new_ext(markdown,pulldown_cmark::Options::all()).into_offset_iter()
        .filter_map(|(event,range)|match event {
            Event::Start(Tag::Link{dest_url,..}) if dest_url.starts_with("passage:") => Some(range),
            _=>None,
        }).collect::<Vec<_>>();
    for range in controls.into_iter().rev() {result.replace_range(range,"");}
    result.replace("[citation unavailable]","").trim().to_string()
}

#[cfg(test)]
pub(crate) fn selected_content(answer: &str, selection: &SaveSelection) -> Result<String, String> {
    selected_content_with_associations(answer, selection, None).map(|selected| selected.markdown)
}
pub(crate) struct SelectedContent {
    pub(crate) markdown: String,
    pub(crate) range: std::ops::Range<usize>,
    pub(crate) occurrence: usize,
}
pub(crate) fn selected_content_with_associations(
    answer: &str,
    selection: &SaveSelection,
    associations: Option<&[structured_answer::CitationAssociation]>,
) -> Result<SelectedContent, String> {
    use pulldown_cmark::{Event, Parser, Tag};
    let expected = selection
        .text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let (chosen, _) = rendered_text(&selection.markdown);
    if expected.is_empty() || chosen.trim() != expected {
        return Err(
            "The selection formatting does not match its text. Select the passage again.".into(),
        );
    }
    let (full, map) = rendered_text(answer);
    let occurrences = full.match_indices(&expected).collect::<Vec<_>>();
    let occurrence = selection
        .occurrence
        .or_else(|| (occurrences.len() == 1).then_some(0))
        .ok_or("Select a unique contiguous passage from the completed answer.")?;
    let matched = occurrences
        .get(occurrence)
        .ok_or("The selected occurrence no longer belongs to this answer.")?
        .0;
    let start = map[matched].start;
    let end = map[matched + expected.len() - 1].end;
    if let Some(associations) = associations {
        let mut result = selected_markdown(&selection.markdown);
        for association in associations
            .iter()
            .filter(|a| a.start < end && start < a.end)
        {
            for link in &association.links {
                if link != "[citation unavailable]" && !result.contains(link) {
                    result.push(' ');
                    result.push_str(link);
                }
            }
        }
        return Ok(SelectedContent {
            markdown: result,
            range: start..end,
            occurrence,
        });
    }
    let block_start = answer[..start.min(answer.len())]
        .rfind("\n\n")
        .map(|n| n + 2)
        .unwrap_or(0);
    let mut block_end = answer[end.min(answer.len())..]
        .find("\n\n")
        .map(|n| end + n)
        .unwrap_or(answer.len());
    // Structured block answers place their source controls in the immediately
    // following marker-only paragraph. It is still the recorded association.
    if block_end < answer.len() {
        let following = &answer[block_end + 2..];
        let next = following.split("\n\n").next().unwrap_or("");
        if !next.is_empty() && rendered_text(next).0.is_empty() {
            block_end += 2 + next.len();
        }
    }
    let mut result = selected_markdown(&selection.markdown);
    for (event, range) in Parser::new(&answer[block_start..block_end]).into_offset_iter() {
        if let Event::Start(Tag::Link { dest_url, .. }) = event {
            if dest_url.starts_with("passage:") && !result.contains(dest_url.as_ref()) {
                result.push(' ');
                result.push_str(&answer[block_start + range.start..block_start + range.end]);
            }
        }
    }
    Ok(SelectedContent {
        markdown: result,
        range: start..end,
        occurrence,
    })
}

#[cfg(test)]
mod promotion_tests {
    use super::*;
    #[test]
    fn selection_handles_repeated_unicode_blocks_and_recorded_segment_sources() {
        let answer="éclair &amp; café\n\nSame **pilot**.\n\nFirst claim.\n\nSame **pilot**. [Source 2](passage:second)";
        let mut selection = SaveSelection {
            text: "pilot".into(),
            markdown: "**pilot**".into(),
            occurrence: Some(1),
        };
        assert_eq!(
            selected_content(answer, &selection).unwrap(),
            "**pilot** [Source 2](passage:second)"
        );
        selection.occurrence = None;
        assert!(selected_content(answer, &selection).is_err());
        let answer =
            "# Guidance\n\nUse **éclair**.\n\nAnother paragraph.\n\n[Source 1](passage:recorded)";
        let spans = vec![structured_answer::CitationAssociation {
            start: 0,
            end: answer.find("\n\n[Source").unwrap(),
            links: vec!["[Source 1](passage:recorded)".into()],
        }];
        let selection = SaveSelection {
            text: "éclair".into(),
            markdown: "**éclair**".into(),
            occurrence: None,
        };
        assert_eq!(
            selected_content_with_associations(answer, &selection, Some(&spans))
                .unwrap()
                .markdown,
            "**éclair** [Source 1](passage:recorded)"
        );
    }
    #[test]
    fn selection_uses_chat_highlights_table_spacing_and_literal_punctuation() {
        for (answer, text, markdown) in [
            ("Use ==pilot== next.", "pilot", "==pilot=="),
            (
                "<https://example.com/==pilot==>",
                "https://example.com/==pilot==",
                r"[https://example.com/\=\=pilot\=\=](https://example.com/==pilot==)",
            ),
            ("[[Plan|==pilot==]]", "==pilot==", "[[Plan|==pilot==]]"),
            (
                "Use ==**literal**== next.",
                "**literal**",
                "==**literal**==",
            ),
            (
                "| First | Second |\n| --- | --- |\n| One | Two |",
                "First Second One Two",
                "| First | Second |\n| --- | --- |\n| One | Two |",
            ),
            (
                r"Keep \*literal\* and \[brackets\].",
                "*literal* and [brackets]",
                r"\*literal\* and \[brackets\]",
            ),
            ("`==code==`", "==code==", "`==code==`"),
            ("```\n==code==\n```", "==code==", "```\n==code==\n```"),
        ] {
            let selection = SaveSelection {
                text: text.into(),
                markdown: markdown.into(),
                occurrence: None,
            };
            assert_eq!(selected_content(answer, &selection).unwrap(), markdown);
        }
        assert_eq!(rendered_text("Use ==pilot== next.").0, "Use pilot next.");
        assert!(selected_content(
            "Use ==pilot== next.",
            &SaveSelection {
                text: "invented".into(),
                markdown: "==invented==".into(),
                occurrence: None
            }
        )
        .is_err());
    }

    #[test]
    fn heading_addition_preserves_sections_and_rejects_ambiguous_locations() {
        assert_eq!(
            place_addition("# Plan\n\nOld\n\n# Later\n\nKeep", "New", Some("Plan"))
                .unwrap()
                .0,
            "# Plan\n\nOld\n\nNew\n\n# Later\n\nKeep"
        );
        assert!(place_addition("# Plan\n\n# Plan", "New", Some("Plan")).is_err());
        assert!(place_addition("# Other", "New", Some("Plan")).is_err());
    }
    #[test]
    fn selection_keeps_only_chosen_text_and_its_attached_citations() {
        let answer = "# Plan\n\nUse **one pilot** first. [Source 1](passage:proof)\n\nDo not copy this paragraph.";
        let chosen = SaveSelection {
            text: "one pilot".into(),
            markdown: "**one pilot**".into(),
            occurrence: None,
        };
        assert_eq!(
            selected_content(answer, &chosen).unwrap(),
            "**one pilot** [Source 1](passage:proof)"
        );
        assert!(selected_content(
            answer,
            &SaveSelection {
                text: "pilot paragraph".into(),
                markdown: "pilot paragraph".into(),
                occurrence: None
            }
        )
        .is_err());
    }

    #[test]
    fn selected_paragraph_recovers_all_three_passage_links_after_control_labels_are_removed() {
        let paragraph = "The **grocery** note links out to online recipes. Other food-related notes are shopping lists rather than full recipes.";
        let links = "[Source 1](passage:one) [Source 2](passage:two) [Source 3](passage:three)";
        let answer = format!("Earlier text.\n\n{paragraph} {links}\n\nDo not copy this.");
        let selection = SaveSelection {
            text: paragraph.replace("**", ""),
            markdown: paragraph.into(),
            occurrence: Some(0),
        };
        assert_eq!(
            selected_content(&answer, &selection).unwrap(),
            format!("{paragraph} {links}")
        );
    }
}

/// Only an independently edited addition can move to a refreshed canonical base.
pub(crate) fn isolated_addition(markdown:&str,prefix:&str,suffix:&str)->Result<String,String> {
    if markdown.len()<prefix.len()+suffix.len() || !markdown.starts_with(prefix) || !markdown.ends_with(suffix) {
        return Err("The draft also changes existing content. Copy or resolve those edits before refreshing.".into());
    }
    Ok(markdown[prefix.len()..markdown.len()-suffix.len()].trim_matches('\n').to_string())
}

#[cfg(test)]
mod save_conflict_tests {
    use super::*;
    #[test]
    fn unavailable_controls_do_not_change_selection_occurrences_or_associations() {
        let answer="Same **pilot**. [citation unavailable]\n\nSame **pilot**. [Source 1](passage:proof)";
        let second=answer.rfind("Same").unwrap();
        let associations=vec![structured_answer::CitationAssociation{start:second,end:answer.len(),links:vec!["[Source 1](passage:proof)".into()]}];
        let selected=selected_content_with_associations(answer,&SaveSelection{markdown:"**pilot**".into(),text:"pilot".into(),occurrence:Some(1)},Some(&associations)).unwrap();
        assert_eq!(selected.markdown,"**pilot** [Source 1](passage:proof)");
        assert_eq!(&answer[selected.range],"pilot");
        assert_eq!(rendered_text(answer).0,"Same pilot. Same pilot.");
        assert_eq!(selected_markdown("**pilot** [Source 1](passage:proof) [citation unavailable]"),"**pilot**");
        assert_eq!(selected_markdown("[Authored](https://example.com) [[Note#^block]]"),"[Authored](https://example.com) [[Note#^block]]");
    }
    #[test]
    fn changed_existing_content_cannot_be_silently_rebased_but_an_edited_addition_can() {
        let (working,prefix,suffix)=place_addition("# Plan\n\nOriginal\n\n# Later\n\nKeep","Addition",Some("Plan")).unwrap();
        let edited=working.replace("Addition","Human addition");
        assert_eq!(isolated_addition(&edited,&prefix,&suffix).unwrap(),"Human addition");
        let (rebased,_,_)=place_addition("# Plan\n\nExternal edit\n\n# Later\n\nKeep",&isolated_addition(&edited,&prefix,&suffix).unwrap(),Some("Plan")).unwrap();
        assert!(rebased.contains("External edit\n\nHuman addition"));
        assert!(isolated_addition(&edited.replace("Original","Changed surrounding content"),&prefix,&suffix).is_err());
        assert!(isolated_addition(&edited.replace("Keep","Changed following content"),&prefix,&suffix).is_err());
        assert!(isolated_addition("short",&prefix,&suffix).is_err());
        assert!(place_addition("# Plan\n\n# Plan","Addition",Some("Plan")).is_err());
    }
}
