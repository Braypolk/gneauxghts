import { browser, $, expect } from '@wdio/globals';

declare global {
  interface Window {
    __TAURI_INTERNALS__: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> };
  }
}

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.executeAsync((command, args, done: (result: { value?: T; error?: string }) => void) => {
    void window.__TAURI_INTERNALS__.invoke<T>(command, args).then(
      value => done({ value }), error => done({ error: JSON.stringify(error) })
    );
  }, command, args);
  if (result.error) throw new Error(result.error);
  return result.value as T;
}

export async function interaction(action: 'entry' | 'page' | 'diff', revisionId = '') {
  // WebKit throttles animation frames for an occluded window. Focus before
  // starting the clock; a paint budget requires an actually visible test app.
  await invoke('plugin:window|show', { label: 'main' });
  await invoke('plugin:window|set_focus', { label: 'main' });
  await browser.waitUntil(() => browser.execute(() => document.visibilityState === 'visible'), { timeout: 10_000, timeoutMsg: 'Native paint measurement requires an unlocked, visible webview' });
  const result = await browser.executeAsync((action, revisionId, done: (value: { elapsed?: number; error?: string }) => void) => {
    let stage = 'mutation';
    const timeout = setTimeout(() => done({ error: `${action} stalled at ${stage}; visibility=${document.visibilityState}; history=${!!document.querySelector('[data-testid=history-mode]')}; rows=${document.querySelectorAll('[data-diff-kind]').length}: ${document.body.innerText.slice(-600)}` }), 15_000);
    const beforeCount = Number(document.querySelector<HTMLElement>('aside[aria-label="Note timeline"]')?.dataset.historyRecordCount ?? 0);
    const button = action === 'entry'
      ? document.querySelector<HTMLButtonElement>('button[aria-label="Open note history"]')
      : action === 'page'
        ? [...document.querySelectorAll<HTMLButtonElement>('aside button')].find(b => b.textContent?.trim() === 'Load older history')
        : document.querySelector<HTMLButtonElement>(`[data-revision-id="${revisionId}"]`);
    if (!button || button.disabled) {
      clearTimeout(timeout);
      done({ error: `Missing enabled ${action} action` });
      return;
    }
    const started = performance.now();
    const observer = new MutationObserver(() => {
      const timeline = document.querySelector<HTMLElement>('aside[aria-label="Note timeline"]');
      const ready = action === 'page'
        ? Number(timeline?.dataset.historyRecordCount ?? 0) > beforeCount && timeline?.getAttribute('aria-busy') === 'false'
        : !!document.querySelector('[data-testid="history-mode"] [data-testid="historical-revision-diff"] [data-diff-kind]') &&
          (action === 'entry' || (button.getAttribute('aria-pressed') === 'true' && !button.disabled));
      if (!ready) return;
      observer.disconnect();
      stage = 'paint';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timeout);
        done({ elapsed: performance.now() - started });
      }));
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    button.click();
  }, action, revisionId);
  if (result.error) throw new Error(result.error);
  return result.elapsed!;
}

export function report(name: string, samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const p95 = ordered[Math.ceil(ordered.length * .95) - 1];
  console.log('RELEASE_NATIVE_METRIC', JSON.stringify({ name, samples: ordered.length,
    p50_ms: ordered[Math.floor(ordered.length / 2)], p95_ms: p95, max_ms: ordered.at(-1),
    budget_ms: 250, passed: p95 < 250, raw_ms: samples,
    scope: 'optimized native Rust + IPC + production frontend + two animation frames' }));
  return p95;
}
