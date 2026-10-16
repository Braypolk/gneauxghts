// This contract classifies fixture observations. It cannot establish a native pass.
export type SharedPhase = 'seed' | 'first' | 'relaunch' | 'failures';
export type SharedProbeReport = {
  gate: string; phase: string | null; status: string; checks: string[];
  receipts: Record<string, unknown>; error?: string;
};

export function expandedPhases(interactiveStateJson?: string): SharedPhase[] {
  if (!interactiveStateJson) return ['seed', 'first'];
  const state = JSON.parse(interactiveStateJson) as Record<string, unknown>;
  if (typeof state.a !== 'string' || typeof state.b !== 'string' || !state.source) {
    throw new Error('Invalid durable interactive fixture state');
  }
  if (state.savedId) throw new Error('Expanded fixture has already completed; allocate a fresh synthetic root');
  if (!state.interruptedId || !state.keepId || !state.discardId) {
    throw new Error('First journey did not acknowledge its interruption/review checkpoint');
  }
  return ['relaunch', 'failures'];
}

export function sharedProbeReport(value: unknown, phase: SharedPhase): SharedProbeReport {
  if (!value || typeof value !== 'object') throw new Error('Shared UI probe must return its persisted report');
  const report = value as SharedProbeReport;
  if (report.gate !== 'first-usable-desktop-fixture' || report.phase !== phase || !Array.isArray(report.checks)) {
    throw new Error('Shared UI report does not match the requested journey');
  }
  return report;
}

export function requireSharedReport(value: unknown, phase: SharedPhase): SharedProbeReport {
  const report = sharedProbeReport(value, phase);
  if (report.status !== 'passed') throw new Error(report.error ?? `Shared UI ${phase} failed`);
  return report;
}

// Keep the larger ticket honest while this driver proves the common journey.
// These become observed passes only through separate required native journeys.
export const expandedUnobserved = [
  'essential flow parity for each protocol (shared journey mixes local and Responses)',
  'research and parent/worker compaction on the native WKWebView',
  'attachments and supported hosted web search on the native WKWebView',
  'managed transcript conflict and vault relocation on iOS',
  'before staged tool outcome and before Pi terminal persistence interruption',
  'native rollback/COMMIT and storage-full equivalent failures',
  'lease expiry/disconnect and stale-owner commit rejection',
  'bounded live local-compatible and Responses provider journeys',
  'simulator pressure/suspension beyond background/foreground observation',
  'physical iPhone, radio and distribution behavior',
] as const;
