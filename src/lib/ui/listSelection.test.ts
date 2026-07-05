import { describe, expect, it } from 'vitest';
import {
  getNextListSelectionIndex,
  getSelectableListIndexes,
  moveListSelection,
  pointListSelection
} from '$lib/ui/listSelection';

describe('listSelection', () => {
  it('wraps through selectable indexes', () => {
    expect(getNextListSelectionIndex(0, 1, { optionCount: 3 })).toBe(1);
    expect(getNextListSelectionIndex(2, 1, { optionCount: 3 })).toBe(0);
    expect(getNextListSelectionIndex(0, -1, { optionCount: 3 })).toBe(2);
  });

  it('skips disabled options', () => {
    const isOptionDisabled = (index: number) => index === 1;

    expect(getSelectableListIndexes({ optionCount: 4, isOptionDisabled })).toEqual([0, 2, 3]);
    expect(getNextListSelectionIndex(0, 1, { optionCount: 4, isOptionDisabled })).toBe(2);
    expect(getNextListSelectionIndex(2, -1, { optionCount: 4, isOptionDisabled })).toBe(0);
  });

  it('uses the first selectable option when current index is unavailable', () => {
    expect(
      getNextListSelectionIndex(1, 1, {
        optionCount: 3,
        isOptionDisabled: (index) => index === 1
      })
    ).toBe(0);
  });

  it('marks keyboard and pointer navigation mode', () => {
    expect(moveListSelection({ activeIndex: 0, navigationMode: 'pointer' }, 1, { optionCount: 2 }))
      .toEqual({ activeIndex: 1, navigationMode: 'keyboard' });
    expect(pointListSelection(1, { optionCount: 2 })).toEqual({
      activeIndex: 1,
      navigationMode: 'pointer'
    });
  });

  it('rejects disabled pointer targets', () => {
    expect(
      pointListSelection(1, {
        optionCount: 2,
        isOptionDisabled: (index) => index === 1
      })
    ).toBeNull();
  });
});
