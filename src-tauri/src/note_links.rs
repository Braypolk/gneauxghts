//! Authored note-link occurrences, indexed independently of semantic search.
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};

#[derive(Clone)]
pub(crate) struct NoteLink {
    pub(crate) target: String,
    pub(crate) wiki: bool,
    pub(crate) line: usize,
    pub(crate) excerpt: String,
}

pub(crate) fn parse(body: &str) -> Vec<NoteLink> {
    let events: Vec<_> = Parser::new_ext(body, Options::ENABLE_WIKILINKS)
        .into_offset_iter()
        .collect();
    let mut hidden = Vec::new();
    let mut literal_start = None;
    for (event, range) in &events {
        match event {
            Event::Start(Tag::CodeBlock(_) | Tag::HtmlBlock) => literal_start = Some(range.start),
            Event::End(TagEnd::CodeBlock | TagEnd::HtmlBlock) => {
                if let Some(start) = literal_start.take() {
                    hidden.push(start..range.end);
                }
            }
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => hidden.push(range.clone()),
            _ => {}
        }
    }
    let mut comment = None;
    for (offset, _) in body.match_indices("%%") {
        if body[..offset]
            .bytes()
            .rev()
            .take_while(|b| *b == b'\\')
            .count()
            % 2
            == 1
            || hidden.iter().any(|range| range.contains(&offset))
        {
            continue;
        }
        if let Some(start) = comment.take() {
            hidden.push(start..offset + 2);
        } else {
            comment = Some(offset);
        }
    }
    let mut links = Vec::new();
    for (event, range) in events {
        if let Event::Start(Tag::Link {
            dest_url,
            link_type,
            ..
        }) = event
        {
            if hidden.iter().any(|hidden| hidden.contains(&range.start)) {
                continue;
            }
            // Code, escaped syntax, HTML comments and image embeds are not links.
            let line = body[..range.start].bytes().filter(|b| *b == b'\n').count() + 1;
            let excerpt = body
                .lines()
                .nth(line - 1)
                .unwrap_or_default()
                .trim()
                .to_string();
            links.push(NoteLink {
                target: dest_url.into_string(),
                wiki: matches!(link_type, LinkType::WikiLink { .. }),
                line,
                excerpt,
            });
        }
    }
    links
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backlinks_ignore_comments_code_escapes_and_embeds() {
        let links = parse("`%% [[Code]]`\n\n%% [[Hidden]] %%\n\n<!-- [[Html]] -->\n\n```\n[[Fence]]\n```\n\n    [[Indent]]\n\n\\[[Escaped]] ![[Image]]\n\n[[Real#Section|Alias]] [local](Other.md#section)");
        assert_eq!(
            links
                .iter()
                .map(|link| link.target.as_str())
                .collect::<Vec<_>>(),
            vec!["Real#Section", "Other.md#section"]
        );
        assert!(links[0].wiki);
        assert!(!links[1].wiki);
    }
}
