import { describe, expect, it } from 'vitest';
import { buildLineDiff, buildCreateDiff, buildDeleteDiff } from './diffModel';

describe('buildLineDiff', () => {
  it('counts additions and deletions for a simple edit', () => {
    const model = buildLineDiff('alpha\nbeta\ngamma', 'alpha\nbeta2\ngamma\ndelta');
    expect(model.deletions).toBe(1);
    expect(model.additions).toBe(2);
    expect(model.lines.some((line) => line.kind === 'removed' && line.text === 'beta')).toBe(
      true
    );
    expect(model.lines.some((line) => line.kind === 'added' && line.text === 'beta2')).toBe(true);
    expect(model.lines.some((line) => line.kind === 'added' && line.text === 'delta')).toBe(true);
  });

  it('treats identical documents as context-only', () => {
    const model = buildLineDiff('same\nlines', 'same\nlines');
    expect(model.additions).toBe(0);
    expect(model.deletions).toBe(0);
    expect(model.lines.every((line) => line.kind === 'context')).toBe(true);
  });
});

describe('buildCreateDiff / buildDeleteDiff', () => {
  it('marks create as all additions', () => {
    const model = buildCreateDiff('one\ntwo');
    expect(model.additions).toBe(2);
    expect(model.deletions).toBe(0);
  });

  it('marks delete as all removals', () => {
    const model = buildDeleteDiff('one\ntwo');
    expect(model.additions).toBe(0);
    expect(model.deletions).toBe(2);
  });
});
