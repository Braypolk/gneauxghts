//! Current Markdown occurrences. Offsets are UTF-16 for the existing editor.
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Occurrence {
    pub asset: String,
    pub from: usize,
    pub to: usize,
}

fn asset_name(raw: &str) -> Option<String> {
    // Markdown punctuation escaping precedes exactly one URL decoding pass.
    let mut unescaped = String::new();
    let mut chars = raw.trim().chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek().is_some_and(|c| c.is_ascii_punctuation()) {
            unescaped.push(chars.next()?);
        } else {
            unescaped.push(c);
        }
    }
    let bytes = unescaped.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == b'%'
            && (i + 2 >= bytes.len()
                || !bytes[i + 1].is_ascii_hexdigit()
                || !bytes[i + 2].is_ascii_hexdigit())
        {
            return None;
        }
    }
    let decoded = percent_encoding::percent_decode_str(&unescaped)
        .decode_utf8()
        .ok()?;
    let name = decoded.strip_prefix("assets/").unwrap_or(&decoded);
    if name.is_empty()
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '\\' | '?' | '#'))
        || name
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    let extension = name.rsplit('.').next()?.to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" | "avif" | "bmp"
    )
    .then(|| name.to_string())
}

pub(super) fn parse(markdown: &str) -> Vec<Occurrence> {
    let events: Vec<_> = Parser::new_ext(markdown, Options::ENABLE_YAML_STYLE_METADATA_BLOCKS)
        .into_offset_iter()
        .collect();
    let mut hidden = Vec::<Range<usize>>::new();
    let mut literal_start = None;
    for (event, range) in &events {
        match event {
            Event::Start(Tag::CodeBlock(_) | Tag::HtmlBlock | Tag::MetadataBlock(_)) => {
                literal_start = Some(range.start)
            }
            Event::End(TagEnd::CodeBlock | TagEnd::HtmlBlock | TagEnd::MetadataBlock(_)) => {
                if let Some(start) = literal_start.take() {
                    hidden.push(start..range.end);
                }
            }
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => hidden.push(range.clone()),
            _ => {}
        }
    }
    let mut comment = None;
    for (i, _) in markdown.match_indices("%%") {
        if escaped(markdown, i) || hidden.iter().any(|r| r.contains(&i)) {
            continue;
        }
        if let Some(start) = comment.take() {
            hidden.push(start..i + 2);
        } else {
            comment = Some(i);
        }
    }
    if let Some(start) = comment {
        hidden.push(start..markdown.len());
    }
    let mut raw = Vec::<(String, Range<usize>)>::new();
    for (event, range) in events {
        if let Event::Start(Tag::Image { dest_url, .. }) = event {
            if !hidden.iter().any(|r| r.contains(&range.start)) {
                raw.push((dest_url.to_string(), range.clone()));
                hidden.push(range);
            }
        }
    }
    for (start, _) in markdown.match_indices("![[") {
        if escaped(markdown, start) || hidden.iter().any(|r| r.contains(&start)) {
            continue;
        }
        let Some(end) = markdown[start + 3..].find("]]").map(|i| start + 3 + i) else {
            continue;
        };
        let target = &markdown[start + 3..end];
        if target.contains('\n') {
            continue;
        }
        let target = target
            .rsplit_once('|')
            .filter(|(name, size)| !name.ends_with('\\') && valid_size(size.trim_end()))
            .map(|(name, _)| name)
            .unwrap_or(target);
        raw.push((target.to_string(), start..end + 2));
    }
    raw.sort_by_key(|(_, r)| r.start);
    raw.into_iter()
        .filter_map(|(name, range)| {
            Some(Occurrence {
                asset: asset_name(&name)?,
                from: markdown[..range.start].encode_utf16().count(),
                to: markdown[..range.end].encode_utf16().count(),
            })
        })
        .collect()
}

fn valid_size(size: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    match size.split_once('x') {
        Some((w, h)) => (digits(w) && (h.is_empty() || digits(h))) || (w.is_empty() && digits(h)),
        None => digits(size),
    }
}

fn escaped(text: &str, at: usize) -> bool {
    text[..at].bytes().rev().take_while(|b| *b == b'\\').count() % 2 == 1
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_editor_inventory_fixtures() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../test-fixtures/image-inventory.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let images = parse(case["markdown"].as_str().unwrap());
            let assets: Vec<_> = images.iter().map(|o| o.asset.as_str()).collect();
            let expected: Vec<_> = case["assets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            assert_eq!(assets, expected, "{}", case["name"]);
        }
    }
    #[test]
    fn inventory_excludes_literals_comments_and_unsafe_destinations() {
        let text = "```\n![[fenced.png]]\n```\n\n    ![indent](i.png)\n\n`![[inline.png]]` \\![[escaped.png]] %% ![[comment.png]] %%\n\n<!-- ![[html.png]] -->\n\n> ![real](real.png)\n\n![[../escape.png]]";
        assert_eq!(
            parse(text)
                .iter()
                .map(|o| o.asset.as_str())
                .collect::<Vec<_>>(),
            ["real.png"]
        );
    }
    #[test]
    fn inventory_resolves_references_dimensions_decoding_and_utf16() {
        let text = "😀 ![[assets/sub/a.png|100x80]] ![photo][]\n\n[photo]: <folder/a%20b.png>";
        let images = parse(text);
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].asset, "sub/a.png");
        assert_eq!(images[0].from, 3);
        assert_eq!(images[1].asset, "folder/a b.png");
        assert_eq!(asset_name("a%2520b.png").as_deref(), Some("a%20b.png"));
        assert!(asset_name("a%ZZ.png").is_none());
    }
}
