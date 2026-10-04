/** Delayed navigation must yield to a newer user interaction, even in the same input. */
export function captureFocusIntent(signal?: AbortSignal) {
  const target = typeof window === 'undefined' ? undefined : window;
  const events = ['pointerdown', 'keydown', 'input', 'wheel', 'blur'] as const;
  let current = true;
  function cancel(event?: Event) {
    // Element blur is part of ordinary navigation; only leaving the window cancels it.
    if (event?.type === 'blur' && event.target !== target) return;
    current = false;
    for (const name of events) target?.removeEventListener?.(name, cancel, true);
    signal?.removeEventListener('abort', cancel);
  }
  // Capture has already passed when the initiating click/key handler starts work.
  for (const name of events) target?.addEventListener?.(name, cancel, true);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  return { isCurrent: () => current, dispose: cancel };
}
