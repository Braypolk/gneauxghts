import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextSuggestionSearch } from './contextSuggestionSearch';
import type { ChatContextSuggestionResponse } from '../types';

const response = (reason: string): ChatContextSuggestionResponse => ({ status: 'ready', reason, items: [] });
function harness() {
  const apply = vi.fn();
  const setLoading = vi.fn();
  const requests: { query: string; resolve: (value: ChatContextSuggestionResponse) => void; reject: (error: Error) => void }[] = [];
  const search = createContextSuggestionSearch({ apply, setLoading });
  return { search, apply, setLoading, requests, type(query: string) {
    search.schedule(() => new Promise((resolve, reject) => requests.push({ query, resolve, reject })));
  } };
}

describe('related context suggestion scheduling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid typing before starting work', async () => {
    const h = harness();
    h.type('project a');
    await vi.advanceTimersByTimeAsync(200);
    h.type('project ab');
    await vi.advanceTimersByTimeAsync(349);
    expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.requests.map(r => r.query)).toEqual(['project ab']);
    h.requests[0].resolve(response('latest'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.apply).toHaveBeenLastCalledWith(response('latest'));
    expect(h.setLoading).toHaveBeenLastCalledWith(false);
    h.search.dispose();
  });

  it('keeps one slow search running and skips superseded queued keystrokes', async () => {
    const h = harness();
    h.type('project a');
    await vi.advanceTimersByTimeAsync(350);
    for (const query of ['project ab', 'project abc', 'project abcd']) {
      h.type(query);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(h.requests.map(r => r.query)).toEqual(['project a']);
    h.requests[0].resolve(response('obsolete'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.requests.map(r => r.query)).toEqual(['project a', 'project abcd']);
    h.requests[1].resolve(response('latest'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.apply).toHaveBeenCalledExactlyOnceWith(response('latest'));
    h.search.dispose();
  });

  it('still waits for the typing pause when an old search finishes early', async () => {
    const h = harness();
    h.type('project a');
    await vi.advanceTimersByTimeAsync(350);
    h.type('project ab');
    h.requests[0].reject(new Error('obsolete failure'));
    await vi.advanceTimersByTimeAsync(349);
    expect(h.requests).toHaveLength(1);
    expect(h.apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    h.requests[1].reject(new Error('current failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.apply).toHaveBeenCalledExactlyOnceWith(null);
    expect(h.setLoading).toHaveBeenLastCalledWith(false);
    h.search.dispose();
  });

  it('invalidates results and queued work when clearing access, changing context or disposing', async () => {
    const h = harness();
    h.type('old conversation');
    await vi.advanceTimersByTimeAsync(350);
    h.type('obsolete pending');
    h.search.clear();
    expect(h.apply).toHaveBeenLastCalledWith(null);
    expect(h.setLoading).toHaveBeenLastCalledWith(false);
    h.type('new conversation');
    await vi.advanceTimersByTimeAsync(350);
    h.requests[0].resolve(response('old'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.requests.map(r => r.query)).toEqual(['old conversation', 'new conversation']);
    h.type('never launch');
    h.search.dispose();
    h.requests[1].resolve(response('disposed'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.requests).toHaveLength(2);
    expect(h.apply).toHaveBeenCalledExactlyOnceWith(null);
  });
});
