export interface PiProviderFixture {
  endpoint: string;
  model: string;
  setFailure(value: boolean): void;
  setHoldSummaries(value: boolean): void;
  readonly pendingSummaries: number;
  readonly requests: number;
  close(): Promise<void>;
}
/** Deterministic native integration provider; never evidence of live-model behavior. */
export function startPiProviderFixture(options?: { readQuery?: string }): Promise<PiProviderFixture>;
