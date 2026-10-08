use crate::note;
use blake3::hash;
use pulldown_cmark::{Event, Parser, Tag, TagEnd};

const MAX_CHUNK_CHARS: usize = 480;
const PARAGRAPH_OVERLAP: usize = 1;
const LONG_TEXT_WINDOW: usize = 360;
const LONG_TEXT_OVERLAP: usize = 80;

#[derive(Clone, Debug)]
pub(crate) struct SemanticChunk {
    pub(crate) ordinal: usize,
    pub(crate) section_label: String,
    pub(crate) text: String,
    pub(crate) text_hash: String,
    pub(crate) start_line: usize,
    pub(crate) end_line: usize,
    pub(crate) block_anchor: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ChunkedNote {
    pub(crate) title: String,
    pub(crate) content_hash: String,
    pub(crate) chunks: Vec<SemanticChunk>,
}

#[derive(Clone, Debug)]
struct Paragraph {
    text: String,
    start_line: usize,
    end_line: usize,
}

#[derive(Clone, Debug)]
struct Section {
    label: String,
    paragraphs: Vec<Paragraph>,
}

pub(crate) fn chunk_markdown(markdown: &str, fallback_title: &str) -> ChunkedNote {
    let (title, body) = note::extract_file_name_title_and_body(markdown, fallback_title);
    let lines = body.lines().collect::<Vec<_>>();
    let title_line = 1;
    let sections = parse_sections(&lines, 0);
    let mut chunks = Vec::new();

    if !title.trim().is_empty() {
        chunks.push(SemanticChunk {
            ordinal: 0,
            section_label: "Title".to_string(),
            text: title.clone(),
            text_hash: hash_string(&title),
            start_line: title_line,
            end_line: title_line,
            block_anchor: None,
        });
    }

    for section in sections {
        push_section_chunks(&mut chunks, &section);
    }

    ChunkedNote {
        title,
        content_hash: hash_string(&body),
        chunks,
    }
}

fn parse_sections(lines: &[&str], body_start_index: usize) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut current_label = "Overview".to_string();
    let mut current_paragraph_lines = Vec::new();
    let mut current_paragraph_start = 0usize;
    let mut current_paragraph_end = 0usize;
    let mut current_section_paragraphs = Vec::new();

    // Use the same Markdown grammar as the editor: hashtags are text, and
    // heading/divider syntax inside code blocks remains searchable content.
    let markdown = lines.join("\n");
    let line_starts = std::iter::once(0)
        .chain(markdown.match_indices('\n').map(|(offset, _)| offset + 1))
        .collect::<Vec<_>>();
    let line_at = |offset| line_starts.partition_point(|start| *start <= offset) - 1;
    let mut headings = vec![None; lines.len()];
    let mut syntax_lines = vec![false; lines.len()];
    let mut heading: Option<(std::ops::Range<usize>, String)> = None;
    for (event, range) in Parser::new(&markdown).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { .. }) => heading = Some((range, String::new())),
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, label)) = &mut heading {
                    label.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some((_, label)) = &mut heading {
                    label.push(' ');
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((range, label)) = heading.take() {
                    let first = line_at(range.start);
                    let last = line_at(range.end.saturating_sub(1));
                    syntax_lines[first..=last].fill(true);
                    headings[first] = Some(collapse_whitespace(&label));
                }
            }
            Event::Rule => {
                let first = line_at(range.start);
                let last = line_at(range.end.saturating_sub(1));
                syntax_lines[first..=last].fill(true);
            }
            _ => {}
        }
    }

    for (index, line) in lines.iter().enumerate().skip(body_start_index) {
        let trimmed = line.trim();
        let line_number = index + 1;

        if let Some(heading) = &headings[index] {
            flush_paragraph(
                &mut current_section_paragraphs,
                &mut current_paragraph_lines,
                &mut current_paragraph_start,
                &mut current_paragraph_end,
            );
            if !current_section_paragraphs.is_empty() {
                sections.push(Section {
                    label: current_label.clone(),
                    paragraphs: std::mem::take(&mut current_section_paragraphs),
                });
            }
            if !heading.is_empty() {
                current_label = heading.clone();
            }
            continue;
        }

        if trimmed.is_empty() || syntax_lines[index] {
            flush_paragraph(
                &mut current_section_paragraphs,
                &mut current_paragraph_lines,
                &mut current_paragraph_start,
                &mut current_paragraph_end,
            );
            continue;
        }

        if current_paragraph_lines.is_empty() {
            current_paragraph_start = line_number;
        }
        current_paragraph_end = line_number;
        current_paragraph_lines.push(trimmed.to_string());
    }

    flush_paragraph(
        &mut current_section_paragraphs,
        &mut current_paragraph_lines,
        &mut current_paragraph_start,
        &mut current_paragraph_end,
    );

    if !current_section_paragraphs.is_empty() {
        sections.push(Section {
            label: current_label,
            paragraphs: current_section_paragraphs,
        });
    }

    sections
}

