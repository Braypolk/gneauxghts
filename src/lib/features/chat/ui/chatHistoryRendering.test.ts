import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderChatHistoryInBatches } from './chatHistoryRendering';

const NativeMessageChannel = globalThis.MessageChannel;

describe('chat history rendering', () => {
  let tasks: Array<() => void>;
  let channels: Array<{ port1: { onmessage: (() => void) | null; close: ReturnType<typeof vi.fn> }; port2: { close: ReturnType<typeof vi.fn> } }>;
  beforeEach(() => {
    vi.useFakeTimers();
    tasks = [];
    channels = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('MessageChannel', class {
      port1 = { onmessage: null as (() => void) | null, close: vi.fn() };
      port2 = { close: vi.fn(), postMessage: () => {
        const run = this.port1.onmessage;
        if (run) tasks.push(run);
      } };
      constructor() { channels.push(this); }
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('mounts 2010 restored messages in separate bounded tasks without frame or timer delivery', () => {
    const counts: number[] = [];
    renderChatHistoryInBatches(2010, 0, count => counts.push(count));
    expect(counts).toEqual([8]);
    let delivered = 0;
    while (tasks.length) {
      expect(tasks).toHaveLength(1);
      tasks.shift()!();
      expect(++delivered).toBeLessThan(252);
    }
    expect(delivered).toBe(251);
    expect(counts).toHaveLength(252);
    expect(counts.every((count, index) => count === Math.min(2010, (index + 1) * 8))).toBe(true);
    expect(channels).toHaveLength(1);
    expect(channels[0].port1.close).toHaveBeenCalledOnce();
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
    expect(channels[0].port1.onmessage).toBeNull();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('progresses through real message-port tasks while timers and frames are withheld', async () => {
    vi.stubGlobal('MessageChannel', NativeMessageChannel);
    const counts: number[] = [];
    await new Promise<void>(resolve => {
      renderChatHistoryInBatches(2010, 0, count => {
        counts.push(count);
        if (count === 2010) resolve();
      });
      expect(counts).toEqual([8]);
    });
    expect(counts).toHaveLength(252);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels obsolete conversation work and ignores an already queued task', () => {
    const oldRender = vi.fn();
    const cancel = renderChatHistoryInBatches(35, 0, oldRender);
    cancel();
    cancel();
    const nextRender = vi.fn();
    renderChatHistoryInBatches(2, 0, nextRender);
    tasks.shift()!();
    expect(oldRender).toHaveBeenCalledExactlyOnceWith(8);
    expect(nextRender).toHaveBeenCalledExactlyOnceWith(2);
    expect(tasks).toHaveLength(0);
    expect(channels[0].port1.close).toHaveBeenCalledOnce();
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
    expect(channels[0].port1.onmessage).toBeNull();
  });

  it('releases its message ports if a later render batch throws', () => {
    renderChatHistoryInBatches(35, 0, count => {
      if (count > 8) throw new Error('render failed');
    });
    expect(() => tasks.shift()!()).toThrow('render failed');
    expect(tasks).toHaveLength(0);
    expect(channels[0].port1.onmessage).toBeNull();
    expect(channels[0].port1.close).toHaveBeenCalledOnce();
    expect(channels[0].port2.close).toHaveBeenCalledOnce();
  });

  it('continues an already mounted conversation without restarting its history', () => {
    const render = vi.fn();
    renderChatHistoryInBatches(38, 35, render);
    expect(render).toHaveBeenCalledExactlyOnceWith(38);
    expect(channels).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });
});
