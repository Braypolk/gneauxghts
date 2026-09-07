/** Advisory runtime snapshot; canonical saves always perform their own admission. */
export interface HistoryReadiness {
  scope: string;
  revision: number;
  noteId: string | null;
  state: 'recoveryPending' | 'targetVerificationPending' | 'ready' | 'unavailable' | 'corrupt';
  verifiedNotes: number;
  totalNotes: number | null;
  backgroundComplete: boolean;
  backgroundUnavailable: boolean;
}
