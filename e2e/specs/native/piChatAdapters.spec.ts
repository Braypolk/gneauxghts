import assert from 'node:assert/strict';
import { $, browser } from '@wdio/globals';
import type { PiChat } from '../../../src/lib/features/chat/pi/runtime';
import type { PiDiagnosticSnapshot } from '../../../src/lib/features/chat/pi/diagnostics';
import { invokeNative } from '../../support/liveNative';
import { assertDisposable, configurePi, live, messages, newPiConversation, observePi, openPiPane, paneState, sendPiMessage, startPiProviderFixture, waitPiIdle, writePiReport } from '../../support/piChatAcceptance';

/** Fixed synthetic inputs stay inside the instrumented WebView. Only observations leave it. */
async function diagnosticEvidence(scenario: 'observe' | 'reports' | 'terminal-notification') {
  return browser.executeAsync((mode: 'observe' | 'reports' | 'terminal-notification', done: (value: {
    state: string; noticeCount: number; codes: string[]; repeatCount: number; gettersRead: number;
    sinkSafe: boolean; domSafe: boolean; noInventedActivity: boolean; reportVisible: boolean; failureVisible: boolean;
    evidenceKind: string; errorCode?: string;
  }) => void) => {
    void (async () => {
      const bridge = (window as Window & { __GNEAUXGHTS_NATIVE_E2E__?: { piChat(): Promise<PiChat> } }).__GNEAUXGHTS_NATIVE_E2E__;
      if (!bridge) throw new Error('Instrumented bridge required');
      const runtime = await bridge.piChat();
      const canary = 'PI_ADAPTER_SYNTHETIC_PRIVATE_CANARY_742';
      let gettersRead = 0;
      if (mode === 'reports') {
        const hostile = Object.defineProperties({}, {
          code: { get() { gettersRead++; return canary; } },
          message: { get() { gettersRead++; return canary; } },
        });
        runtime.diagnostics.report(hostile);
        for (let index = 0; index < 1024; index++) runtime.diagnostics.report(new Error(canary));
        runtime.diagnostics.report({ code: 'credential', message: canary, stack: canary, headers: { authorization: canary }, body: canary });
      } else if (mode === 'terminal-notification') {
        // Presentation notification only: this does not fail Harness or corrupt storage.
        runtime.diagnostics.end({ reason: 'failed', error: new Error(canary) });
      }
      if (mode !== 'observe') {
        const selector = mode === 'reports' ? '[data-diagnostic-code="runtime_report"]' : '[data-diagnostic-code="runtime_failed"]';
        const deadline = Date.now() + 5000;
        while (!document.querySelector(selector) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      }
      let snapshot: PiDiagnosticSnapshot = { state: 'open', notices: [] };
      runtime.diagnostics.subscribe(value => { snapshot = value; })();
      const dom = document.querySelector('[data-testid="pi-runtime-diagnostics"]')?.textContent ?? '';
      const serialized = JSON.stringify(snapshot);
      done({ state: snapshot.state, noticeCount: snapshot.notices.length, codes: snapshot.notices.map(item => item.code),
        repeatCount: snapshot.notices.find(item => item.code === 'runtime_report')?.count ?? 0, gettersRead,
        sinkSafe: !serialized.includes(canary), domSafe: !document.body.textContent?.includes(canary),
        noInventedActivity: !/\bstuck\b|\bthinking\b/i.test(dom),
        reportVisible: Boolean(document.querySelector('[data-diagnostic-code="runtime_report"]')),
        failureVisible: Boolean(document.querySelector('[data-diagnostic-code="runtime_failed"]')),
        evidenceKind: mode === 'terminal-notification' ? 'synthetic-terminal-notification' : mode === 'reports' ? 'synthetic-runtime-report' : 'diagnostic-observation' });
    })().catch(() => done({ state: 'unavailable', noticeCount: 0, codes: [], repeatCount: 0, gettersRead: 0,
      sinkSafe: false, domSafe: false, noInventedActivity: false, reportVisible: false, failureVisible: false,
      evidenceKind: 'diagnostic-observation', errorCode: 'acceptance_diagnostic_failed' }));
  }, scenario);
}

describe('ordinary Pi adapter diagnostic acceptance', function () {
  this.timeout(120_000);
  let provider: Awaited<ReturnType<typeof startPiProviderFixture>>;
  const evidence: unknown[] = [];
  before(async () => {
    await assertDisposable(); provider = await startPiProviderFixture();
    await configurePi(provider.endpoint, provider.model); await openPiPane(); await observePi();
  });
  after(async () => {
    try { await writePiReport('pi-adapters', { kind: 'production-adapters-synthetic-diagnostic-input', evidence, requests: provider?.requests,
      limits: ['Terminal notification is presentation evidence; actual failed Harness settlement is tested separately.'] }); }
    finally { await provider?.close(); }
  });

  it('bounds and sanitizes runtime reports without failing generation or changing native authority', async () => {
    await newPiConversation(); await sendPiMessage('fixture-hold adapter reports');
    await browser.waitUntil(async () => Boolean(live(await paneState())?.run) && provider.requests > 0);
    const authorityId = (await paneState()).authority!.authorityId;
    const authorityBefore = await invokeNative('pi_chat_authority', { authorityId });
    const requests = provider.requests;
    const report = await diagnosticEvidence('reports');
    assert.equal(report.errorCode, undefined); assert.equal(report.state, 'open');
    assert(report.sinkSafe && report.domSafe && report.noInventedActivity);
    assert.equal(report.gettersRead, 0); assert.equal(report.repeatCount, 999); assert(report.noticeCount <= 12);
    assert(report.codes.includes('provider_credential')); assert(report.reportVisible && !report.failureVisible);
    assert.equal(provider.requests, requests, 'Reporting must not dispatch inference');
    assert.deepEqual(await invokeNative('pi_chat_authority', { authorityId }), authorityBefore);
    const completed = await waitPiIdle();
    assert.equal(messages(completed).filter(message => message.role === 'assistant').at(-1)?.stopReason, 'stop');
    evidence.push(report, { generationCompleted: true, inferenceCallsUnchangedByReports: true, nativeAuthorityUnchanged: true });
  });

  it('presents a synthetic terminal notification distinctly from an ordinary report without inference', async () => {
    await waitPiIdle();
    const requests = provider.requests, before = await diagnosticEvidence('observe');
    assert.equal(before.state, 'open'); assert(!before.failureVisible);
    const terminal = await diagnosticEvidence('terminal-notification');
    assert.equal(terminal.errorCode, undefined); assert.equal(terminal.state, 'failed'); assert(terminal.failureVisible);
    assert(terminal.sinkSafe && terminal.domSafe && terminal.noInventedActivity);
    assert(terminal.codes.includes('runtime_failed')); assert.equal(provider.requests, requests);
    assert(!await $('[data-testid="pi-activity"]').isExisting());
    evidence.push(terminal, { inferenceCallsUnchangedByNotification: true, actualHarnessFailure: false });
  });
});
