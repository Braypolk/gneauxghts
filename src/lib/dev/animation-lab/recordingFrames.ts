/** RAF semantics for the isolated recording clock, including cancellation sentinels. */
export function createRecordingFrames(
  native: { raf: (callback: FrameRequestCallback) => number; cancel: (id: number) => void },
  isRecording: () => boolean,
) {
  // CodeMirror cancels -1 when it has no frame. Native handles in this short
  // fixture lifetime stay below this range; virtual frames must use neither.
  let nextId = 0x40000000;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    request(callback: FrameRequestCallback): number {
      if (!isRecording()) {
        const id = native.raf(now => {
          if (isRecording()) callbacks.set(id, callback); else callback(now);
        });
        return id;
      }
      const id = nextId++; callbacks.set(id, callback); return id;
    },
    cancel(id: number) { callbacks.delete(id); native.cancel(id); },
    flush(now: number) {
      // A callback may cancel a later callback in this batch. Newly requested
      // callbacks wait for the next frame, matching browser RAF behavior.
      for (const id of [...callbacks.keys()]) {
        const callback = callbacks.get(id);
        if (!callback) continue;
        callbacks.delete(id); callback(now);
      }
    },
  };
}
