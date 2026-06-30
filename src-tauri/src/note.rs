use crate::time::current_time_millis;
use blake3::Hasher;
use serde::Serialize;
use std::{
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NOTE_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

const FRONTMATTER_DELIMITER: &str = "---";
const NOTE_ID_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedNoteMetadata {
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) trashed_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct NoteFrontmatter {
    pub(crate) raw_other: Option<String>,
    pub(crate) managed: Option<ManagedNoteMetadata>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedNote {
    pub(crate) frontmatter: NoteFrontmatter,
    pub(crate) body: String,
}

pub(crate) fn parse_note(markdown: &str) -> ParsedNote {
    let normalized = normalize_markdown(markdown);
    let Some((raw_frontmatter, body)) = split_frontmatter(&normalized) else {
        return ParsedNote {
            frontmatter: NoteFrontmatter::default(),
            body: normalized,
        };
    };

    let (raw_other, managed) = split_managed_frontmatter(raw_frontmatter);
    ParsedNote {
        frontmatter: NoteFrontmatter { raw_other, managed },
        body: body.to_string(),
    }
}

pub(crate) fn strip_frontmatter(markdown: &str) -> String {
    parse_note(markdown).body
}

pub(crate) fn normalize_wikilink_markdown(markdown: &str) -> String {
    markdown
        .replace("!\\[\\[", "![[")
        .replace("\\[\\[", "[[")
        .replace("\\]\\]", "]]")
}

pub(crate) fn extract_file_name_title_and_body(
    markdown: &str,
    fallback_title: &str,
) -> (String, String) {
    let normalized = strip_frontmatter(markdown);
    (
        fallback_title.to_string(),
        strip_leading_title_heading(&normalized, fallback_title),
    )
}

pub(crate) fn derive_file_stem(markdown: &str, default_name: &str, max_len: usize) -> String {
    derive_file_stem_from_title_and_markdown("", markdown, default_name, max_len)
}

pub(crate) fn derive_file_stem_from_title_and_markdown(
    title: &str,
    markdown: &str,
    default_name: &str,
    max_len: usize,
) -> String {
    let preferred_title = title.trim();
    let body = strip_frontmatter(markdown);
    let first_line = if preferred_title.is_empty() {
        body.lines()
            .find(|line| !line.trim().is_empty())
            .map(str::trim)
            .unwrap_or(default_name)
    } else {
        preferred_title
    };

    sanitize_file_stem(first_line, default_name, max_len)
}

fn sanitize_file_stem(value: &str, default_name: &str, max_len: usize) -> String {
    let heading_trimmed = value
        .trim_start_matches('#')
        .trim()
        .trim_matches('`')
        .trim_matches('*')
        .trim_matches('_');

    let mut cleaned = String::new();
    let mut last_was_space = false;

    for ch in heading_trimmed.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            _ => ch,
        };

        if mapped.is_control() {
            continue;
        }

        if mapped.is_whitespace() {
            if last_was_space {
                continue;
            }
            cleaned.push(' ');
            last_was_space = true;
            continue;
        }

        cleaned.push(mapped);
        last_was_space = false;
    }

    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return default_name.to_string();
    }

    cleaned.chars().take(max_len).collect()
}

fn strip_leading_title_heading(markdown: &str, title: &str) -> String {
    let normalized = markdown.replace("\r\n", "\n");
    let mut lines = normalized.lines().map(str::to_string).collect::<Vec<_>>();
    let Some(first_content_index) = lines.iter().position(|line| !line.trim().is_empty()) else {
        return normalized;
    };

    let Some(heading) = lines[first_content_index]
        .trim()
        .strip_prefix("# ")
        .map(str::trim)
        .filter(|heading| !heading.is_empty())
    else {
        return normalized;
    };

    if title_match_key(heading) != title_match_key(title) {
        return normalized;
    }

    lines.remove(first_content_index);
    if lines
        .get(first_content_index)
        .is_some_and(|line| line.trim().is_empty())
    {
        lines.remove(first_content_index);
    }

    lines.join("\n")
}

fn title_match_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

