import { describe, expect, it } from 'vitest';
import { mergeLocalModels } from './localModels';

describe('mergeLocalModels', () => {
  it('keeps the configured model available while discovery is offline', () => {
    expect(mergeLocalModels([], 'qwen/qwen3.8-27b')).toEqual([
      { id: 'qwen/qwen3.8-27b', ownedBy: null }
    ]);
  });

  it('deduplicates the configured model against discovered models', () => {
    expect(
      mergeLocalModels(
        [
          { id: 'qwen/qwen3.8-27b', ownedBy: 'lm-studio' },
          { id: 'gemma-3-12b', ownedBy: null }
        ],
        'qwen/qwen3.8-27b'
      )
    ).toEqual([
      { id: 'qwen/qwen3.8-27b', ownedBy: 'lm-studio' },
      { id: 'gemma-3-12b', ownedBy: null }
    ]);
  });

  it('ignores blank model identifiers', () => {
    expect(
      mergeLocalModels(
        [
          { id: '  ', ownedBy: null },
          { id: ' qwen3.5-9b ', ownedBy: null }
        ],
        ' '
      )
    ).toEqual([{ id: 'qwen3.5-9b', ownedBy: null }]);
  });
});
