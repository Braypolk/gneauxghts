use crate::time::current_time_millis;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

const FRONTMATTER_DELIMITER: &str = "---";
const NOTE_ID_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DocumentKind {
    #[default]
    Note,
}

impl DocumentKind {
    pub(crate) fn as_frontmatter_value(self) -> &'static str {
        match self {
            Self::Note => "note",
        }
    }

    pub(crate) fn from_frontmatter_value(value: &str) -> Self {
        match value.trim() {
            _ => Self::Note,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedNoteMetadata {
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) trashed_at: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) untitled: bool,
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

/// Complete editable content without the app-owned identity/lifecycle namespace.
pub(crate) fn authored_markdown(markdown: &str) -> String {
    let parsed = parse_note(markdown);
    match parsed.frontmatter.raw_other {
        Some(other) => format!("---\n{other}\n---\n\n{}", parsed.body),
        None => parsed.body,
    }
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
    let parsed = parse_note(markdown);
    // Only our identity-bound temporary filename represents an empty title.
    // An explicit filesystem/Pi rename immediately supplies a normal title.
    if parsed
        .frontmatter
        .managed
        .as_ref()
        .is_some_and(|meta| meta.untitled && fallback_title == untitled_file_stem(&meta.id))
    {
        return (String::new(), parsed.body);
    }
    // A filename supplies the title, never permission to remove authored text.
    (fallback_title.to_string(), parsed.body)
}

pub(crate) fn untitled_file_stem(note_id: &str) -> String {
    format!("Untitled Note {note_id}")
}

/// Bind the visible blank-title state to the note's private capture filename.
pub(crate) fn set_untitled_marker(markdown: &str, untitled: bool) -> String {
    let parsed = parse_note(markdown);
    let Some(mut metadata) = parsed.frontmatter.managed else {
        return markdown.to_string();
    };
    if metadata.untitled == untitled {
        return markdown.to_string();
    }
    metadata.untitled = untitled;
    format!(
        "---\n{}\n---\n\n{}",
        compose_frontmatter(parsed.frontmatter.raw_other.as_deref(), &metadata),
        parsed.body
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
        untitled: existing_metadata
            .as_ref()
            .is_some_and(|metadata| metadata.untitled),
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
    let body = parsed.body.as_str();
    let frontmatter = compose_frontmatter(raw_other.as_deref(), &metadata);

    let enriched = if body.is_empty() {
        format!("{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n")
    } else {
        format!("{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n\n{body}")
    };

    Ok((enriched, metadata))
}

/// Replace only the user-authored state of a canonical note. Managed metadata
/// remains current lifecycle truth; only its update time advances.
pub(crate) fn replace_authored_content(
    current_markdown: &str,
    unmanaged_frontmatter: Option<&str>,
    body: &str,
) -> Result<String, String> {
    let current = parse_note(current_markdown);
    let mut metadata = current
        .frontmatter
        .managed
        .ok_or_else(|| "Version Restore requires managed Note metadata".to_string())?;
    metadata.updated_at = current_timestamp_rfc3339()?;
    let managed_frontmatter = compose_managed_frontmatter(&metadata);
    let frontmatter = match unmanaged_frontmatter {
        Some(unmanaged) if !unmanaged.is_empty() => {
            if !unmanaged.ends_with('\n') {
                return Err(
                    "Historical unmanaged frontmatter has no terminating line ending".to_string(),
                );
            }
            format!("{unmanaged}{managed_frontmatter}")
        }
        _ => managed_frontmatter,
    };
    Ok(if body.is_empty() {
        format!("{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n")
    } else {
        format!("{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n\n{body}")
    })
}

/// Restore the timeline-owned identity during an app-owned commit without
/// changing authored content or unrelated managed metadata.
pub(crate) fn repair_managed_note_identity(
    markdown: &str,
    note_id: &str,
) -> Result<String, String> {
    let parsed = parse_note(markdown);
    let now = current_timestamp_rfc3339()?;
    let mut metadata = parsed
        .frontmatter
        .managed
        .unwrap_or_else(|| ManagedNoteMetadata {
            id: String::new(),
            created_at: now.clone(),
            updated_at: now,
            trashed_at: None,
            untitled: false,
        });
    metadata.id = note_id.to_string();
    let frontmatter = compose_frontmatter(parsed.frontmatter.raw_other.as_deref(), &metadata);
    if parsed.body.is_empty() {
        Ok(format!(
            "{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n"
        ))
    } else {
        Ok(format!(
            "{FRONTMATTER_DELIMITER}\n{frontmatter}\n{FRONTMATTER_DELIMITER}\n\n{}",
            parsed.body
        ))
    }
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
        } else if let Some(value) = trimmed.strip_prefix("untitled:") {
            metadata.untitled = value.trim() == "true";
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

    sections.push(compose_managed_frontmatter(metadata));
    sections.join("\n")
}

fn compose_managed_frontmatter(metadata: &ManagedNoteMetadata) -> String {
    let trashed_at = metadata
        .trashed_at
        .clone()
        .unwrap_or_else(|| "null".to_string());
    let mut managed = format!(
        "gneauxghts:\n  id: {}\n  created_at: {}\n  updated_at: {}\n  trashed_at: {}",
        metadata.id, metadata.created_at, metadata.updated_at, trashed_at
    );
    if metadata.untitled {
        managed.push_str("\n  untitled: true");
    }
    managed
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

pub(crate) fn generate_note_id() -> String {
    generate_unique_id()
}

pub(crate) fn generate_unique_id() -> String {
    let timestamp_millis = current_time_millis().unwrap_or(0);
    let mut bytes = [0u8; 16];
    bytes[..6].copy_from_slice(&timestamp_millis.to_be_bytes()[2..]);
    getrandom::fill(&mut bytes[6..])
        .expect("operating-system randomness is required for unique identities");
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

// Managed frontmatter uses UTC whole seconds (YYYY-MM-DDTHH:MM:SSZ).
// Keep that narrow grammar; accepting offsets/fractions is a separate format change.
pub(crate) fn parse_rfc3339_millis(value: &str) -> Option<u64> {
    let value = value.trim();
    if value.len() != 20
        || [0..4, 5..7, 8..10, 11..13, 14..16, 17..19]
            .iter()
            .any(|range| {
                !value.as_bytes()[range.clone()]
                    .iter()
                    .all(u8::is_ascii_digit)
            })
    {
        return None;
    }
    let year = value.get(0..4)?.parse::<i64>().ok()?;
    let month = value.get(5..7)?.parse::<i64>().ok()?;
    let day = value.get(8..10)?.parse::<i64>().ok()?;
    let hour = value.get(11..13)?.parse::<i64>().ok()?;
    let minute = value.get(14..16)?.parse::<i64>().ok()?;
    let second = value.get(17..19)?.parse::<i64>().ok()?;
    if value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || value.as_bytes().get(10) != Some(&b'T')
        || value.as_bytes().get(13) != Some(&b':')
        || value.as_bytes().get(16) != Some(&b':')
        || value.as_bytes().get(19) != Some(&b'Z')
        || value.len() != 20
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    let days_in_month = match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if day > days_in_month {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(hour.checked_mul(3_600)?)?
        .checked_add(minute.checked_mul(60)?)?
        .checked_add(second)?;
    u64::try_from(seconds).ok()?.checked_mul(1_000)
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

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * month + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::{
        extract_file_name_title_and_body, normalize_wikilink_markdown, parse_note,
        parse_rfc3339_millis, prepare_note_markdown, replace_authored_content,
        timestamp_millis_to_rfc3339,
    };

    #[test]
    fn managed_timestamps_reject_impossible_calendar_days() {
        for value in [
            "2026-02-29T00:00:00Z",
            "2026-02-31T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2100-02-29T00:00:00Z",
        ] {
            assert_eq!(parse_rfc3339_millis(value), None, "{value}");
        }
        for value in [
            "2024-02-29T00:00:00Z",
            "2000-02-29T00:00:00Z",
            "2026-04-30T00:00:00Z",
        ] {
            let parsed = parse_rfc3339_millis(value).unwrap();
            assert_eq!(timestamp_millis_to_rfc3339(parsed), value);
        }
    }

    #[test]
    fn managed_timestamp_grammar_and_epoch_boundaries_are_explicit() {
        assert_eq!(parse_rfc3339_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_millis(" 1970-01-01T00:00:01Z "), Some(1_000));
        for value in [
            "1969-12-31T23:59:59Z",
            "2026-00-01T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-01-00T00:00:00Z",
            "2026-01-01T24:00:00Z",
            "2026-01-01T00:60:00Z",
            "2026-01-01T00:00:61Z",
            "2026-01-01 00:00:00Z",
            "2026-01-01T00:00:00+00:00",
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00z",
            "2026-1-01T00:00:00Z",
            "2026-é1-01T00:00:00Z",
            "2026-+1-01T00:00:00Z",
            "2026-01-+1T00:00:00Z",
            "2026-01-01T+1:00:00Z",
            "2026-01-01T00:+1:00Z",
            "2026-01-01T00:00:+1Z",
            "2026-01-01T00:00:60Z",
            "1969-12-31T23:59:60Z",
        ] {
            assert_eq!(parse_rfc3339_millis(value), None, "{value}");
        }
    }

    #[test]
    fn managed_timestamp_parser_round_trips_app_frontmatter_format() {
        let timestamp = 1_767_268_923_000;
        let encoded = timestamp_millis_to_rfc3339(timestamp);

        assert_eq!(parse_rfc3339_millis(&encoded), Some(timestamp));
        assert_eq!(parse_rfc3339_millis("not-a-timestamp"), None);
    }

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
    fn prepare_note_markdown_preserves_leading_body_newlines() {
        let markdown = "\n\nBody";
        let (prepared, _) =
            prepare_note_markdown(markdown, None, Some(None)).expect("prepare markdown");

        assert_eq!(parse_note(&prepared).body, markdown);
    }

    #[test]
    fn extract_file_name_title_and_body_preserves_a_matching_authored_heading() {
        let (title, body) = extract_file_name_title_and_body(
            "---\ngneauxghts:\n  id: 01TEST\n---\n\n# Launch Plan\n\nBody",
            "Launch Plan",
        );

        assert_eq!(title, "Launch Plan");
        assert_eq!(body, "# Launch Plan\n\nBody");
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
    fn replacing_authored_content_preserves_managed_lifecycle_metadata_and_refreshes_time() {
        let current = "---\nproject: current\ngneauxghts:\n  id: note-1\n  created_at: 2020-01-01T00:00:00Z\n  updated_at: 2020-01-02T00:00:00Z\n  trashed_at: 2020-01-03T00:00:00Z\n  kind: note\n---\n\nCurrent body";

        let replaced = replace_authored_content(
            current,
            Some("project: historical\r\n\r\nflag: true\r\n"),
            "Historical body\r\nwith exact line endings",
        )
        .unwrap();
        assert!(replaced.contains("project: historical\r\n\r\nflag: true\r\ngneauxghts:"));
        assert!(replaced.ends_with("Historical body\r\nwith exact line endings"));
        let parsed = parse_note(&replaced);
        let metadata = parsed.frontmatter.managed.unwrap();

        assert_eq!(
            parsed.frontmatter.raw_other.as_deref(),
            Some("project: historical\n\nflag: true")
        );
        assert_eq!(parsed.body, "Historical body\nwith exact line endings");
        assert_eq!(metadata.id, "note-1");
        assert_eq!(metadata.created_at, "2020-01-01T00:00:00Z");
        assert_eq!(metadata.trashed_at.as_deref(), Some("2020-01-03T00:00:00Z"));
        assert_ne!(metadata.updated_at, "2020-01-02T00:00:00Z");
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
