import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { SessionFailed, type ConversationId, type WatchEnd } from '@earendil-works/pi-durable';
import { createPiDiagnostics, MAX_PI_DIAGNOSTICS, piReportCode } from './diagnostics';

const canary = 'SECRET_note_prompt_reasoning_Bearer_token_https://private.invalid/Users/private';
const id = (value: number) => value as ConversationId;

describe('Pi diagnostic privacy boundary', () => {
  it('uses only allowlisted data codes, never arbitrary error properties or identifiers', () => {
    const sink = createPiDiagnostics();
    const dangerous = { code: 'credential', message: canary, cause: { body: canary }, stack: canary, headers: canary,
      conversationId: canary, provider: canary, endpoint: canary, prompt: canary, reasoning: canary, note: canary, toJSON() { throw Error(canary); } };
    sink.report(dangerous);
    expect(get(sink).notices).toEqual([{ code: 'provider_credential', severity: 'warning', stage: 'provider', message: 'The model credential is unavailable. Check Settings.', count: 1 }]);
    sink.report(canary);
    sink.report({ ...dangerous, code: canary });
    expect(get(sink).notices.at(-1)).toMatchObject({ code: 'runtime_report', count: 2 });
    expect(JSON.stringify(get(sink))).not.toContain(canary);
    expect(get(sink).state).toBe('open');
  });

  it('contains hostile getters, coercion, proxies and throwing or rejecting viewers without logging', async () => {
    const sink = createPiDiagnostics();
    const logs = ['error', 'warn', 'log', 'info', 'debug'].map(method => vi.spyOn(console, method as 'error').mockImplementation(() => {}));
    const touched = vi.fn(() => { throw Error(canary); });
    try {
      const object = Object.create(null);
      for (const key of ['code', 'message', 'cause', 'stack', 'toString', 'toJSON']) Object.defineProperty(object, key, { get: touched });
      const proxy = new Proxy({}, { getOwnPropertyDescriptor: touched, getPrototypeOf: touched, get: touched });
      sink.subscribe(() => { throw Error(canary); });
      sink.subscribe(async () => { throw Error(canary); });
      expect(() => { sink.report(object); sink.report(proxy); }).not.toThrow();
      // Only descriptor/prototype proxy traps may run; accessors are never evaluated.
      expect(touched).toHaveBeenCalledTimes(2);
      await Promise.resolve(); await Promise.resolve();
      expect(logs.every(log => log.mock.calls.length === 0)).toBe(true);
      expect(JSON.stringify(get(sink))).not.toContain(canary);
    } finally { logs.forEach(log => log.mockRestore()); }
  });

  it('distinguishes curated categories while a SessionFailed report remains observational', () => {
    expect(piReportCode({ code: 'connection' })).toBe('provider_connection');
    expect(piReportCode({ code: 'retired_authority' })).toBe('authority_changed');
    expect(piReportCode({ code: 'unknown_source' })).toBe('citation_unavailable');
    const sink = createPiDiagnostics(); sink.report(new SessionFailed(new Error(canary)));
    expect(get(sink)).toMatchObject({ state: 'open', notices: [{ code: 'session_problem' }] });
  });

  it('bounds/coalesces ephemeral records and scopes only verified watch identities', () => {
    const sink = createPiDiagnostics();
    for (let index = 0; index < 1200; index++) sink.report(new Error(canary));
    expect(get(sink).notices).toHaveLength(1);
    expect(get(sink).notices[0].count).toBe(999);
    for (let conversation = 1; conversation < 40; conversation++) sink.reportWatchFailure({ reason: 'listener_error', error: new Error(canary) }, id(conversation));
    expect(get(sink).notices).toHaveLength(MAX_PI_DIAGNOSTICS);
    expect(get(sink).notices.at(-1)).toMatchObject({ code: 'observer_failed', conversationId: 39 });
    const before = get(sink);
    for (const reason of ['stopped', 'cancelled', 'session_closed', 'retired']) sink.reportWatchFailure({ reason } as WatchEnd, id(39));
    sink.reportWatchFailure({ reason: 'listener_error', error: new Error(canary) }, id(NaN));
    expect(get(sink)).toBe(before);
    expect(Object.isFrozen(before.notices[0])).toBe(true);
    expect(JSON.stringify(before)).not.toContain(canary);
  });

  it('retains actual terminal failure for late viewers and seals/clears on terminal release', () => {
    const sink = createPiDiagnostics();
    sink.reportWatchFailure({ reason: 'session_failed', error: new Error(canary) }, id(2));
    expect(get(sink).state).toBe('open');
    sink.end({ reason: 'failed', error: new Error(canary) });
    expect(get(sink)).toMatchObject({ state: 'failed', notices: [{ code: 'observer_session_failed' }, { code: 'runtime_failed' }] });
    const late = vi.fn(); const stop = sink.subscribe(late); expect(late).toHaveBeenCalledOnce(); stop();
    sink.beginClose(); sink.report(new Error(canary)); sink.end({ reason: 'failed', error: new Error(canary) });
    expect(get(sink)).toEqual({ state: 'closing', notices: [] });
    sink.dispose(); sink.report(new Error(canary)); expect(get(sink)).toEqual({ state: 'closed', notices: [] });
    expect(late).toHaveBeenCalledOnce();
  });
});

it.each([
  ['connection_dns', 'provider_connection_dns', 'The model server hostname could not be resolved. Check the server address and network connection.'],
  ['connection_timeout', 'provider_connection_timeout', 'The model request timed out. Check the server and try again.']
])('coalesces %s as a curated observational warning', (nativeCode, code, message) => {
  const sink = createPiDiagnostics();
  const touched = vi.fn(() => { throw Error(canary); });
  const failure = { code: nativeCode };
  for (const key of ['message', 'stack', 'cause', 'endpoint', 'payload']) Object.defineProperty(failure, key, { get: touched });
  sink.report(failure); sink.report(failure);
  expect(get(sink)).toEqual({ state: 'open', notices: [{ code, severity: 'warning', stage: 'provider', message, count: 2 }] });
  expect(touched).not.toHaveBeenCalled();
  sink.dispose(); sink.report(failure);
  expect(get(sink)).toEqual({ state: 'closed', notices: [] });
});
