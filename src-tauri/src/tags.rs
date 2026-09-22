//! Authored note tags and the shared interactive search syntax.
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagEdit {
    pub(crate) previous: Vec<String>,
    pub(crate) tags: Vec<String>,
}

pub(crate) fn normalize_tag(tag: &str) -> Result<String, String> {
    let tag = tag.trim().trim_start_matches('#').to_lowercase();
    if tag.is_empty()
        || tag.chars().count() > 80
        || !tag
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '/'))
    {
        return Err(
            "Use letters, numbers, hyphens, underscores or / in a tag (up to 80 characters)."
                .into(),
        );
    }
    Ok(tag)
}

pub(crate) fn normalize_tags(tags: &[String]) -> Result<Vec<String>, String> {
    let mut normalized = tags
        .iter()
        .map(|tag| normalize_tag(tag))
        .collect::<Result<Vec<_>, _>>()?;
    normalized.sort();
    normalized.dedup();
    Ok(normalized)
}

pub(crate) fn read_frontmatter_tags(raw: Option<&str>) -> Result<Vec<String>, String> {
    let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
        return Ok(Vec::new());
    };
    let value: Value = serde_yaml::from_str(raw)
        .map_err(|_| "Fix the note’s YAML frontmatter before editing tags.".to_string())?;
    let map = value
        .as_mapping()
        .ok_or("Note frontmatter must be a YAML mapping.")?;
    let Some(value) = map.get(Value::String("tags".into())) else {
        return Ok(Vec::new());
    };
    let values = match value {
        Value::Null => Vec::new(),
        Value::String(tag) => vec![tag.clone()],
        Value::Sequence(tags) => tags
            .iter()
            .map(|tag| {
                tag.as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "The tags field must contain only tag names.".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?,
        _ => return Err("The tags field must be a tag name or a YAML list of tag names.".into()),
    };
    normalize_tags(&values)
}

pub(crate) fn read_tags(markdown: &str) -> Result<Vec<String>, String> {
    read_frontmatter_tags(
        crate::note::parse_note(markdown)
            .frontmatter
            .raw_other
            .as_deref(),
    )
}

/// Patch only the authored tags field after canonical preparation, under the
/// existing note-file owner. Never serialize unrelated user properties.
pub(crate) fn apply_edit(markdown: &str, edit: Option<&TagEdit>) -> Result<String, String> {
    let Some(edit) = edit else {
        return Ok(markdown.to_string());
    };
    let tags = normalize_tags(&edit.tags)?;
    if read_tags(markdown)? != normalize_tags(&edit.previous)? {
        return Err(
            "Tags changed outside the app. Reload the note before changing its tags.".into(),
        );
    }
    let normalized = markdown.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return Ok(format!(
            "---\ntags: {}\n---\n\n{}",
            serde_json::to_string(&tags).unwrap(),
            markdown
        ));
    };
    let close = rest.find("\n---").ok_or("Unclosed note frontmatter")?;
    let raw = &rest[..close];
    let lines: Vec<_> = raw.split_inclusive('\n').collect();
    let mut start = None;
    let mut end = raw.len();
    let mut offset = 0;
    for line in &lines {
        let text = line.trim_end();
        if !text.is_empty()
            && !text.starts_with(char::is_whitespace)
            && !text.starts_with('#')
            && text != "-"
            && !text.starts_with("- ")
        {
            let key = text.split_once(':').map(|(key, _)| key.trim());
            if matches!(key, Some("tags" | "'tags'" | "\"tags\"")) {
                start = Some(offset);
            } else if start.is_some() {
                end = offset;
                break;
            }
        }
        offset += line.len();
    }
    // An exotic YAML key/flow mapping cannot be safely patched as a line field.
    let parsed: Value = serde_yaml::from_str(raw).map_err(|_| "Invalid note frontmatter")?;
    let has_tags = parsed
        .as_mapping()
        .is_some_and(|map| map.contains_key(Value::String("tags".into())));
    if (has_tags && start.is_none()) || raw.trim_start().starts_with('{') {
        return Err("Use a top-level tags field in block-style YAML to edit tags inline.".into());
    }
    let field = format!("tags: {}\n", serde_json::to_string(&tags).unwrap());
    let patched = if let Some(start) = start {
        // Trailing comments/blank lines can document the following property
        // (or the frontmatter itself), rather than belonging to the tag value.
        // Keep that suffix outside the replaced field, including at EOF.
        let mut value_end = start;
        let mut cursor = start;
        for line in raw[start..end].split_inclusive('\n') {
            cursor += line.len();
            let text = line.trim();
            if !text.is_empty() && !text.starts_with('#') {
                value_end = cursor;
            }
        }
        end = value_end;
        format!("{}{}{}", &raw[..start], field, &raw[end..])
    } else {
        format!(
            "{}{}{}",
            raw,
            if raw.ends_with('\n') || raw.is_empty() {
                ""
            } else {
                "\n"
            },
            field
        )
    };
    let result = format!("---\n{}{}", patched.trim_end_matches('\n'), &rest[close..]);
    if read_tags(&result)? != tags {
        return Err("Unable to update the tags field safely.".into());
    }
    Ok(result)
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct TagQuery {
    pub(crate) text: String,
    pub(crate) tags: Vec<String>,
}

impl TagQuery {
    pub(crate) fn parse(query: &str) -> Self {
        let mut text = Vec::new();
        let mut tags = Vec::new();
        for token in query.split_whitespace() {
            let lower = token.to_lowercase();
            let tag = lower
                .strip_prefix("tag:")
                .or_else(|| lower.strip_prefix('#'));
            if let Some(tag) = tag.and_then(|tag| normalize_tag(tag).ok()) {
                tags.push(tag);
            } else {
                text.push(token);
            }
        }
        tags.sort();
        tags.dedup();
        Self {
            text: text.join(" "),
            tags,
        }
    }
    pub(crate) fn matches(&self, tags: &[String]) -> bool {
        self.tags
            .iter()
            .all(|wanted| tags.iter().any(|tag| tag == wanted))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tag_aliases_and_combined_filters_are_exact() {
        assert_eq!(
            TagQuery::parse("#Renovation contractor estimates"),
            TagQuery::parse("tag:renovation contractor estimates")
        );
        let query = TagQuery::parse("#work tag:budget");
        assert!(query.matches(&["work".into(), "budget".into()]));
        assert!(!query.matches(&["workshop".into(), "budget".into()]));
        assert_eq!(TagQuery::parse("C# # Heading").text, "C# # Heading");
    }
    #[test]
    fn tags_round_trip_without_rewriting_other_properties() {
        let raw = "---\nowner: 'Alice' # keep\ntags:\n  - Old\ncustom:\n  nested: yes\n---\n\nBody #literal";
        let updated = apply_edit(
            raw,
            Some(&TagEdit {
                previous: vec!["old".into()],
                tags: vec!["#New".into(), "new".into()],
            }),
        )
        .unwrap();
        assert!(updated.contains("owner: 'Alice' # keep\n"));
        assert!(updated.contains("custom:\n  nested: yes\n"));
        assert!(updated.ends_with("Body #literal"));
        assert_eq!(read_tags(&updated).unwrap(), vec!["new"]);
        let empty = apply_edit(
            &updated,
            Some(&TagEdit {
                previous: vec!["new".into()],
                tags: vec![],
            }),
        )
        .unwrap();
        assert!(empty.contains("tags: []"));
        assert!(read_tags(&empty).unwrap().is_empty());
    }
    #[test]
    fn tag_edits_accept_indentless_yaml_sequences() {
        let raw = "---\ntags:\n- old\n- second\nowner: Alice\n---\n\nBody";
        let updated = apply_edit(
            raw,
            Some(&TagEdit {
                previous: vec!["old".into(), "second".into()],
                tags: vec!["new".into()],
            }),
        )
        .unwrap();
        assert_eq!(read_tags(&updated).unwrap(), vec!["new"]);
        assert!(updated.contains("owner: Alice\n"));
        assert!(updated.ends_with("Body"));
    }
    #[test]
    fn tag_edits_preserve_comments_before_other_fields_and_the_closing_delimiter() {
        for suffix in [
            "# Owner approval required\nowner: Alice",
            "\n# Owner approval required\n\nowner: Alice",
            "  # Indented comment about the next property\nowner: Alice",
            "# Keep this end-of-frontmatter comment",
        ] {
            let raw = format!("---\ntags:\n  - old\n{suffix}\n---\n\nBody");
            let updated = apply_edit(&raw, Some(&TagEdit {
                previous: vec!["old".into()], tags: vec!["new".into()],
            })).unwrap();
            assert!(updated.contains(suffix), "lost comment in {updated}");
            assert_eq!(read_tags(&updated).unwrap(), vec!["new"]);
            assert!(updated.ends_with("\n---\n\nBody"));
        }
    }

    #[test]
    fn tag_edits_reject_stale_and_invalid_frontmatter() {
        let edit = TagEdit {
            previous: vec![],
            tags: vec!["work".into()],
        };
        assert!(apply_edit("---\ntags: [other]\n---\nBody", Some(&edit)).is_err());
        assert!(apply_edit("---\ntags: [broken\n---\nBody", Some(&edit)).is_err());
        assert_eq!(
            apply_edit("---\ntags: [broken\n---\nBody", None).unwrap(),
            "---\ntags: [broken\n---\nBody"
        );
    }
}
