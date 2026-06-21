import { describe, expect, it } from 'vitest';

import {
  findBlockById,
  hashString,
  normalizeBlockText,
  segmentMarkdown,
  toBlockMap
} from './segmentMarkdown';

const SAMPLE = `# Title

First paragraph with some content.

## Section A

- one
- two
- three

Second paragraph here.

\`\`\`js
const x = 1;
\`\`\`

> a quote
`;

describe('segmentMarkdown', () => {
  it('segments a note into ordered top-level blocks', () => {
    const blocks = segmentMarkdown(SAMPLE);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'paragraph',
      'codeFence',
      'blockquote'
    ]);
    // Ordinals are dense and in document order.
    expect(blocks.map((b) => b.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('captures exact source text and offsets for each block', () => {
    const blocks = segmentMarkdown(SAMPLE);
    for (const block of blocks) {
      expect(SAMPLE.slice(block.from, block.to)).toBe(block.text);
    }
    expect(blocks[0].text).toBe('# Title');
    expect(blocks[3].text).toBe('- one\n- two\n- three');
  });

  it('is deterministic: identical input yields identical ids and hashes', () => {
    const a = segmentMarkdown(SAMPLE);
    const b = segmentMarkdown(SAMPLE);
    expect(a).toEqual(b);
  });

  it('produces unique blockIds even for identical-looking blocks', () => {
    const doc = 'Same line.\n\nSame line.\n';
    const blocks = segmentMarkdown(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].blockId).not.toBe(blocks[1].blockId);
  });

  it('returns an empty list for blank input', () => {
    expect(segmentMarkdown('')).toEqual([]);
    expect(segmentMarkdown('   \n  \n')).toEqual([]);
  });
});

describe('block_id stability under realistic edits', () => {
  it('keeps unedited blocks stable when an unrelated block is edited in place', () => {
    const before = segmentMarkdown(SAMPLE);
    // Edit only the second paragraph's wording.
    const edited = SAMPLE.replace('Second paragraph here.', 'Second paragraph, revised.');
    const after = segmentMarkdown(edited);

    const beforeHeading = before.find((b) => b.text === '# Title')!;
    const afterHeading = after.find((b) => b.text === '# Title')!;
    expect(afterHeading.blockId).toBe(beforeHeading.blockId);

    const beforeList = before.find((b) => b.kind === 'list')!;
    const afterList = after.find((b) => b.kind === 'list')!;
    expect(afterList.blockId).toBe(beforeList.blockId);
  });

  it('keeps existing block ids stable when a new block is inserted', () => {
    const before = segmentMarkdown(SAMPLE);
    const inserted = SAMPLE.replace('## Section A', 'Inserted paragraph.\n\n## Section A');
    const after = segmentMarkdown(inserted);

    const beforeQuote = before.find((b) => b.kind === 'blockquote')!;
    const afterQuote = after.find((b) => b.kind === 'blockquote')!;
    // The blockquote text is unchanged and remains the only blockquote, so its
    // identity survives despite everything shifting down by one block.
    expect(afterQuote.blockId).toBe(beforeQuote.blockId);
  });

  it('changes anchorHash when a block is edited in place', () => {
    const before = segmentMarkdown(SAMPLE);
    const edited = SAMPLE.replace('First paragraph with some content.', 'First paragraph CHANGED.');
    const after = segmentMarkdown(edited);

    const beforePara = before[1];
    const afterPara = after[1];
    expect(afterPara.anchorHash).not.toBe(beforePara.anchorHash);
  });

  it('matches reordered blocks by anchorHash (content), not by blockId', () => {
    // blockId binds (kind, normalized text, kind-ordinal): a true reorder of two
    // distinct same-kind blocks therefore swaps their ids, because the id encodes
    // the slot. The remap that survives reorder is by anchorHash (content), which
    // is exactly what the Rust apply path uses. We assert that contract here.
    const original = 'Alpha paragraph.\n\nBravo paragraph.\n';
    const swapped = 'Bravo paragraph.\n\nAlpha paragraph.\n';
    const before = segmentMarkdown(original);
    const after = segmentMarkdown(swapped);

    const alphaBefore = before.find((b) => b.text.includes('Alpha'))!;
    const alphaAfter = after.find((b) => b.text.includes('Alpha'))!;
    // Content hash is stable across the move even though the slot id changed.
    expect(alphaAfter.anchorHash).toBe(alphaBefore.anchorHash);
    expect(alphaAfter.blockId).not.toBe(alphaBefore.blockId);
    expect(alphaAfter.ordinal).not.toBe(alphaBefore.ordinal);
  });
});

describe('toBlockMap', () => {
  it('produces a serializable snapshot for base_block_map', () => {
    const map = toBlockMap(segmentMarkdown(SAMPLE));
    expect(map).toHaveLength(7);
    for (const entry of map) {
      expect(entry).toHaveProperty('blockId');
      expect(entry).toHaveProperty('anchorHash');
      expect(entry).toHaveProperty('kind');
      expect(entry).toHaveProperty('ordinal');
    }
  });
});

describe('findBlockById', () => {
  it('locates a block by id', () => {
    const blocks = segmentMarkdown(SAMPLE);
    const target = blocks[3];
    expect(findBlockById(blocks, target.blockId)).toBe(target);
    expect(findBlockById(blocks, 'nope')).toBeUndefined();
  });
});

describe('hashString / normalizeBlockText', () => {
  it('hashes deterministically and distinctly', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    expect(hashString('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('collapses whitespace for identity while preserving words', () => {
    expect(normalizeBlockText('a   b\n\tc')).toBe('a b c');
    expect(normalizeBlockText('  trimmed  ')).toBe('trimmed');
  });
});
