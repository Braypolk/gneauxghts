import { describe, expect, it, vi } from 'vitest';
import {
  followLatestChatContent,
  isNearLatestChatContent,
  positionInitialChatScroll
} from './chatMessageScroll';

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

describe('streaming chat scroll following', () => {
  it('continues following while the viewport is near the latest content', () => {
    expect(
      isNearLatestChatContent({
        scrollTop: 1160,
        clientHeight: 800,
        scrollHeight: 2000
      })
    ).toBe(true);
  });

  it('disengages following after the user scrolls away from the latest content', () => {
    expect(
      isNearLatestChatContent({
        scrollTop: 1000,
        clientHeight: 800,
        scrollHeight: 2000
      })
    ).toBe(false);
  });

  it('re-enables following when the viewport returns to the bottom', () => {
    const root = {
      scrollTop: 900,
      clientHeight: 800,
      scrollHeight: 2000
    };

    expect(isNearLatestChatContent(root)).toBe(false);
    root.scrollTop = 1200;
    expect(isNearLatestChatContent(root)).toBe(true);
  });

  it('positions streaming content without queuing a smooth animation', () => {
    const root = { scrollTop: 1000, scrollHeight: 2040 };

    followLatestChatContent(root);

    expect(root.scrollTop).toBe(2040);
  });
});
