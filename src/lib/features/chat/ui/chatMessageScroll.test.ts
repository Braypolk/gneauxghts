import { describe, expect, it, vi } from 'vitest';
import { positionInitialChatScroll } from './chatMessageScroll';

describe('initial chat scroll positioning', () => {
  it('places an ordinary conversation directly at the bottom', () => {
    const root = { scrollTop: 0, scrollHeight: 840 };

    positionInitialChatScroll(root, null);

    expect(root.scrollTop).toBe(840);
  });

  it('positions an anchored conversation immediately at its target', () => {
    const root = { scrollTop: 0, scrollHeight: 840 };
    const target = { scrollIntoView: vi.fn() };

    positionInitialChatScroll(root, target);

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center'
    });
    expect(root.scrollTop).toBe(0);
  });
});
