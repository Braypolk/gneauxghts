import { describe, expect, it, vi } from 'vitest';
import {
  chatScrollPositionsFor,
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

  it('restores an older reading position, including the very top', () => {
    for (const scrollTop of [0, 240]) {
      const root = { scrollTop: 600, scrollHeight: 840 };
      positionInitialChatScroll(root, null, { scrollTop, followingLatest: false });
      expect(root.scrollTop).toBe(scrollTop);
    }
  });

  it('follows new content when the saved viewport was following the latest message', () => {
    const root = { scrollTop: 0, scrollHeight: 1200 };
    positionInitialChatScroll(root, null, { scrollTop: 840, followingLatest: true });
    expect(root.scrollTop).toBe(1200);
  });

  it('gives explicit message navigation priority over a saved reading position', () => {
    const root = { scrollTop: 0, scrollHeight: 840 };
    const target = { scrollIntoView: vi.fn() };
    positionInitialChatScroll(root, target, { scrollTop: 240, followingLatest: false });
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(root.scrollTop).toBe(0);
  });

  it('retains separate conversation positions across remounts without sharing pane viewports', () => {
    const surface = {};
    const positions = chatScrollPositionsFor(surface);
    positions.set('chat-a', { scrollTop: 240, followingLatest: false });
    positions.set('chat-b', { scrollTop: 840, followingLatest: true });
    expect(chatScrollPositionsFor(surface).get('chat-a')?.scrollTop).toBe(240);
    expect(chatScrollPositionsFor(surface).get('chat-b')?.followingLatest).toBe(true);
    expect(chatScrollPositionsFor({}).size).toBe(0);
  });
});

describe('streaming chat scroll following', () => {
  it('continues following while the viewport is near the latest content', () => {
    expect(
      isNearLatestChatContent({
        scrollTop: 1199,
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
    expect(isNearLatestChatContent({ scrollTop: 1180, clientHeight: 800, scrollHeight: 2000 })).toBe(false);
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

  it('positions initial content without queuing a smooth animation', () => {
    const root = { scrollTop: 1000, scrollHeight: 2040 };

    followLatestChatContent(root);

    expect(root.scrollTop).toBe(2040);
  });
});