fn flush_paragraph(
    paragraphs: &mut Vec<Paragraph>,
    current_lines: &mut Vec<String>,
    current_start: &mut usize,
    current_end: &mut usize,
) {
    if current_lines.is_empty() {
        return;
    }

    let text = collapse_whitespace(&current_lines.join(" "));
    if !text.is_empty() {
        paragraphs.push(Paragraph {
            text,
            start_line: *current_start,
            end_line: *current_end,
        });
    }

    current_lines.clear();
    *current_start = 0;
    *current_end = 0;
}

fn push_section_chunks(chunks: &mut Vec<SemanticChunk>, section: &Section) {
    if section.paragraphs.is_empty() {
        return;
    }

    let mut index = 0usize;
    while index < section.paragraphs.len() {
        let start_index = index;
        let mut chunk_paragraphs = vec![section.paragraphs[index].clone()];
        let mut joined_len = section.paragraphs[index].text.len();
        index += 1;

        while index < section.paragraphs.len() {
            let next = &section.paragraphs[index];
            let next_len = next.text.len();
            if joined_len + 2 + next_len > MAX_CHUNK_CHARS {
                break;
            }

            chunk_paragraphs.push(next.clone());
            joined_len += 2 + next_len;
            index += 1;
        }

        if chunk_paragraphs.len() == 1 && chunk_paragraphs[0].text.len() > MAX_CHUNK_CHARS {
            push_long_text_chunks(chunks, &section.label, &chunk_paragraphs[0]);
        } else {
            push_chunk(chunks, &section.label, &chunk_paragraphs);
        }

        if index >= section.paragraphs.len() {
            break;
        }

        let overlap = PARAGRAPH_OVERLAP.min(index.saturating_sub(start_index + 1));
        index = index.saturating_sub(overlap);
    }
}

fn push_long_text_chunks(
    chunks: &mut Vec<SemanticChunk>,
    section_label: &str,
    paragraph: &Paragraph,
) {
    let chars = paragraph.text.chars().collect::<Vec<_>>();
    let mut start = 0usize;

    while start < chars.len() {
        let end = (start + LONG_TEXT_WINDOW).min(chars.len());
        let text = chars[start..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();
        if !text.is_empty() {
            chunks.push(SemanticChunk {
                ordinal: chunks.len(),
                section_label: section_label.to_string(),
                text_hash: hash_string(&text),
                text,
                start_line: paragraph.start_line,
                end_line: paragraph.end_line,
                block_anchor: None,
            });
        }

        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(LONG_TEXT_OVERLAP);
    }
}

fn push_chunk(chunks: &mut Vec<SemanticChunk>, section_label: &str, paragraphs: &[Paragraph]) {
    let text = paragraphs
        .iter()
        .map(|paragraph| paragraph.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let text = collapse_whitespace(&text.replace("\n\n", " "));
    if text.is_empty() {
        return;
    }

    chunks.push(SemanticChunk {
        ordinal: chunks.len(),
        section_label: section_label.to_string(),
        text_hash: hash_string(&text),
        text,
        start_line: paragraphs
            .first()
            .map(|paragraph| paragraph.start_line)
            .unwrap_or(1),
        end_line: paragraphs
            .last()
            .map(|paragraph| paragraph.end_line)
            .unwrap_or(1),
        block_anchor: None,
    });
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn hash_string(value: &str) -> String {
    hash(value.as_bytes()).to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::chunk_markdown;
    use crate::test_support::{load_fixture, load_json_fixture};
    use serde_json::json;

    #[test]
    fn tag_lines_are_content_and_dividers_are_not_search_passages() {
        let chunked = chunk_markdown(
            "# Astrophotography\n\n#code #astrophotography #image-processing #siril #lightroom\n\n---\n\n## Capture\nStack exposures to reduce noise.",
            "Astrophotography",
        );
        assert_eq!(chunked.chunks.len(), 3);
        assert_eq!(chunked.chunks[1].section_label, "Overview");
        assert_eq!(
            chunked.chunks[1].text,
            "#code #astrophotography #image-processing #siril #lightroom"
        );
        assert_eq!(chunked.chunks[2].section_label, "Capture");
        assert_eq!(chunked.chunks[2].text, "Stack exposures to reduce noise.");
        assert!(!chunked.chunks.iter().any(|chunk| chunk.text == "---"));
    }

    #[test]
    fn code_content_does_not_change_sections_or_lose_divider_text() {
        let chunked = chunk_markdown(
            "## Examples\n```markdown\n# literal heading\n\n---\n```\n\nUseful explanation.",
            "Note",
        );
        assert!(chunked
            .chunks
            .iter()
            .skip(1)
            .all(|chunk| chunk.section_label == "Examples"));
        let text = chunked
            .chunks
            .iter()
            .map(|chunk| chunk.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(text.contains("# literal heading"));
        assert!(text.contains("---"));
    }

    #[test]
    fn chunk_markdown_matches_project_atlas_fixture() {
        let markdown = load_fixture("project-atlas.md");
        let chunked = chunk_markdown(&markdown, "project-atlas");

        let actual = json!({
            "title": chunked.title,
            "chunks": chunked.chunks.iter().map(|chunk| json!({
                "sectionLabel": chunk.section_label,
                "text": chunk.text,
                "startLine": chunk.start_line,
                "endLine": chunk.end_line,
            })).collect::<Vec<_>>(),
        });

        assert_eq!(actual, load_json_fixture("project-atlas.chunks.json"));
    }
}
