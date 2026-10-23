export interface PiProviderFixture {
  setContextWindow(value: number | null): void;
  endpoint: string;
  model: string;
  setFailure(value: boolean): void;
  setCreate(value: { title: string; markdown: string; folder?: string }): void;
  setRename(value: { noteId: string; title: string }): void;
  setEdit(value: { noteId: string; oldText: string; newText: string }): void;
  setHoldSummaries(value: boolean): void;
  readonly pendingSummaries: number;
  readonly requests: number;
  close(): Promise<void>;
}
/** Deterministic native integration provider; never evidence of live-model behavior. */
export function startPiProviderFixture(options?: { readQuery?: string }): Promise<PiProviderFixture>;
