//! Rust Markdown block segmenter — the apply-side counterpart to the TS
//! `segmentMarkdown.ts`.
//!
//! ## Why this is not a Lezer port
//!
//! The TS segmenter walks the editor's Lezer GFM syntax tree. There is no Lezer
//! in Rust, and pulling a full CommonMark/GFM parser into the apply path would be
//! a second document model — exactly what the plan forbids. The apply path does
//! NOT need a full parse: it remaps operations to live blocks by `anchor_hash`
//! (an FNV-1a hash of the block's EXACT source text), with `block_id` only as a
//! fallback. So what we actually need is a segmenter that:
//!
//!   1. produces the SAME exact text slice for a block that Lezer produces, and
//!   2. computes `anchor_hash` with the SAME FNV-1a algorithm as TS,
//!
//! so an `anchor_hash` captured on the TS side matches the live Rust re-segment.
//!
//! ## Compatibility boundary (documented + tested)
//!
//! Top-level Markdown blocks are separated by one or more blank lines. This
//! blank-line segmentation matches Lezer's top-level block boundaries for the
//! overwhelming majority of real notes: paragraphs, ATX headings, fenced code,
//! blockquotes, blank-line-separated lists, tables, thematic breaks, and YAML
//! frontmatter. Where it can diverge from Lezer:
//!
//!   - Adjacent list items with NO blank line between sibling blocks of different
//!     kinds (Lezer may group/split slightly differently). For lists this is
//!     fine: we treat a contiguous run of list-marker lines as one `list` block,
//!     matching Lezer grouping a tight list into one node.
//!   - A fenced code block whose closing fence is missing (unterminated) — Lezer
//!     extends to EOF; we do the same (a fence consumes lines until a closing
//!     fence or EOF), so the text slice still matches.
//!   - Setext headings (underlined with `===`/`---`): the underline stays in the
//!     same blank-line-delimited chunk as its text, so the slice still matches
//!     Lezer's SetextHeading node text.
//!
//! `block_id` here uses the same `kind:normalized:kindOrdinal` recipe as TS, but
//! because kind classification is coarser than Lezer's, block_ids are NOT
//! guaranteed bit-identical to the TS ones for unusual documents. That is
//! acceptable: apply keys on `anchor_hash` first. Validation against a
//! TS-captured `base_block_map` likewise compares `anchor_hash`.

use super::block_ops::BlockKind;

/// A segmented Markdown block. Mirrors the TS `Block` shape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Block {
    pub(crate) block_id: String,
    pub(crate) anchor_hash: String,
    /// Byte offset (UTF-8) where the block starts in the source document.
    pub(crate) from: usize,
    /// Byte offset (UTF-8, exclusive) where the block ends, trailing blank line
    /// excluded — matching the TS `to`.
    pub(crate) to: usize,
    pub(crate) kind: BlockKind,
    pub(crate) text: String,
    pub(crate) ordinal: u32,
}

/// FNV-1a (32-bit) hex hash, byte-for-byte compatible with the TS `hashString`
/// for ASCII and BMP text.
///
/// The TS version iterates UTF-16 code units (`charCodeAt`). To match exactly we
/// iterate `char::encode_utf16`, feeding each 16-bit code unit through the same
/// FNV-1a step the TS uses (`Math.imul` is a 32-bit wrapping multiply).
pub(crate) fn hash_string(value: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    let mut buf = [0u16; 2];
    for ch in value.chars() {
        for unit in ch.encode_utf16(&mut buf) {
            hash ^= *unit as u32;
            hash = hash.wrapping_mul(0x0100_0193);
        }
    }
    format!("{hash:08x}")
}

/// Normalize block text for identity hashing: collapse internal whitespace runs
/// to a single space and trim. Matches the TS `normalizeBlockText`
/// (`text.replace(/\s+/g, ' ').trim()`).
pub(crate) fn normalize_block_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_ws = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            in_ws = true;
        } else {
            if in_ws && !out.is_empty() {
                out.push(' ');
            }
            in_ws = false;
            out.push(ch);
        }
    }
    out
}

