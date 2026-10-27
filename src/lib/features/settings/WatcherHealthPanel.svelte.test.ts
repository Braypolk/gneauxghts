import { render } from 'svelte/server';
import { expect, it } from 'vitest';
import type { WatcherHealth } from '#lib/types/vault.js';
import WatcherHealthPanel from './WatcherHealthPanel.svelte';

function panel(status: WatcherHealth['status'], reason: WatcherHealth['reason'] = null) {
  return render(WatcherHealthPanel, { props: {
    health: { revision: 2, status, reason, reconciliationRunning: status === 'watching' || status === 'degraded' }
  } }).body;
}

it('distinguishes startup failure from degraded watching with continuing scans', () => {
  const unavailable = panel('unavailable', 'watchLimit');
  expect(unavailable).toContain('File watching could not start.');
  expect(unavailable).toContain('file-watch limit was reached');
  expect(unavailable).toContain('Periodic scans are not running.');
  expect(unavailable).not.toContain('Periodic scans remain active');
  const degraded = panel('degraded', 'other');
  expect(degraded).toContain('File watching reported an error.');
  expect(degraded).toContain('Periodic scans remain active');
  expect(degraded).toContain('warning stays visible until restart');
  expect(degraded).not.toContain('<button');
});

it('provides permission guidance and labels health as applying to the Running Vault', () => {
  expect(panel('unavailable', 'permissionDenied')).toContain('Check that Gneauxghts can access the Running Vault');
  const watching = panel('watching');
  expect(watching).toContain('Watching the Running Vault');
  expect(watching).toContain('Periodic scans also check');
  expect(watching).toContain('role="status"');
});

it('does not imply that starting, stopped or missing diagnostics are healthy', () => {
  expect(panel('starting')).toContain('Starting file watching');
  expect(panel('stopped')).toContain('File watching has stopped');
  expect(panel('stopped')).not.toContain('Periodic scans also check');
  expect(render(WatcherHealthPanel, { props: { health: null } }).body).toContain('Starting file watching');
});
