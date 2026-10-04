export function daysAgo(timestamp: number | null): string {
  if (!timestamp) return 'No recorded opening';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  return days === 0 ? 'Today' : `${days} days ago`;
}
