type ScrollRoot = Pick<HTMLElement, 'scrollTop' | 'scrollHeight'>;
type ScrollTarget = Pick<HTMLElement, 'scrollIntoView'>;

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
  root.scrollTop = root.scrollHeight;
}
