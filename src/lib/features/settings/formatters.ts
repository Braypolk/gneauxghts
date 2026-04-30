export function formatForgottenRetention(days: number) {
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function formatTimestamp(value: number | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function formatMillis(value: number | null) {
  if (value === null || Number.isNaN(value)) return "0 ms";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function averageDuration(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}
