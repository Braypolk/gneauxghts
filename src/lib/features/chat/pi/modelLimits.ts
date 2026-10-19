/** Native metadata includes last-known local capacity. Zero stays unknown to Pi. */
export function modelLimits(metadata: {
  contextWindow: number | null;
  maxTokens: number | null;
}): { contextWindow: number; maxTokens: number } {
  const observed = (value: number | null) =>
    value !== null && Number.isSafeInteger(value) && value > 0 ? value : 0;
  return {
    contextWindow: observed(metadata.contextWindow),
    maxTokens: observed(metadata.maxTokens),
  };
}
