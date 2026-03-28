const PENDING_TASK_TARGET_KEY = 'gneauxghts.pending-task-target';

export interface PendingTaskTarget {
  noteId: string;
  notePath: string;
  text: string;
  lineNumber: number;
  sectionLabel: string | null;
}

export function storePendingTaskTarget(target: PendingTaskTarget) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(PENDING_TASK_TARGET_KEY, JSON.stringify(target));
}

export function consumePendingTaskTarget(): PendingTaskTarget | null {
  if (typeof window === 'undefined') return null;

  const rawTarget = window.sessionStorage.getItem(PENDING_TASK_TARGET_KEY);
  if (!rawTarget) return null;

  window.sessionStorage.removeItem(PENDING_TASK_TARGET_KEY);

  try {
    return JSON.parse(rawTarget) as PendingTaskTarget;
  } catch (error) {
    console.error('Failed to parse pending task target:', error);
    return null;
  }
}