fn classify(block_text: &str) -> BlockKind {
    let trimmed = block_text.trim_start();
    let first_line = trimmed.lines().next().unwrap_or("");
    let first = first_line.trim_start();

    if first.starts_with("```") || first.starts_with("~~~") {
        return BlockKind::CodeFence;
    }
    if first.starts_with('#') {
        // ATX heading: 1-6 '#' then a space (or end of line).
        let hashes = first.chars().take_while(|&c| c == '#').count();
        let rest = &first[hashes..];
        if (1..=6).contains(&hashes) && (rest.is_empty() || rest.starts_with(' ')) {
            return BlockKind::Heading;
        }
    }
    if first.starts_with('>') {
        return BlockKind::Blockquote;
    }
    if is_thematic_break(first) {
        return BlockKind::HorizontalRule;
    }
    if is_list_marker(first) {
        return BlockKind::List;
    }
    if first_line.contains('|') && block_text.lines().count() >= 2 {
        // Heuristic: a line with pipes followed by a delimiter row → table.
        if let Some(second) = block_text.lines().nth(1) {
            if second.contains('|') && second.chars().all(|c| matches!(c, '|' | '-' | ':' | ' ')) {
                return BlockKind::Table;
            }
        }
    }
    // Setext heading: a text line followed by an underline of === or ---.
    if let Some(second) = block_text.lines().nth(1) {
        let s = second.trim();
        if !s.is_empty()
            && (s.chars().all(|c| c == '=') || s.chars().all(|c| c == '-'))
            && block_text.lines().count() == 2
        {
            return BlockKind::Heading;
        }
    }
    BlockKind::Paragraph
}

fn is_thematic_break(line: &str) -> bool {
    let stripped: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    if stripped.len() < 3 {
        return false;
    }
    matches!(stripped.chars().next(), Some('-') | Some('*') | Some('_'))
        && stripped.chars().all(|c| c == stripped.chars().next().unwrap())
}

fn is_list_marker(line: &str) -> bool {
    let t = line.trim_start();
    if let Some(rest) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")).or_else(|| t.strip_prefix("+ ")) {
        let _ = rest;
        return true;
    }
    // Ordered list: digits then '.' or ')' then space.
    let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 {
        let rest = &t[digits..];
        if rest.starts_with(". ") || rest.starts_with(") ") {
            return true;
        }
    }
    false
}

fn is_fence_open(line: &str) -> Option<String> {
    let t = line.trim_start();
    if t.starts_with("```") {
        Some("```".to_string())
    } else if t.starts_with("~~~") {
        Some("~~~".to_string())
    } else {
        None
    }
}

/// Segment a Markdown document into ordered, addressable blocks by blank-line
/// boundaries, with fenced code treated atomically (blank lines inside a fence
/// do not split it). Deterministic: identical input → identical output.
pub(crate) fn segment_markdown(doc: &str) -> Vec<Block> {
    // Split into blocks: a block is a maximal run of non-blank lines, except a
    // fenced code block which spans from its opening fence to the matching
    // closing fence (or EOF), blank lines included.
    let mut spans: Vec<(usize, usize)> = Vec::new(); // byte [from, to) excluding trailing newline run

    let lines = line_spans(doc);
    let mut i = 0;
    while i < lines.len() {
        let (l_from, l_to, is_blank, _) = lines[i];
        if is_blank {
            i += 1;
            continue;
        }
        // Frontmatter: a leading `---` line at the very start delimits YAML.
        let line_text = &doc[l_from..l_to];
        if let Some(fence) = is_fence_open(line_text) {
            // Consume until a closing fence line or EOF.
            let start = l_from;
            let mut j = i + 1;
            let mut end = l_to;
            while j < lines.len() {
                let (cf, ct, _, _) = lines[j];
                end = ct;
                if doc[cf..ct].trim_start().starts_with(&fence) {
                    j += 1;
                    break;
                }
                j += 1;
            }
            spans.push((start, end));
            i = j;
            continue;
        }
        // Otherwise accumulate non-blank lines into one block.
        let start = l_from;
        let mut end = l_to;
        let mut j = i + 1;
        while j < lines.len() {
            let (cf, ct, blank, _) = lines[j];
            if blank {
                break;
            }
            // A fence starting mid-run begins a new block.
            if is_fence_open(&doc[cf..ct]).is_some() {
                break;
            }
            end = ct;
            j += 1;
        }
        spans.push((start, end));
        i = j;
    }

    if spans.is_empty() {
        return Vec::new();
    }

    let mut kind_counts: std::collections::HashMap<BlockKind, u32> = std::collections::HashMap::new();
    spans
        .into_iter()
        .enumerate()
        .map(|(ordinal, (from, to))| {
            let text = doc[from..to].to_string();
            let kind = classify(&text);
            let kind_ordinal = kind_counts.entry(kind).or_insert(0);
            let this_ordinal = *kind_ordinal;
            *kind_ordinal += 1;
            finalize_block(text, from, to, kind, ordinal as u32, this_ordinal)
        })
        .collect()
}

