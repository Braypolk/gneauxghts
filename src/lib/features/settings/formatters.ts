import type { SyncConflictDetail } from '$lib/types/sync';

export type ConflictDiffRow = {
  lineNumber: number;
  localLine: string;
  remoteLine: string;
  kind: 'same' | 'changed' | 'local-only' | 'remote-only';
};

export function formatForgottenRetention(days: number) {
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function formatTimestamp(value: number | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export function formatMillis(value: number | null) {
  if (value === null || Number.isNaN(value)) return '0 ms';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function averageDuration(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}

export function formatSyncTimestamp(value: number | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export function buildConflictDiffRows(detail: SyncConflictDetail | null) {
  if (!detail) return [] as ConflictDiffRow[];
  const localLines = detail.localMarkdown.replace(/\r\n/g, '\n').split('\n');
  const remoteLines = detail.remoteMarkdown.replace(/\r\n/g, '\n').split('\n');
  const length = Math.max(localLines.length, remoteLines.length);
  const rows: ConflictDiffRow[] = [];

  for (let index = 0; index < length; index += 1) {
    const localLine = localLines[index] ?? '';
    const remoteLine = remoteLines[index] ?? '';
    let kind: ConflictDiffRow['kind'] = 'same';
    if (index >= localLines.length) {
      kind = 'remote-only';
    } else if (index >= remoteLines.length) {
      kind = 'local-only';
    } else if (localLine !== remoteLine) {
      kind = 'changed';
    }

    rows.push({
      lineNumber: index + 1,
      localLine,
      remoteLine,
      kind
    });
  }

  return rows;
}

export function conflictRowClass(kind: ConflictDiffRow['kind']) {
  switch (kind) {
    case 'changed':
      return 'bg-amber-50 dark:bg-amber-950/20';
    case 'local-only':
      return 'bg-emerald-50 dark:bg-emerald-950/20';
    case 'remote-only':
      return 'bg-sky-50 dark:bg-sky-950/20';
    default:
      return '';
  }
}
