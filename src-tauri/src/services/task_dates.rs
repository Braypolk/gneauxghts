//! Portable authored task deadlines; no timestamp or storage authority.
use regex::Regex;
use std::sync::LazyLock;

static ANNOTATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@due\((\d{4}-\d{2}-\d{2})\)").unwrap());
static PROTECTED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());

pub(crate) fn valid_calendar_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
    {
        return false;
    }
    let year = value[..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<usize>().unwrap_or(0);
    let day = value[8..].parse::<u32>().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    year > 0 && (1..=12).contains(&month) && day > 0 && day <= days[month - 1]
}

fn protected_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges: Vec<_> = PROTECTED
        .find_iter(text)
        .map(|m| (m.start(), m.end()))
        .collect();
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index] == b'`' {
            index += 1;
        }
        let width = index - start;
        let mut end = index;
        let mut closed = false;
        while end < bytes.len() {
            if bytes[end] != b'`' {
                end += 1;
                continue;
            }
            let closing = end;
            while end < bytes.len() && bytes[end] == b'`' {
                end += 1;
            }
            if end - closing == width {
                ranges.push((start, end));
                index = end;
                closed = true;
                break;
            }
        }
        // Inline code may close on a continuation line that is not projected.
        if !closed {
            ranges.push((start, text.len()));
            break;
        }
    }
    let code_and_tag_ranges = ranges.clone();
    index = 0;
    while index < bytes.len() {
        if let Some((_, end)) = code_and_tag_ranges
            .iter()
            .find(|(from, to)| index >= *from && index < *to)
        {
            index = *end;
            continue;
        }
        if bytes[index] == b'\\' {
            index += 2;
            continue;
        }
        if bytes[index] != b'[' {
            index += 1;
            continue;
        }
        let start = index;
        let mut end = balanced_text_end(bytes, start, b'[', b']', &code_and_tag_ranges);
        if bytes.get(end) == Some(&b'(') {
            end = balanced_text_end(bytes, end, b'(', b')', &[]);
        } else if bytes.get(end) == Some(&b'[') {
            end = balanced_text_end(bytes, end, b'[', b']', &code_and_tag_ranges);
        }
        ranges.push((start, end));
        index = end;
    }
    ranges
}

fn balanced_text_end(
    text: &[u8],
    from: usize,
    opening: u8,
    closing: u8,
    protected: &[(usize, usize)],
) -> usize {
    let mut depth = 0;
    let mut index = from;
    while index < text.len() {
        if let Some((_, end)) = protected
            .iter()
            .find(|(from, to)| index >= *from && index < *to)
        {
            index = *end;
            continue;
        }
        if text[index] == b'\\' {
            index += 2;
            continue;
        }
        if text[index] == opening {
            depth += 1;
        } else if text[index] == closing {
            depth -= 1;
            if depth == 0 {
                return index + 1;
            }
        }
        index += 1;
    }
    // Labels and destinations may close on an unprojected continuation line.
    text.len()
}

pub(crate) fn due_annotations(text: &str) -> Vec<(usize, usize, String)> {
    let protected = protected_ranges(text);
    ANNOTATION
        .captures_iter(text)
        .filter_map(|capture| {
            let annotation = capture.get(0)?;
            let previous = text[..annotation.start()].chars().next_back();
            let next = text[annotation.end()..].chars().next();
            if previous.is_some_and(|c| !c.is_whitespace())
                || next.is_some_and(|c| !c.is_whitespace() && !".,;!?".contains(c))
                || protected
                    .iter()
                    .any(|(from, to)| annotation.start() < *to && annotation.end() > *from)
                || !valid_calendar_date(&capture[1])
            {
                return None;
            }
            Some((annotation.start(), annotation.end(), capture[1].to_string()))
        })
        .collect()
}

pub(crate) fn task_due_date(text: &str) -> Option<String> {
    due_annotations(text)
        .first()
        .map(|(_, _, date)| date.clone())
}

pub(crate) fn set_task_line_due_date(text: &str, date: Option<&str>) -> Result<String, String> {
    if date.is_some_and(|date| !valid_calendar_date(date)) {
        return Err("Choose a valid calendar date".into());
    }
    let mut result = text.to_string();
    for (from, to, _) in due_annotations(text).into_iter().rev() {
        let from = if from > 0 && text.as_bytes()[from - 1] == b' ' {
            from - 1
        } else {
            from
        };
        result.replace_range(from..to, "");
    }
    Ok(match date {
        Some(date) => {
            let content = result.trim_end();
            // Trailing spaces can encode an authored Markdown hardbreak.
            let updated = format!("{content} @due({date}){}", &result[content.len()..]);
            if task_due_date(&updated).as_deref() != Some(date) {
                return Err(
                    "Close any unfinished inline code or link before adding a due date".into(),
                );
            }
            updated
        }
        None => result,
    })
}

/// Actual Markdown checkbox marker lines, excluding code and link examples.
pub(crate) fn task_marker_lines(markdown: &str) -> std::collections::HashSet<usize> {
    use pulldown_cmark::{Event, Options, Parser};
    let newlines: Vec<_> = markdown
        .bytes()
        .enumerate()
        .filter_map(|(index, byte)| (byte == b'\n').then_some(index))
        .collect();
    Parser::new_ext(markdown, Options::ENABLE_TASKLISTS)
        .into_offset_iter()
        .filter_map(|(event, range)| match event {
            Event::TaskListMarker(_) => {
                Some(newlines.partition_point(|offset| *offset < range.start) + 1)
            }
            _ => None,
        })
        .collect()
}