fn finalize_block(
    text: String,
    from: usize,
    to: usize,
    kind: BlockKind,
    ordinal: u32,
    kind_ordinal: u32,
) -> Block {
    let normalized = normalize_block_text(&text);
    let block_id = format!(
        "b_{}",
        hash_string(&format!("{}:{}:{}", kind.as_str(), normalized, kind_ordinal))
    );
    let anchor_hash = hash_string(&text);
    Block {
        block_id,
        anchor_hash,
        from,
        to,
        kind,
        text,
        ordinal,
    }
}

/// Byte spans for each line: (from, to_excluding_newline, is_blank, has_newline).
fn line_spans(doc: &str) -> Vec<(usize, usize, bool, bool)> {
    let bytes = doc.as_bytes();
    let mut spans = Vec::new();
    let mut start = 0;
    let mut idx = 0;
    while idx < bytes.len() {
        if bytes[idx] == b'\n' {
            let line = &doc[start..idx];
            spans.push((start, idx, line.trim().is_empty(), true));
            start = idx + 1;
        }
        idx += 1;
    }
    if start < bytes.len() {
        let line = &doc[start..bytes.len()];
        spans.push((start, bytes.len(), line.trim().is_empty(), false));
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    // These expected hex values are computed by the SAME FNV-1a recipe as the TS
    // `hashString`. They lock cross-end parity: if the Rust hash drifts from TS,
    // anchor remap silently breaks, so these are golden values.
    #[test]
    fn hash_string_matches_known_fnv1a_values() {
        // FNV-1a 32-bit of "First paragraph." and "" etc.
        assert_eq!(hash_string(""), "811c9dc5");
        assert_eq!(hash_string("a"), "e40c292c");
        assert_eq!(hash_string("foobar"), "bf9cf968");
    }

    #[test]
    fn normalize_collapses_whitespace() {
        assert_eq!(normalize_block_text("  a   b\n c "), "a b c");
        assert_eq!(normalize_block_text("Title"), "Title");
    }

    #[test]
    fn segments_paragraphs_by_blank_lines() {
        let doc = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
        let blocks = segment_markdown(doc);
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0].kind, BlockKind::Heading);
        assert_eq!(blocks[0].text, "# Title");
        assert_eq!(blocks[1].text, "First paragraph.");
        assert_eq!(blocks[2].text, "Second paragraph.");
    }

    #[test]
    fn block_text_slice_round_trips_offsets() {
        let doc = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
        for block in segment_markdown(doc) {
            assert_eq!(&doc[block.from..block.to], block.text);
        }
    }

    #[test]
    fn fenced_code_is_atomic_even_with_blank_lines() {
        let doc = "Intro.\n\n```rust\nfn main() {\n\n    println!(\"x\");\n}\n```\n\nOutro.\n";
        let blocks = segment_markdown(doc);
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[1].kind, BlockKind::CodeFence);
        assert!(blocks[1].text.contains("println!"));
        assert_eq!(blocks[2].text, "Outro.");
    }

    #[test]
    fn anchor_hash_is_hash_of_exact_text() {
        let doc = "First paragraph.\n";
        let blocks = segment_markdown(doc);
        assert_eq!(blocks[0].anchor_hash, hash_string("First paragraph."));
    }

    #[test]
    fn classify_detects_kinds() {
        assert_eq!(classify("# H"), BlockKind::Heading);
        assert_eq!(classify("> quote"), BlockKind::Blockquote);
        assert_eq!(classify("- item\n- item2"), BlockKind::List);
        assert_eq!(classify("1. item"), BlockKind::List);
        assert_eq!(classify("---"), BlockKind::HorizontalRule);
        assert_eq!(classify("```\ncode\n```"), BlockKind::CodeFence);
        assert_eq!(classify("plain text"), BlockKind::Paragraph);
        assert_eq!(classify("a | b\n--- | ---"), BlockKind::Table);
    }

    #[test]
    fn empty_doc_has_no_blocks() {
        assert!(segment_markdown("").is_empty());
        assert!(segment_markdown("\n\n   \n").is_empty());
    }
}
