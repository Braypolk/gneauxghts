import { afterEach, describe, expect, it, vi } from 'vitest';
import type { invoke } from '@tauri-apps/api/core';
import { installPiNativeInvokeProbe, observePiNativeInvoke, parkNextPublicationAcknowledgement } from './piNativeInvokeProbe';
const stop: Array<() => void> = [];
afterEach(() => { stop.splice(0).forEach(close => close()); });

describe('native Pi acceptance observation boundary', () => {
  it('preserves native call/result identity and records bytes without retaining payloads', async () => {
    const probe = installPiNativeInvokeProbe(); stop.push(probe.stop);
    const args = { generated: 'DO_NOT_RETAIN_FIXTURE_PAYLOAD' }, result = { saved: 'DO_NOT_RETAIN_FIXTURE_RESULT' };
    const native = vi.fn(async () => result);
    expect(await observePiNativeInvoke(native as typeof invoke, 'pi_sql', args)).toBe(result);
    expect(native.mock.calls[0]).toEqual(['pi_sql', args, undefined]);
    const observed = probe.read();
    expect(observed.bridge.pi_sql.calls).toBe(1);
    expect(observed.bridge.pi_sql.requestBytes).toBeGreaterThan(0);
    expect(observed.bridge.pi_sql.responseBytes).toBeGreaterThan(0);
    expect(JSON.stringify(observed)).not.toContain('DO_NOT_RETAIN');
  });
  it('observes real Channel handler delivery while preserving the prior receiver and native errors', async () => {
    const probe = installPiNativeInvokeProbe(); stop.push(probe.stop);
    const receive = vi.fn(), channel = { onmessage: receive, __TAURI_TO_IPC_KEY__: () => '__CHANNEL__:8' };
    const error = { code: 'native_fixture_error' };
    const native = vi.fn(async () => { channel.onmessage({ type: 'chunk', bytes: [1, 2, 3] }); throw error; });
    await expect(observePiNativeInvoke(native as typeof invoke, 'pi_chat_fetch', { frames: channel, body: '{"messages":[]}', conversationId: 7 })).rejects.toBe(error);
    expect(receive).toHaveBeenCalledWith({ type: 'chunk', bytes: [1, 2, 3] });
    expect(probe.read().transport).toMatchObject({ frames: 1, providerBytes: 3 });
    expect(probe.read().bridge.pi_chat_fetch.failures).toBe(1);
  });
  it('parks only the exact committed intent and supplies a digest instead of Markdown', async () => {
    const probe = installPiNativeInvokeProbe(); stop.push(probe.stop);
    const callback = vi.fn(async () => {});
    stop.push(parkNextPublicationAcknowledgement('intent-owned', callback));
    const result = { status: 'committed', receiptId: 'receipt-owned', noteId: 'generated-note', markdown: 'Generated fixture body' };
    const native = vi.fn(async () => result);
    await observePiNativeInvoke(native as typeof invoke, 'pi_chat_publish_mutation', { intentId: 'other-intent' });
    expect(callback).not.toHaveBeenCalled();
    expect(await observePiNativeInvoke(native as typeof invoke, 'pi_chat_publish_mutation', { intentId: 'intent-owned' })).toBe(result);
    expect(callback).toHaveBeenCalledWith({ receiptId: 'receipt-owned', noteId: 'generated-note', markdownSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(probe.read().parkedAcknowledgements).toBe(1);
    expect(JSON.stringify(callback.mock.calls)).not.toContain('Generated fixture body');
  });
});
