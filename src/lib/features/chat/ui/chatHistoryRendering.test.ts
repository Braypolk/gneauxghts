import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderChatHistoryInBatches } from './chatHistoryRendering';

describe('chat history rendering', () => {
  let frames: Array<FrameRequestCallback>;
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('finishes a restored thread in bounded batches when native frames stop', async () => {
    const counts: number[] = [];
    renderChatHistoryInBatches(35, 0, count => counts.push(count));
    expect(counts).toEqual([8]);
    await vi.advanceTimersByTimeAsync(200);
    expect(counts).toEqual([8, 16, 24, 32, 35]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses available frames and ignores late delivery after the timer wins', async () => {
    const counts: number[] = [];
    renderChatHistoryInBatches(25, 0, count => counts.push(count));
    frames[0](0);
    expect(counts).toEqual([8, 16]);
    await vi.advanceTimersByTimeAsync(50);
    expect(counts).toEqual([8, 16, 24]);
    frames[1](50);
    expect(counts).toEqual([8, 16, 24]);
    frames[2](60);
    expect(counts).toEqual([8, 16, 24, 25]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels obsolete conversation work before either callback can render', async () => {
    const oldRender = vi.fn();
    const cancel = renderChatHistoryInBatches(35, 0, oldRender);
    cancel();
    const nextRender = vi.fn();
    renderChatHistoryInBatches(2, 0, nextRender);
    frames[0](0);
    await vi.advanceTimersByTimeAsync(200);
    expect(oldRender).toHaveBeenCalledExactlyOnceWith(8);
    expect(nextRender).toHaveBeenCalledExactlyOnceWith(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues an already mounted conversation without restarting its history', () => {
    const render = vi.fn();
    renderChatHistoryInBatches(38, 35, render);
    expect(render).toHaveBeenCalledExactlyOnceWith(38);
    expect(frames).toHaveLength(0);
  });
});
