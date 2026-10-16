export type FollowonsSaveReviewControls = {
  open(proposalId: string): Promise<void>;
  discard(proposalId: string): Promise<void>;
  settled(proposalId: string): Promise<void>;
};

/** A Save can passively mount in the existing editor. Settle that retained
 * review through its normal controls before the next composer checkpoints it. */
export async function discardFollowonsSaveReview(controls: FollowonsSaveReviewControls, proposalId: string) {
  await controls.open(proposalId);
  await controls.discard(proposalId);
  await controls.settled(proposalId);
}

/** Acquire the exact Save through the existing pending-card/editor UI. */
export async function openFollowonsSaveReview<E, C>(input: {
  mountedEditor(): E | undefined;
  visibleEditor(): E | undefined;
  reviewControl(): C | undefined;
  openReview(control: C): Promise<void>;
  revealEditor(editor: E): Promise<void>;
  until<T>(read: () => T | Promise<T>, description: string): Promise<NonNullable<T>>;
}) {
  const target = await input.until(() => {
    const editor = input.mountedEditor();
    if (editor) return { editor };
    const review = input.reviewControl();
    return review ? { review } : undefined;
  }, 'owned web Save normal review control');
  if ('review' in target) await input.openReview(target.review!);
  const editor = await input.until(input.mountedEditor, 'owned web Save mounted editor review');
  await input.revealEditor(editor);
  await input.until(input.visibleEditor, 'owned web Save visible editor review');
}
