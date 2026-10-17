import { render } from 'svelte/server';
import { expect, it } from 'vitest';
import type { ConversationId } from '@earendil-works/pi-durable';
import { createPiDiagnostics } from '../pi/diagnostics';
import PiRuntimeDiagnostics from './PiRuntimeDiagnostics.svelte';

it('renders fixed scoped notices and coalesced reports without repeating sensitive payloads', () => {
  const diagnostics = createPiDiagnostics(); const canary = 'SECRET_NOTE_CREDENTIAL_HEADER_ENDPOINT_PATH';
  diagnostics.report(new Error(canary)); diagnostics.report({ message: canary });
  diagnostics.reportWatchFailure({ reason: 'listener_error', error: new Error(canary) }, 7 as ConversationId);
  const other = render(PiRuntimeDiagnostics, { props: { diagnostics, conversationId: 8 as ConversationId } }).body;
  expect(other).toContain('data-diagnostic-code="runtime_report"'); expect(other).toContain('(2 reports)');
  expect(other).not.toContain('data-diagnostic-code="observer_failed"'); expect(other).not.toContain(canary);
  const selected = render(PiRuntimeDiagnostics, { props: { diagnostics, conversationId: 7 as ConversationId } }).body;
  expect(selected).toContain('data-diagnostic-code="observer_failed"'); expect(selected).toContain('role="alert"');
  expect(selected).not.toContain(canary);
});

it('presents actual failure to a late-mounted surface and clears terminal shutdown notices', () => {
  const diagnostics = createPiDiagnostics(); diagnostics.end({ reason: 'failed', error: 'private storage path' });
  const failed = render(PiRuntimeDiagnostics, { props: { diagnostics } }).body;
  expect(failed).toContain('data-diagnostic-code="runtime_failed"'); expect(failed).toContain('Restart the app');
  expect(failed).not.toContain('Dismiss'); expect(failed).not.toContain('private storage path');
  diagnostics.beginClose();
  expect(render(PiRuntimeDiagnostics, { props: { diagnostics } }).body).not.toContain('Restart the app');
  diagnostics.dispose();
  expect(render(PiRuntimeDiagnostics, { props: { diagnostics } }).body).not.toContain('pi-runtime-diagnostics');
});
