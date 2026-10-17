import type { invoke as NativeInvoke, InvokeArgs, InvokeOptions } from '@tauri-apps/api/core';

export type PiBridgeStat = { calls: number; requestBytes: number; responseBytes: number; failures: number; elapsedMillis: number };
export type PiRequestObservation = { conversationId: unknown; characters: number; summary: boolean; hasSummary: boolean; hasOldSeed: boolean; hasRecentSeed: boolean; hasContinuation: boolean; startedAt: number };
export type PiNativeInvokeStats = {
  installedAt: number; bridge: Record<string, PiBridgeStat>; requests: PiRequestObservation[];
  transport: { frames: number; frameBytes: number; providerBytes: number }; parkedAcknowledgements: number;
};
export type ParkedPublicationReceipt = { receiptId: string; noteId: string; markdownSha256: string; commitWarning?: unknown };
let active: PiNativeInvokeStats | undefined;
let acknowledgement: { intentId: string; committed(receipt: ParkedPublicationReceipt): Promise<void> } | undefined;

/** Test-build diagnostics only. Raw arguments, results, headers and model bodies are never retained. */
export function installPiNativeInvokeProbe() {
  active = { installedAt: performance.now(), bridge: {}, requests: [], transport: { frames: 0, frameBytes: 0, providerBytes: 0 }, parkedAcknowledgements: 0 };
  const installed = active;
  return { read: () => structuredClone(installed), stop: () => { if (active === installed) active = undefined; } };
}
/** Park one exact committed acknowledgement for an orchestrator-owned process interruption. */
export function parkNextPublicationAcknowledgement(intentId: string, committed: (receipt: ParkedPublicationReceipt) => Promise<void>) {
  if (!intentId || acknowledgement) throw new Error('An exact pending publication intent is required');
  const rule = acknowledgement = { intentId, committed };
  return () => { if (acknowledgement === rule) acknowledgement = undefined; };
}
function encodedBytes(value: unknown) {
  try {
    // Tauri's public IPC serializer hook includes Channel destinations without retaining handlers.
    return new TextEncoder().encode(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && typeof item.__TAURI_TO_IPC_KEY__ === 'function' ? item.__TAURI_TO_IPC_KEY__() : item) ?? '').byteLength;
  } catch { return 0; }
}
export async function observePiNativeInvoke<T>(native: typeof NativeInvoke, command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const stats = active, started = performance.now();
  const record = stats ? stats.bridge[command] ??= { calls: 0, requestBytes: 0, responseBytes: 0, failures: 0, elapsedMillis: 0 } : undefined;
  if (record) { record.calls++; record.requestBytes += encodedBytes(args); }
  const object = args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array) ? args : undefined;
  if (stats && command === 'pi_chat_fetch' && object) {
    if (typeof object.body === 'string') {
      try {
        const text = JSON.stringify((JSON.parse(object.body) as { messages?: unknown[] }).messages ?? []);
        stats.requests.push({ conversationId: object.conversationId, characters: text.length, summary: text.includes('context summarization assistant'), hasSummary: text.includes('<summary>'), hasOldSeed: text.includes('Synthetic history block 0.'), hasRecentSeed: text.includes('Synthetic history block 15.'), hasContinuation: text.includes('Continue with one short sentence about our fictional observatory visitor.'), startedAt: started });
      } catch { /* Diagnostic decoding cannot change native request behavior. */ }
    }
    if (object.frames) {
      const channel = object.frames as { onmessage: (frame: { type: string; bytes?: number[] }) => void };
      const receive = channel.onmessage;
      channel.onmessage = frame => { stats.transport.frames++; stats.transport.frameBytes += encodedBytes(frame); stats.transport.providerBytes += frame.bytes?.length ?? 0; receive(frame); };
    }
  }
  try {
    const result = await native<T>(command, args, options);
    if (record) record.responseBytes += encodedBytes(result);
    const rule = acknowledgement;
    if (rule && command === 'pi_chat_publish_mutation' && object?.intentId === rule.intentId && result && typeof result === 'object' && 'status' in result && result.status === 'committed') {
      acknowledgement = undefined;
      const receipt = result as unknown as { receiptId: string; noteId: string; markdown: string; commitWarning?: unknown };
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(receipt.markdown));
      const markdownSha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      if (stats) stats.parkedAcknowledgements++;
      await rule.committed({ receiptId: receipt.receiptId, noteId: receipt.noteId, markdownSha256, ...(receipt.commitWarning ? { commitWarning: receipt.commitWarning } : {}) });
    }
    return result;
  } catch (error) { if (record) record.failures++; throw error; }
  finally { if (record) record.elapsedMillis += performance.now() - started; }
}
