type ScrollRoot = Pick<HTMLElement, 'scrollTop' | 'scrollHeight'>;
type MeasurableScrollRoot = Pick<
  HTMLElement,
  'clientHeight' | 'scrollHeight' | 'scrollTop'
>;
type ScrollTarget = Pick<HTMLElement, 'scrollIntoView'>;

export const CHAT_FOLLOW_THRESHOLD_PX = 48;

/**
 * Treat a small gap as still following so fractional layout changes and
 * streaming markdown reflow do not accidentally disengage autoscroll.
 */
export function isNearLatestChatContent(
  root: MeasurableScrollRoot,
  threshold = CHAT_FOLLOW_THRESHOLD_PX
) {
  const distanceFromBottom =
    root.scrollHeight - root.clientHeight - root.scrollTop;
  return distanceFromBottom <= threshold;
}

/** Keep streaming updates immediate; repeated smooth-scroll animations fight
 * user input and can keep pulling the viewport back after a manual scroll. */
export function followLatestChatContent(root: ScrollRoot) {
  root.scrollTop = root.scrollHeight;
}

/**
 * Positions a newly rendered conversation before its first visible frame.
 * Subsequent message-following animation is deliberately owned by the list.
 */
export function positionInitialChatScroll(
  root: ScrollRoot,
  target: ScrollTarget | null
) {
  if (target) {
    target.scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }
  followLatestChatContent(root);
}

/** One scroll write per frame. Explicit navigation wins over passive following. */
export function createChatScrollScheduler() {
  const priorities = { follow: 0, initial: 1, anchor: 2 } as const;
  let frame: number | undefined;
  let pending: { priority: number; run: () => void } | undefined;

  function cancel() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    pending = undefined;
  }

  return {
    cancel,
    schedule(intent: keyof typeof priorities, run: () => void) {
      const priority = priorities[intent];
      if (pending && pending.priority > priority) return;
      pending = { priority, run };
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const task = pending;
        pending = undefined;
        task?.run();
      });
    }
  };
}