pub(crate) fn set_due_date_in_markdown(
    markdown: &str,
    _line_number: usize,
    task_text: &str,
    date: Option<&str>,
) -> Result<String, String> {
    // Date edits demand an unambiguous identity; never guess at a nearby duplicate.
    let lines: Vec<_> = markdown.split_inclusive('\n').collect();
    let marker_lines = task_marker_lines(markdown);
    let matching: Vec<_> = lines
        .iter()
        .enumerate()
        .filter(|(index, line)| {
            if !marker_lines.contains(&(index + 1)) {
                return false;
            }
            crate::index::parse_task_line(line.trim_end_matches(['\r', '\n']))
                .is_some_and(|(_, text, _)| text == task_text)
        })
        .map(|(index, _)| index)
        .collect();
    let index = match matching.as_slice() {
        [index] => *index,
        [] => return Err("Task not found; refresh the task list".into()),
        _ => return Err("Task text is ambiguous; edit its due date in the note".into()),
    };
    let line = lines[index];
    let content = line.trim_end_matches(['\r', '\n']);
    let updated = set_task_line_due_date(content, date)?;
    let start: usize = lines[..index].iter().map(|line| line.len()).sum();
    let mut result = markdown.to_string();
    result.replace_range(start..start + content.len(), &updated);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_markdown_fixture_matches_frontend_contract() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../test-fixtures/contracts/task-dates.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let text = fixture["text"].as_str().unwrap();
            assert_eq!(
                task_due_date(text).as_deref(),
                fixture["due"].as_str(),
                "{text}"
            );
            let edited = set_task_line_due_date(text, fixture["set"].as_str());
            if let Some(error) = fixture["error"].as_str() {
                assert!(edited.unwrap_err().contains(error), "{text}");
            } else {
                assert_eq!(
                    edited.unwrap(),
                    fixture["edited"].as_str().unwrap(),
                    "{text}"
                );
            }
            assert_eq!(
                set_task_line_due_date(text, None).unwrap(),
                fixture["removed"].as_str().unwrap(),
                "{text}"
            );
        }
    }

    #[test]
    fn strict_dates_and_protected_text() {
        assert!(valid_calendar_date("2024-02-29"));
        for invalid in [
            "0000-01-01",
            "2026-02-29",
            "2026-13-01",
            "2026-04-31",
            "2026-1-01",
            "💡-01-01",
        ] {
            assert!(!valid_calendar_date(invalid));
        }
        let text = "Ship `@due(2026-10-01)` [@due(2026-10-02)](url) \\@due(2026-10-03) @due(2026-02-29) @due(2026-10-04) @due(2026-10-05)";
        assert_eq!(task_due_date(text).as_deref(), Some("2026-10-04"));
        let edited = set_task_line_due_date(text, Some("2026-10-06")).unwrap();
        assert!(edited.contains("`@due(2026-10-01)`"));
        assert!(edited.contains("@due(2026-02-29)"));
        assert!(!edited.contains("@due(2026-10-04)"));
        assert_eq!(due_annotations(&edited).len(), 1);
    }
    #[test]
    fn task_markers_exclude_code_and_accept_nested_ordered_and_plus_tasks() {
        let markdown = "```md\n- [ ] Example @due(2026-10-01)\n```\n+ [ ] Real\n  1. [ ] Child\n";
        assert_eq!(task_marker_lines(markdown), [4, 5].into_iter().collect());
        assert!(set_due_date_in_markdown(
            markdown,
            2,
            "Example @due(2026-10-01)",
            Some("2026-10-03")
        )
        .is_err());
        assert!(
            set_due_date_in_markdown(markdown, 4, "Real", Some("2026-10-03"))
                .unwrap()
                .contains("+ [ ] Real @due(2026-10-03)")
        );
    }

    #[test]
    fn canonical_date_edit_preserves_children_created_text_unicode_and_crlf() {
        let body = "# Tasks\r\n- [ ] Send 💡 @created(2020-01-01) @due(2026-10-01)\r\n  - [ ] Child @due(2026-10-02)\r\n";
        let edited = set_due_date_in_markdown(
            body,
            99,
            "Send 💡 @created(2020-01-01) @due(2026-10-01)",
            Some("2026-10-03"),
        )
        .unwrap();
        assert_eq!(edited, body.replace("@due(2026-10-01)", "@due(2026-10-03)"));
        assert!(
            set_due_date_in_markdown("- [ ] Same\n- [ ] Same", 1, "Same", Some("2026-10-03"))
                .unwrap_err()
                .contains("ambiguous")
        );
        assert!(set_due_date_in_markdown("- [ ] Changed", 1, "Same", None).is_err());
    }

    #[test]
    fn canonical_date_edits_preserve_hardbreaks_and_reject_continued_code() {
        let markdown = "- [ ] Review  \n  continued task description\n";
        assert_eq!(
            set_due_date_in_markdown(markdown, 1, "Review", Some("2026-10-03")).unwrap(),
            "- [ ] Review @due(2026-10-03)  \n  continued task description\n"
        );
        let code = "- [ ] Review `example @due(2026-10-01)\n  ends here`\n";
        assert!(set_due_date_in_markdown(
            code,
            1,
            "Review `example @due(2026-10-01)",
            Some("2026-10-03")
        )
        .unwrap_err()
        .contains("Close any unfinished inline code or link"));
        assert_eq!(
            set_due_date_in_markdown(code, 1, "Review `example @due(2026-10-01)", None).unwrap(),
            code
        );
    }
}
