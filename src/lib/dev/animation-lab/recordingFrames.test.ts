import { describe, expect, it, vi } from 'vitest';
import { createRecordingFrames } from './recordingFrames';

function fixture() {
  let recording = true, id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const native = { raf: (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; }, cancel: vi.fn((id: number) => { callbacks.delete(id); }) };
  return { frames: createRecordingFrames(native, () => recording), native, callbacks, live: () => { recording = false; }, record: () => { recording = true; } };
}

describe('animation recording frames', () => {
  it('keeps a dock frame when editor teardown cancels its -1/0 sentinels', () => {
    const { frames } = fixture(); const paint = vi.fn();
    const handle = frames.request(paint);
    frames.cancel(-1); frames.cancel(0); frames.flush(160);
    expect(handle).toBeGreaterThan(0);
    expect(paint).toHaveBeenCalledExactlyOnceWith(160);
  });

  it('retains the cancellation handle when a live frame enters recording', () => {
    const f = fixture(); const paint = vi.fn(); f.live();
    const handle = f.frames.request(paint);
    f.record(); f.callbacks.get(handle)!(80);
    f.frames.cancel(handle); f.frames.flush(100);
    expect(paint).not.toHaveBeenCalled();
  });

  it('honors cancellation during a batch and defers new requests', () => {
    const { frames } = fixture(); const second = vi.fn(), next = vi.fn();
    frames.request(() => { frames.cancel(handle); frames.request(next); });
    const handle = frames.request(second);
    frames.flush(10);
    expect(second).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
    frames.flush(20); expect(next).toHaveBeenCalledExactlyOnceWith(20);
  });
});
