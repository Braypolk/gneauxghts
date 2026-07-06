const PENDING_NOTE_TARGET_KEY = 'gneauxghts.pending-note-target';

export interface PendingNoteTarget {
  noteId: string | null;
  notePath: string;
}

export function storePendingNoteTarget(target: PendingNoteTarget) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(PENDING_NOTE_TARGET_KEY, JSON.stringify(target));
}

export function consumePendingNoteTarget(): PendingNoteTarget | null {
  if (typeof window === 'undefined') return null;

  const rawTarget = window.sessionStorage.getItem(PENDING_NOTE_TARGET_KEY);
  if (!rawTarget) return null;

  window.sessionStorage.removeItem(PENDING_NOTE_TARGET_KEY);

  try {
    return JSON.parse(rawTarget) as PendingNoteTarget;
  } catch (error) {
    console.error('Failed to parse pending note target:', error);
    return null;
  }
}
