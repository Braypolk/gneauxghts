import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { resolveEditorTextTarget } from './navigation';

describe('document navigation targets', () => {
  it('finds unrendered targets in the full document', () => {
    const doc = Text.of([...Array.from({ length: 1000 }, (_, i) => `filler ${i}`), '- [ ] destination']);
    expect(resolveEditorTextTarget(doc, 'destination')).toBe(doc.line(1001).from);
  });
  it('uses only verified hints and rejects ambiguous stale destinations', () => {
    const doc = Text.of(['same', 'other', 'same']);
    expect(resolveEditorTextTarget(doc, 'same', 3)).toBe(11);
    expect(resolveEditorTextTarget(doc, 'same', 2)).toBeNull();
    expect(resolveEditorTextTarget(doc, 'missing', 2)).toBeNull();
    expect(resolveEditorTextTarget(doc, 'other', 100)).toBe(5);
  });
  it('matches rendered Markdown labels without relying on DOM nodes', () => {
    expect(resolveEditorTextTarget(Text.of(['intro', '## A **heading** with [[note|alias]]']), 'A heading with alias')).toBe(6);
  });
});

it('resolves multi-line paragraphs without mounted lines', () => {
  const doc = Text.of(['intro', '', 'a long **paragraph**', 'continued here']);
  expect(resolveEditorTextTarget(doc, 'a long paragraph continued here')).toBe(7);
});
