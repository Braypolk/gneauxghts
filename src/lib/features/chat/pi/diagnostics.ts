import { SessionFailed, type ConversationId, type SessionEnd, type WatchEnd } from '@earendil-works/pi-durable';

const catalog = {
  runtime_report: ['warning', 'report', 'Chat reported a problem. Some updates or extensions may be unavailable.'],
  session_problem: ['warning', 'report', 'Chat reported a storage or runtime problem.'],
  provider_connection: ['warning', 'provider', 'The model connection reported a problem.'],
  provider_capacity: ['warning', 'provider', 'The model reported a context capacity problem.'],
  provider_limit: ['warning', 'provider', 'The model account reported a usage limit.'],
  provider_credential: ['warning', 'provider', 'The model credential is unavailable. Check Settings.'],
  authority_changed: ['warning', 'authority', 'Conversation access is unavailable or has changed.'],
  citation_unavailable: ['warning', 'citation', 'An answer source could not be verified.'],
  observer_failed: ['error', 'observation', 'Conversation updates stopped. Select the conversation again to reconnect.'],
  observer_session_failed: ['error', 'observation', 'Conversation updates stopped because the chat runtime is unavailable.'],
  runtime_failed: ['error', 'runtime', 'Chat stopped because its storage or runtime failed. Restart the app to reconnect.'],
} as const;
export type PiDiagnosticCode = keyof typeof catalog;
export type PiDiagnostic = Readonly<{
  code: PiDiagnosticCode; severity: 'warning' | 'error'; stage: typeof catalog[PiDiagnosticCode][1];
  message: string; conversationId?: ConversationId; count: number;
}>;
export type PiDiagnosticSnapshot = Readonly<{ state: 'open' | 'closing' | 'closed' | 'failed'; notices: readonly PiDiagnostic[] }>;
export const MAX_PI_DIAGNOSTICS = 12;
const nativeCodes = new Map<string, PiDiagnosticCode>([
  ['connection', 'provider_connection'], ['stream', 'provider_connection'], ['provider_transient', 'provider_connection'],
  ['provider_context_overflow', 'provider_capacity'], ['provider_limit', 'provider_limit'], ['provider_rate_limit', 'provider_limit'],
  ['credential', 'provider_credential'], ['retired_authority', 'authority_changed'], ['stale_authority', 'authority_changed'],
  ['foreign_authority', 'authority_changed'], ['unknown_source', 'citation_unavailable'], ['invalid_answer', 'citation_unavailable'],
]);

// Never read arbitrary getters, stringify, traverse causes or inspect provider payloads.
// Proxy traps can still throw during descriptor/prototype inspection; they are contained here.
function ownString(value: unknown, key: string): string | undefined {
  try {
    if (!value || typeof value !== 'object') return;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
  } catch { return; }
}
export function piReportCode(error: unknown): PiDiagnosticCode {
  const native = nativeCodes.get(ownString(error, 'code') ?? '');
  if (native) return native;
  try { if (error instanceof SessionFailed) return 'session_problem'; } catch { /* Hostile prototype. */ }
  return 'runtime_report';
}

/** Ephemeral presentation only: no task settlement, retry, storage or model operations. */
export function createPiDiagnostics() {
  let snapshot: PiDiagnosticSnapshot = Object.freeze({ state: 'open', notices: Object.freeze([]) });
  const listeners = new Set<(value: PiDiagnosticSnapshot) => void>();
  let disposed = false;
  const notify = (listener: (value: PiDiagnosticSnapshot) => void) => {
    try { void Promise.resolve(listener(snapshot)).catch(() => {}); } catch { /* A view cannot fail Pi reporting. */ }
  };
  const publish = (state: PiDiagnosticSnapshot['state'], notices: readonly PiDiagnostic[]) => {
    snapshot = Object.freeze({ state, notices: Object.freeze(notices) });
    for (const listener of [...listeners]) notify(listener);
  };
  const add = (code: PiDiagnosticCode, conversationId?: ConversationId) => {
    if (disposed || snapshot.state !== 'open') return;
    const existing = snapshot.notices.find(item => item.code === code && item.conversationId === conversationId);
    const [severity, stage, message] = catalog[code];
    const notice = Object.freeze({ code, severity, stage, message, ...(conversationId === undefined ? {} : { conversationId }), count: Math.min(999, (existing?.count ?? 0) + 1) });
    const notices = snapshot.notices.filter(item => item !== existing);
    publish(snapshot.state, [...notices, notice].slice(-MAX_PI_DIAGNOSTICS));
  };
  return {
    subscribe(listener: (value: PiDiagnosticSnapshot) => void) {
      if (!disposed) listeners.add(listener);
      notify(listener);
      return () => { listeners.delete(listener); };
    },
    report(error: unknown) { try { add(piReportCode(error)); } catch { /* Never throw into Harness. */ } },
    reportWatchFailure(end: WatchEnd, conversationId: ConversationId) {
      try {
        if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return;
        const reason = ownString(end, 'reason');
        if (reason === 'listener_error') add('observer_failed', conversationId);
        else if (reason === 'session_failed') add('observer_session_failed', conversationId);
      } catch { /* Never throw into an observer. */ }
    },
    dismiss(code: PiDiagnosticCode, conversationId?: ConversationId) {
      if (!disposed) publish(snapshot.state, snapshot.notices.filter(item => item.code !== code || item.conversationId !== conversationId));
    },
    beginClose() { if (!disposed) publish('closing', []); },
    end(end: SessionEnd) {
      if (disposed || snapshot.state === 'closing' || snapshot.state === 'closed') return;
      if (ownString(end, 'reason') === 'failed') {
        add('runtime_failed');
        publish('failed', snapshot.notices);
      } else if (ownString(end, 'reason') === 'closed') publish('closed', []);
    },
    dispose() { if (!disposed) { disposed = true; publish('closed', []); listeners.clear(); } },
  };
}
export type PiDiagnostics = ReturnType<typeof createPiDiagnostics>;
