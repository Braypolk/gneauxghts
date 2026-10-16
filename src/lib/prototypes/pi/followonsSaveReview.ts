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
