import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatScrollPositionsFor,
  createChatScrollScheduler,
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


describe('chat scroll scheduling', () => {
  afterEach(() => vi.unstubAllGlobals());

  function frames() {
    let next = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++next, callback);
      return next;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    return () => {
      const ready = [...callbacks.values()];
      callbacks.clear();
      ready.forEach(callback => callback(0));
    };
  }

  it('coalesces streaming updates into the latest scroll write', () => {
    const paint = frames();
    const scroll = createChatScrollScheduler();
    const first = vi.fn();
    const latest = vi.fn();
    scroll.schedule('follow', first);
    scroll.schedule('follow', latest);
    paint();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it('prioritizes the newest anchor over initial correction and streaming', () => {
    const paint = frames();
    const scroll = createChatScrollScheduler();
    const passive = vi.fn();
    const oldAnchor = vi.fn();
    const anchor = vi.fn();
    scroll.schedule('follow', passive);
    scroll.schedule('initial', passive);
    scroll.schedule('anchor', oldAnchor);
    scroll.schedule('anchor', anchor);
    scroll.schedule('follow', passive);
    paint();
    expect(passive).not.toHaveBeenCalled();
    expect(oldAnchor).not.toHaveBeenCalled();
    expect(anchor).toHaveBeenCalledOnce();
  });

  it('cancels an obsolete conversation and permits new scroll work', () => {
    const paint = frames();
    const scroll = createChatScrollScheduler();
    const obsolete = vi.fn();
    const current = vi.fn();
    scroll.schedule('anchor', obsolete);
    scroll.cancel();
    paint();
    scroll.schedule('initial', current);
    paint();
    expect(obsolete).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
  });
});
