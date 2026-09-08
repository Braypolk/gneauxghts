// Opt-in native measurement only. Observes the real IPC; never grants admission.
import { invoke } from '@tauri-apps/api/core';
import type { HistoryReadiness } from '$lib/contracts/historyReadiness';

type Sample = { at: number; name: string; detail?: unknown };
declare global {
  interface Window {
    __GNEAUXGHTS_STARTUP__?: { timeOrigin: number; samplingIntervalMs: number; marks: Sample[]; readiness: Sample[] };
  }
}
const enabled = () => import.meta.env.VITE_E2E_NATIVE === 'true' && typeof window !== 'undefined';
export function startupMark(name: string, detail?: unknown) {
  if (!enabled()) return;
  const metrics = window.__GNEAUXGHTS_STARTUP__;
  if (metrics && metrics.marks.length < 100) metrics.marks.push({ at: performance.now(), name, detail });
}
export function installStartupMetrics() {
  if (!enabled() || window.__GNEAUXGHTS_STARTUP__) return;
  window.__GNEAUXGHTS_STARTUP__ = { timeOrigin: performance.timeOrigin, samplingIntervalMs: 50, marks: [], readiness: [] };
  startupMark('layout-start');
  const deadline = performance.now() + 120_000;
  const frame = () => {
    if (performance.now() > deadline) return;
    if (document.visibilityState !== 'visible' || !document.hasFocus() || !document.querySelector('nav')) {
      requestAnimationFrame(frame); return;
    }
    requestAnimationFrame(() => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) { requestAnimationFrame(frame); return; }
      startupMark('first-observed-visible-focused-shell-two-frames', { visibility: document.visibilityState, focus: document.hasFocus() });
    });
  };
  requestAnimationFrame(frame);
}
export function observeStartupReadiness(noteId: string | null) {
  if (!enabled()) return;
  const deadline = performance.now() + 120_000;
  const poll = async () => {
    const metrics = window.__GNEAUXGHTS_STARTUP__;
    if (!metrics || performance.now() > deadline || metrics.readiness.length >= 2400) return;
    const requestAt = performance.now();
    try {
      const snapshot = await invoke<HistoryReadiness>('get_history_readiness', { noteId });
      metrics.readiness.push({ at: performance.now(), name: 'readiness', detail: { requestAt, snapshot } });
      if (snapshot.backgroundComplete) return;
    } catch (error) {
      metrics.readiness.push({ at: performance.now(), name: 'readiness-error', detail: { requestAt, error: String(error) } });
    }
    setTimeout(() => void poll(), 50);
  };
  void poll();
}