pub(crate) fn prepare_note_markdown(
    markdown: &str,
    existing_markdown: Option<&str>,
    trashed_at: Option<Option<String>>,
) -> Result<(String, ManagedNoteMetadata), String> {
    let parsed = parse_note(markdown);
    let existing_parsed = existing_markdown.map(parse_note);
    let now = current_timestamp_rfc3339()?;

    let existing_metadata = parsed.frontmatter.managed.clone().or_else(|| {
        existing_parsed
            .as_ref()
            .and_then(|note| note.frontmatter.managed.clone())
    });

    let metadata = ManagedNoteMetadata {
        id: existing_metadata
            .as_ref()
            .map(|metadata| metadata.id.clone())
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(generate_note_id),
        created_at: existing_metadata
            .as_ref()
            .map(|metadata| metadata.created_at.clone())
            .filter(|created_at| !created_at.trim().is_empty())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
        trashed_at: trashed_at.unwrap_or_else(|| {
            existing_metadata
                .as_ref()
                .and_then(|metadata| metadata.trashed_at.clone())
        }),
    };

    let raw_other = parsed.frontmatter.raw_other.clone().or_else(|| {
        existing_parsed
            .as_ref()
            .and_then(|note| note.frontmatter.raw_other.clone())
    });
    let body = parsed.body.trim_start_matches('\n');
    let frontmatter = compose_frontmatter(raw_other.as_deref(), &metadata);

    let enriched = if body.is_empty() {
        format!("{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n")
    } else {
        format!("{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n\n{body}")
    };

    Ok((enriched, metadata))
}

pub(crate) fn note_id_from_path_or_markdown(
    note_path: Option<&Path>,
    markdown: &str,
) -> Option<String> {
    let parsed = parse_note(markdown);
    parsed
        .frontmatter
        .managed
        .and_then(|metadata| (!metadata.id.trim().is_empty()).then_some(metadata.id))
        .or_else(|| {
            note_path.and_then(|path| {
                path.file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .filter(|stem| !stem.trim().is_empty())
            })
        })
}

fn split_frontmatter(markdown: &str) -> Option<(&str, &str)> {
    let normalized = markdown.strip_prefix(FRONTMATTER_DELIMITER)?;
    let normalized = normalized.strip_prefix('\n')?;
    let closing_offset = normalized.find(&format!("\n{FRONTMATTER_DELIMITER}\n"))?;
    let raw_frontmatter = &normalized[..closing_offset];
    let body = normalized[closing_offset + FRONTMATTER_DELIMITER.len() + 2..]
        .strip_prefix('\n')
        .unwrap_or(&normalized[closing_offset + FRONTMATTER_DELIMITER.len() + 2..]);
    Some((raw_frontmatter, body))
}

fn split_managed_frontmatter(
    raw_frontmatter: &str,
) -> (Option<String>, Option<ManagedNoteMetadata>) {
    let lines = raw_frontmatter.lines().collect::<Vec<_>>();
    let mut preserved = Vec::new();
    let mut metadata = None;
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index];
        if is_top_level_gneauxghts(line) {
            let mut managed_lines = Vec::new();
            index += 1;
            while index < lines.len() {
                let candidate = lines[index];
                if !candidate.trim().is_empty() && !starts_with_indentation(candidate) {
                    break;
                }
                managed_lines.push(candidate);
                index += 1;
            }
            metadata = Some(parse_managed_metadata(&managed_lines));
            continue;
        }

        preserved.push(line);
        index += 1;
    }

    let raw_other = if preserved.iter().any(|line| !line.trim().is_empty()) {
        Some(preserved.join("\n"))
    } else {
        None
    };

    (raw_other, metadata)
}

fn parse_managed_metadata(lines: &[&str]) -> ManagedNoteMetadata {
    let mut metadata = ManagedNoteMetadata::default();

    for line in lines {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("id:") {
            metadata.id = normalize_yaml_scalar(value);
        } else if let Some(value) = trimmed.strip_prefix("created_at:") {
            metadata.created_at = normalize_yaml_scalar(value);
        } else if let Some(value) = trimmed.strip_prefix("updated_at:") {
            metadata.updated_at = normalize_yaml_scalar(value);
        } else if let Some(value) = trimmed.strip_prefix("trashed_at:") {
            let value = normalize_yaml_scalar(value);
            if !value.is_empty() && value != "null" {
                metadata.trashed_at = Some(value);
            }
        }
    }

    metadata
}

fn compose_frontmatter(raw_other: Option<&str>, metadata: &ManagedNoteMetadata) -> String {
    let mut sections = Vec::new();
    if let Some(raw_other) = raw_other {
        let trimmed = raw_other.trim_matches('\n');
        if !trimmed.is_empty() {
            sections.push(trimmed.to_string());
        }
    }

    let trashed_at = metadata
        .trashed_at
        .clone()
        .unwrap_or_else(|| "null".to_string());
    sections.push(format!(
        "gneauxghts:\n  id: {}\n  created_at: {}\n  updated_at: {}\n  trashed_at: {}",
        metadata.id, metadata.created_at, metadata.updated_at, trashed_at
    ));
    sections.join("\n")
}

fn normalize_markdown(markdown: &str) -> String {
    markdown.replace("\r\n", "\n")
}

