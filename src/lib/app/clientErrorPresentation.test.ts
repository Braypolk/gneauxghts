import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientCaughtError } from '@sveltejs/kit/hooks';
import type { NavigationEvent } from '@sveltejs/kit';
import { clientErrorDisplay, presentClientError } from './clientErrorPresentation';
import { handleError } from '../../hooks.client';

const secret = 'SECRET_note_path_token_request_body';
const unknown = (error: unknown): ClientCaughtError => ({ kind: 'unknown', error });

afterEach(() => vi.unstubAllGlobals());

describe('client error presentation', () => {
  it('never inspects an unexpected exception, including hostile getters/proxies', () => {
    const inspect = vi.fn(() => { throw new Error(secret); });
    for (const error of [
      new Error(secret), secret, null, undefined, Symbol(secret),
      Object.defineProperties({}, { message: { get: inspect }, status: { get: inspect } }),
      new Proxy({}, { get: inspect, getOwnPropertyDescriptor: inspect, getPrototypeOf: inspect })
    ]) {
      const result = presentClientError(unknown(error));
      expect(result.status).toBe(500);
      expect(result.presentationCode).toBe('client_failure');
      expect(result.message).toBe('The workspace could not be displayed. Recent changes may not have been saved.');
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each(['app', 'framework'] as const)('preserves valid %s statuses using fixed copy', (kind) => {
    for (const status of [400, 401, 403, 404, 409, 422, 500, 503, 599]) {
      const result = presentClientError({ kind, error: { status, message: secret } });
      expect(result.status).toBe(status);
      expect(result.presentationCode).toBe(status === 404 ? 'page_unavailable' : 'request_unavailable');
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it('rejects invalid, inherited and accessor statuses without invoking accessors', () => {
    const getter = vi.fn(() => 404);
    for (const error of [
      ...[NaN, Infinity, 399, 600, 404.5, '404'].map(status => ({ status, message: secret })),
      Object.create({ status: 404 }),
      Object.defineProperty({}, 'status', { get: getter }),
      new Proxy({}, { getOwnPropertyDescriptor: () => { throw secret; } })
    ]) {
      expect(presentClientError({ kind: 'app', error } as ClientCaughtError).status).toBe(500);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('continues without a reference if crypto is unavailable or throws', () => {
    for (const crypto of [undefined, { randomUUID: () => { throw secret; } }]) {
      vi.stubGlobal('crypto', crypto);
      expect(presentClientError(unknown(secret))).toEqual({
        status: 500,
        message: 'The workspace could not be displayed. Recent changes may not have been saved.',
        presentationCode: 'client_failure', diagnosticId: undefined
      });
    }
  });

  it('creates bounded references once in the hook and reuses them while rendering', () => {
    const randomUUID = vi.fn(() => '12345678-1234-4321-8321-123456789abc');
    vi.stubGlobal('crypto', { randomUUID });
    const result = presentClientError(unknown(secret));
    expect(result.diagnosticId).toBe('C-123456781234');
    expect(clientErrorDisplay(result, 500)).toEqual(clientErrorDisplay(result, 500));
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('renders only catalog copy and valid references even from contaminated page errors', () => {
    const result = clientErrorDisplay({ message: secret, diagnosticId: secret, presentationCode: secret }, 500);
    expect(result.diagnosticId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(clientErrorDisplay(new Proxy({}, { getOwnPropertyDescriptor: () => { throw secret; } }), 404))
      .toMatchObject({ status: 500, heading: 'Workspace unavailable', diagnosticId: undefined });
  });

  it('the synchronous hook ignores event/URL access and never logs the exception', () => {
    const consoleError = vi.spyOn(console, 'error');
    try {
      const result = handleError({ ...unknown(secret), get event(): NavigationEvent { throw secret; } });
      expect(result).not.toBeInstanceOf(Promise);
      expect(result).toMatchObject({ status: 500, presentationCode: 'client_failure' });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
