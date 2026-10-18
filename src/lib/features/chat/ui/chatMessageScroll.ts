type ScrollRoot = Pick<HTMLElement, 'scrollTop' | 'scrollHeight'>;
type MeasurableScrollRoot = Pick<
  HTMLElement,
  'clientHeight' | 'scrollHeight' | 'scrollTop'
>;
type ScrollTarget = Pick<HTMLElement, 'scrollIntoView'>;

export interface ChatScrollPosition {
  scrollTop: number;
  followingLatest: boolean;
}

// The pane's controller outlives its rendered chat while a note is displayed.
// Weak ownership releases these UI-only positions when that pane is retired.
const positionsBySurface = new WeakMap<object, Map<string, ChatScrollPosition>>();

export function chatScrollPositionsFor(surface: object) {
  let positions = positionsBySurface.get(surface);
  if (!positions) {
    positions = new Map();
    positionsBySurface.set(surface, positions);
  }
  return positions;
}

export const CHAT_FOLLOW_THRESHOLD_PX = 2;

/**
 * Allow rounding at the bottom without treating an older reading position as
 * an instruction to follow.
 */
export function isNearLatestChatContent(
  root: MeasurableScrollRoot,
  threshold = CHAT_FOLLOW_THRESHOLD_PX
) {
  const distanceFromBottom =
    root.scrollHeight - root.clientHeight - root.scrollTop;
  return distanceFromBottom <= threshold;
}

/** Initial placement and restoration happen before the first visible frame. */
export function followLatestChatContent(root: ScrollRoot) {
  root.scrollTop = root.scrollHeight;
}

/**
 * Positions a newly rendered conversation before its first visible frame.
 * Subsequent message-following animation is owned by the viewport controller.
 */
export function positionInitialChatScroll(
  root: ScrollRoot,
  target: ScrollTarget | null,
  savedPosition?: ChatScrollPosition
) {
  if (target) {
    target.scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }
  if (savedPosition && !savedPosition.followingLatest) {
    root.scrollTop = savedPosition.scrollTop;
    return;
  }
  followLatestChatContent(root);
}

interface ChatScrollOptions {
  conversationId: string | null;
  ready: boolean;
  positions: Map<string, ChatScrollPosition>;
}

/** One viewport owner for rendered growth, user scrolling and conversation restore. */
export function createChatMessageScroll(root: HTMLElement, initial: ChatScrollOptions) {
  let options = { ...initial, ready: false };
  let active = false;
  let position: ChatScrollPosition = { scrollTop: 0, followingLatest: true };
  let writtenTop = root.scrollTop;
  let frame = 0;
  let previousTime: number | undefined;
  let renderRevision = 0;
  let rendering = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const bottom = () => Math.max(0, root.scrollHeight - root.clientHeight);

  function record() {
    if (active && options.conversationId) options.positions.set(options.conversationId, { ...position });
  }
  function write(top: number) {
    root.scrollTop = top;
    writtenTop = position.scrollTop = root.scrollTop;
    record();
  }
  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = undefined;
  }
  function invalidateRender() { ++renderRevision; rendering = false; }
  function pause() { active = false; invalidateRender(); cancel(); }
  function restore(saved?: ChatScrollPosition) {
    cancel();
    invalidateRender();
    active = true;
    position = saved ? { ...saved } : { scrollTop: 0, followingLatest: true };
    positionInitialChatScroll(root, null, position);
    writtenTop = position.scrollTop = root.scrollTop;
    record();
  }
  function scroll() {
    if (!active || rendering) return;
    const top = root.scrollTop;
    // Our animation and layout clamping also emit scroll events. Neither is user intent.
    if (Math.abs(top - Math.min(writtenTop, bottom())) <= 1) return;
    position.followingLatest = top >= writtenTop && isNearLatestChatContent(root);
    writtenTop = position.scrollTop = top;
    record();
    if (position.followingLatest) schedule();
    else cancel();
  }
  function wheel(event: WheelEvent) {
    if (!active || event.deltaY >= 0) return;
    position.followingLatest = false;
    cancel();
    record();
  }
  function advance(time: number) {
    frame = 0;
    scroll(); // Also notice input arriving before its scroll event is delivered.
    if (!active || !position.followingLatest) return;
    const target = bottom(), gap = target - root.scrollTop;
    if (reducedMotion.matches || Math.abs(gap) <= 1) {
      write(target);
      previousTime = undefined;
      return;
    }
    const elapsed = previousTime === undefined ? 1000 / 60 : Math.min(64, time - previousTime);
    previousTime = time;
    // A moving target, rather than a new native smooth-scroll animation per token.
    write(root.scrollTop + gap * (1 - Math.exp(-elapsed / 65)));
    schedule();
  }
  function schedule() {
    if (active && position.followingLatest && !frame) frame = requestAnimationFrame(advance);
  }
  function preserveRenderPosition() {
    if (!active) return () => {};
    scroll();
    const revision = ++renderRevision;
    const top = position.scrollTop;
    rendering = true;
    return () => {
      if (revision !== renderRevision || !active) return;
      rendering = false;
      // Replacing @html or admitting the final message can temporarily remove
      // most of the scrollable content. Restore before paint, without treating
      // the browser's intermediate clamp as an upward user scroll.
      write(top);
      if (position.followingLatest) schedule();
    };
  }
  const observer = new ResizeObserver(() => {
    if (!active) return;
    scroll();
    if (position.followingLatest) schedule();
    else write(position.scrollTop);
  });
  observer.observe(root);
  if (root.firstElementChild) observer.observe(root.firstElementChild);
  root.addEventListener('scroll', scroll, { passive: true });
  root.addEventListener('wheel', wheel, { passive: true });

  function update(next: ChatScrollOptions) {
    const changed = next.conversationId !== options.conversationId;
    const becameReady = next.ready && !options.ready;
    options = next;
    if (!next.ready) pause();
    else if (changed || becameReady) restore(next.conversationId ? next.positions.get(next.conversationId) : undefined);
  }
  update(initial);
  return {
    update, pause, restore, preserveRenderPosition,
    destroy() {
      pause();
      observer.disconnect();
      root.removeEventListener('scroll', scroll);
      root.removeEventListener('wheel', wheel);
    }
  };
}
