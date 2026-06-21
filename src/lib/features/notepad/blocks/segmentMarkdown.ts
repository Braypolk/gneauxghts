import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

// Block addressing is the foundation of structured AI operations: before a note
// is sent to the model we segment its Markdown into stable, addressable blocks
// and send ids + hashes + light context. The model returns operations that
// reference those `blockId`s, and apply re-segments the live file to remap each
// op's `anchorHash` to a current range.
//
// This module is intentionally pure and runtime-neutral (no DOM, no EditorView):
// it builds an `EditorState` purely to reuse the SAME Lezer GFM markdown tree the
// editor renders from (`markdownLanguage`), then walks the top-level block nodes.
// That keeps segmentation consistent between what the editor shows, what we pack
// for the model, and what apply remaps against — one document model, one parse.

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'codeFence'
  | 'blockquote'
  | 'table'
  | 'horizontalRule'
  | 'frontmatter'
  | 'other';

export interface Block {
  /** Stable identity: hash(normalizedText + ":" + ordinalAmongSameKind). Survives
   *  edits to *other* blocks and in-place edits that preserve normalized text. */
  blockId: string;
  /** Hash of the block's current text. Apply compares this against the live file
   *  to detect a stale single block without failing the whole proposal. */
  anchorHash: string;
  /** Document offsets [from, to) of the block, trailing blank line excluded. */
  from: number;
  to: number;
  kind: BlockKind;
  /** Exact source text of the block (no trailing block separator). */
  text: string;
  /** 0-based position among all blocks in document order. */
  ordinal: number;
}

// Map of Lezer GFM top-level node names → our coarse block kind. Anything not
// listed that appears as a direct child of `Document` falls back to 'other' but
// is still emitted as a block so nothing is silently dropped.
const NODE_KIND: Record<string, BlockKind> = {
  ATXHeading1: 'heading',
  ATXHeading2: 'heading',
  ATXHeading3: 'heading',
  ATXHeading4: 'heading',
  ATXHeading5: 'heading',
  ATXHeading6: 'heading',
  SetextHeading1: 'heading',
  SetextHeading2: 'heading',
  Paragraph: 'paragraph',
  FencedCode: 'codeFence',
  CodeBlock: 'codeFence',
  Blockquote: 'blockquote',
  BulletList: 'list',
  OrderedList: 'list',
  Table: 'table',
  HorizontalRule: 'horizontalRule',
  // Frontmatter is exposed by the GFM parser config when present.
  Frontmatter: 'frontmatter',
  FrontMatter: 'frontmatter'
};

let cachedState: { doc: string; state: EditorState } | null = null;

function stateFor(doc: string): EditorState {
  if (cachedState && cachedState.doc === doc) {
    return cachedState.state;
  }
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })]
  });
  cachedState = { doc, state };
  return state;
}

/**
 * Segment a Markdown document into ordered, addressable blocks.
 *
 * Deterministic: identical input always yields an identical block list
 * (including ids and hashes), which is what makes `blockId` a usable address.
 */
export function segmentMarkdown(doc: string): Block[] {
  const state = stateFor(doc);
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) {
    // Parsing should not fail for well-formed input; treat the whole doc as one
    // block rather than throwing, so callers always get an addressable unit.
    return doc.trim().length === 0 ? [] : [finalizeBlock(doc, 0, doc.length, 'other', 0, [])];
  }

  const raw: { from: number; to: number; kind: BlockKind }[] = [];
  const cursor = tree.cursor();
  // Walk only the direct children of the Document root: those are the block
  // units. We do not descend (list items, headings keep their internal markup).
  if (cursor.firstChild()) {
    do {
      const kind = NODE_KIND[cursor.name] ?? 'other';
      raw.push({ from: cursor.from, to: cursor.to, kind });
    } while (cursor.nextSibling());
  }

  if (raw.length === 0) {
    return [];
  }

  // Per-kind ordinal so that, e.g., two identical paragraphs get distinct ids.
  const kindCounts: Partial<Record<BlockKind, number>> = {};
  return raw.map((node, ordinal) => {
    const kindOrdinal = kindCounts[node.kind] ?? 0;
    kindCounts[node.kind] = kindOrdinal + 1;
    const siblingOrdinals: number[] = [kindOrdinal];
    return finalizeBlock(doc, node.from, node.to, node.kind, ordinal, siblingOrdinals);
  });
}

function finalizeBlock(
  doc: string,
  from: number,
  to: number,
  kind: BlockKind,
  ordinal: number,
  siblingOrdinals: number[]
): Block {
  const text = doc.slice(from, to);
  const normalized = normalizeBlockText(text);
  const blockId = `b_${hashString(`${kind}:${normalized}:${siblingOrdinals.join('.')}`)}`;
  const anchorHash = hashString(text);
  return { blockId, anchorHash, from, to, kind, text, ordinal };
}

/**
 * Normalize block text for identity hashing: collapse internal whitespace runs
 * and trim, so cosmetic reflow (a wrapped line, a trailing space) does not change
 * a block's `blockId`. The exact `text` and `anchorHash` still capture the real
 * content for diffing and stale detection.
 */
export function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function findBlockById(blocks: Block[], blockId: string): Block | undefined {
  return blocks.find((block) => block.blockId === blockId);
}

/**
 * A serializable snapshot of the block map captured at generation time. The Rust
 * side stores this in `base_block_map` so apply can re-segment and remap ops.
 */
export interface BlockMapEntry {
  blockId: string;
  anchorHash: string;
  kind: BlockKind;
  ordinal: number;
}

export function toBlockMap(blocks: Block[]): BlockMapEntry[] {
  return blocks.map(({ blockId, anchorHash, kind, ordinal }) => ({
    blockId,
    anchorHash,
    kind,
    ordinal
  }));
}

/**
 * FNV-1a (32-bit) hex hash. Pure and dependency-free — these hashes only need to
 * be stable and well-distributed *within* the app for block addressing; they are
 * deliberately NOT the same as the Rust blake3 file-level `content_hash`, which
 * remains the authoritative whole-file conflict gate.
 */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in safe integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 coerces to unsigned 32-bit before hex formatting.
  return (hash >>> 0).toString(16).padStart(8, '0');
}
