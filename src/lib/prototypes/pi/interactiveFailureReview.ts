/** Opening a review may replace its chat pane with the editor while another
 * conversation remains visible. Its controls must be mounted in the owning
 * conversation before a checkpoint fault can be observed through normal UI. */
export async function prepareFailureReviewControls(input: {
  conversationId: string;
  proposalId: string;
  selectConversation(id: string): Promise<void>;
  strip(): unknown;
  working(): { connected: boolean; markdown: string; title: string };
  until<T>(read: () => T | Promise<T>, label: string): Promise<NonNullable<T>>;
}) {
  const before = input.working();
  if (!before.connected) throw new Error('Failure review editor is not mounted');
  await input.selectConversation(input.conversationId);
  await input.until(input.strip, 'owning conversation exact review strip before checkpoint fault');
  const after = input.working();
  if (!after.connected || after.markdown !== before.markdown || after.title !== before.title)
    throw new Error('Selecting the review owner replaced the working editor');
  return { conversationId: input.conversationId, proposalId: input.proposalId, exactStripMountedBeforeFault: true };
}