fn is_top_level_gneauxghts(line: &str) -> bool {
    !starts_with_indentation(line) && line.trim() == "gneauxghts:"
}

fn starts_with_indentation(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t')
}

fn normalize_yaml_scalar(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn generate_note_id() -> String {
    let timestamp_millis = current_time_millis().unwrap_or(0);
    let mut bytes = [0u8; 16];
    bytes[..6].copy_from_slice(&timestamp_millis.to_be_bytes()[2..]);

    let counter = NOTE_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Hasher::new();
    hasher.update(&timestamp_millis.to_be_bytes());
    hasher.update(&counter.to_be_bytes());
    hasher.update(&(std::process::id() as u64).to_be_bytes());
    let hash = hasher.finalize();
    bytes[6..].copy_from_slice(&hash.as_bytes()[..10]);
    encode_base32(bytes)
}

fn encode_base32(bytes: [u8; 16]) -> String {
    let mut value = u128::from_be_bytes(bytes);
    let mut encoded = [b'0'; 26];
    for index in (0..26).rev() {
        encoded[index] = NOTE_ID_ALPHABET[(value & 31) as usize];
        value >>= 5;
    }
    String::from_utf8(encoded.to_vec()).expect("valid base32")
}

pub(crate) fn current_timestamp_rfc3339() -> Result<String, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?;
    Ok(timestamp_seconds_to_rfc3339(duration.as_secs()))
}

pub(crate) fn timestamp_millis_to_rfc3339(timestamp_millis: u64) -> String {
    timestamp_seconds_to_rfc3339(timestamp_millis / 1_000)
}

fn timestamp_seconds_to_rfc3339(total_seconds: u64) -> String {
    let total_seconds = total_seconds as i64;
    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
}

#[cfg(test)]
mod tests {
    use super::{
        extract_file_name_title_and_body, normalize_wikilink_markdown, parse_note,
        prepare_note_markdown,
    };

    #[test]
    fn parse_note_separates_frontmatter_and_body() {
        let parsed = parse_note(
            "---\nproject: atlas\ngneauxghts:\n  id: 01TEST\n  created_at: 2026-01-01T00:00:00Z\n  updated_at: 2026-01-02T00:00:00Z\n  trashed_at: null\n---\n\n# Title\n\nBody",
        );

        assert_eq!(parsed.body, "# Title\n\nBody");
        assert_eq!(
            parsed.frontmatter.raw_other.as_deref(),
            Some("project: atlas")
        );
        let metadata = parsed.frontmatter.managed.expect("managed metadata");
        assert_eq!(metadata.id, "01TEST");
        assert_eq!(metadata.trashed_at, None);
    }

    #[test]
    fn extract_file_name_title_and_body_uses_file_name_and_strips_leading_heading() {
        let (title, body) = extract_file_name_title_and_body(
            "---\ngneauxghts:\n  id: 01TEST\n---\n\n# Launch Plan\n\nBody",
            "Launch Plan",
        );

        assert_eq!(title, "Launch Plan");
        assert_eq!(body, "Body");
    }

    #[test]
    fn extract_file_name_title_and_body_preserves_body_heading_that_is_not_file_name() {
        let (title, body) = extract_file_name_title_and_body(
            "---\ngneauxghts:\n  id: 01TEST\n---\n\n# Meeting Notes\n\nBody",
            "Launch Plan",
        );

        assert_eq!(title, "Launch Plan");
        assert_eq!(body, "# Meeting Notes\n\nBody");
    }

    #[test]
    fn prepare_note_markdown_preserves_unknown_frontmatter_keys() {
        let (prepared, metadata) = prepare_note_markdown(
            "# Title\n\nBody",
            Some(
                "---\nproject: atlas\ngneauxghts:\n  id: 01TEST\n  created_at: 2026-01-01T00:00:00Z\n  updated_at: 2026-01-02T00:00:00Z\n  trashed_at: null\n---\n\n# Title\n\nOld body",
            ),
            Some(None),
        )
        .expect("prepare markdown");

        assert!(prepared.contains("project: atlas"));
        assert!(prepared.contains("id: 01TEST"));
        assert!(prepared.contains("# Title\n\nBody"));
        assert_eq!(metadata.id, "01TEST");
        assert_eq!(metadata.trashed_at, None);
    }

    #[test]
    fn normalize_wikilink_markdown_unescapes_obsidian_style_links() {
        assert_eq!(
            normalize_wikilink_markdown(
                "# Title\n\n!\\[\\[Pasted image.png\\]\\]\n\\[\\[Project Atlas\\]\\]"
            ),
            "# Title\n\n![[Pasted image.png]]\n[[Project Atlas]]"
        );
    }
}
