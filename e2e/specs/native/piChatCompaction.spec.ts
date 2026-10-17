import assert from 'node:assert/strict';
import { $, browser } from '@wdio/globals';
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate';
import { invokeNative } from '../../support/liveNative';
import { LOCAL_PI_ENDPOINT, LOCAL_PI_MODEL, assistantText, configurePi, inspectPiContext, newPiConversation, observePi, openPiPane, paneState, piDiagnostics, seedPiSyntheticHistory, sendPiMessage, startPiProviderFixture, waitPiIdle, waitPiTask, writePiReport } from '../../support/piChatAcceptance';

const liveEnabled = process.env.GNEAUX_PI_COMPACTION_LOCAL === '1';
const fixtureEnabled = !liveEnabled;
describe('ordinary Pi automatic compaction', function () {
  this.timeout(900_000);
  let fixture: Awaited<ReturnType<typeof startPiProviderFixture>> | undefined;
  let endpoint = LOCAL_PI_ENDPOINT, model = LOCAL_PI_MODEL;
  before(async () => {
    if (fixtureEnabled) { fixture = await startPiProviderFixture(); endpoint = fixture.endpoint; model = fixture.model; }
    await configurePi(endpoint, model); await openPiPane(); await observePi();
  });
  after(async () => { await fixture?.close(); });

  it('installs a standard threshold/overflow summary, continues and retains human history', async () => {
    await newPiConversation(); await sendPiMessage('Give one sentence welcoming a fictional observatory visitor. Use no notes or tools.'); await waitPiIdle(300_000);
    const short = await piDiagnostics();
    // Native metadata observes an actually loaded instance. Advertised maximum and
    // synthetic fixture capacity are never presented as measured live capacity.
    const metadata = await invokeNative<{ contextWindow: number | null; maxTokens: number | null }>('pi_chat_model_configuration', { provider: 'local', model });
    assert(metadata.contextWindow && metadata.contextWindow > 0, 'Loaded provider context capacity must be observed before this compaction journey');
    const paragraph = 'This is synthetic source-free acceptance history about a fictional observatory. Keep the visitor welcome as the current goal. No vault facts, permissions or tools are implied. ';
    let block = 'SYNTHETIC_HISTORY_ORIGIN_';
    while (estimateTextTokens(block) < metadata.contextWindow / 16) block += paragraph;
    const blocks = Array.from({ length: 16 }, (_, index) => `Synthetic history block ${index}.\n${block}`);
    const seeded = await seedPiSyntheticHistory(blocks);
    const before = await inspectPiContext();
    await sendPiMessage('Continue with one short sentence about our fictional observatory visitor. Use no notes or tools.');
    await waitPiIdle(600_000);
    const after = await inspectPiContext(), diagnostics = await piDiagnostics();
    assert.equal(after.head?.kind, 'pi.compaction', 'Standard Pi automatic compaction must install its actual context head');
    const compact = after.historyKinds.find(entry => entry.kind === 'pi.compaction'); assert(compact);
    assert(['threshold', 'overflow'].includes((compact.data as { reason: string }).reason), 'This journey must not substitute manual compaction');
    assert(after.historyKinds.some(entry => entry.kind === 'acceptance.synthetic-history'), 'Human-visible source-free history must remain retained');
    assert(after.contextCharacters < before.contextCharacters, 'Installed summary must actually reduce the following model context');
    const continuation = diagnostics.progress.requests.findLast(request => request.hasContinuation && !request.summary);
    assert(continuation?.hasSummary, 'The actual continuation provider request must include the installed standard summary');
    assert(continuation.characters < before.contextCharacters, 'Actual continuation request must be smaller than the seeded context');
    assert(diagnostics.progress.conversations[seeded.conversationId]?.compactionObserved, 'Native Pi view must expose compaction while it runs');
    await writePiReport(fixtureEnabled ? 'pi-compaction-fixture' : 'pi-compaction-local', {
      kind: fixtureEnabled ? 'deterministic-http-provider-native-integration' : 'live-local-model', endpoint, model, metadata,
      historyMethod: 'Public Pi type:write submissions containing generated source-free user history; no fabricated assistant usage or direct database writes. App compaction policy unchanged.',
      generatedCharacters: blocks.reduce((sum, value) => sum + value.length, 0), seeded, before, after, shortDiagnostics: short, longDiagnostics: diagnostics,
      finalAnswer: assistantText(await waitPiIdle()),
      limits: 'One continuation attempt, bounded timeout; resource values are observations without numerical acceptance budgets.'
    });
  });
  (fixtureEnabled ? it : it.skip)('Stop joins a real background compaction before it can place a summary', async () => {
    await newPiConversation(); await sendPiMessage('Short synthetic background compaction setup.'); await waitPiIdle();
    const capacity = await invokeNative<{ contextWindow: number }>('pi_chat_model_configuration', { provider: 'local', model });
    let block = 'BACKGROUND_SYNTHETIC_HISTORY_';
    while (estimateTextTokens(block) < capacity.contextWindow * 0.65 / 12) block += 'Generated fictional observatory history; no notes, sources or permissions implied. ';
    await seedPiSyntheticHistory(Array.from({ length: 12 }, (_, index) => `Background synthetic history ${index}. ${block}`));
    fixture!.setHoldSummaries(true);
    try {
      await sendPiMessage('Continue the background synthetic observatory example.');
      await browser.waitUntil(async () => fixture!.pendingSummaries > 0, { timeout: 30_000, timeoutMsg: 'Standard background summary did not reach the native provider' });
      const state = await paneState();
      const compactions = (state.view?.docs['pi.live'] as { compactions?: Array<{ taskId: number; blocking: boolean; reason: string }> }).compactions;
      const task = compactions?.find(value => !value.blocking); assert(task, 'Expected a conversation-owned background compaction'); assert.equal(task.reason, 'threshold');
      await $('[data-testid="pi-stop"]').click();
      assert.equal((await waitPiTask(task.taskId)).state.outcome.status, 'aborted', 'Ordinary idle alone does not prove background settlement');
      const context = await inspectPiContext(); assert.notEqual(context.head?.kind, 'pi.compaction', 'Stopped background summary must not arrive late');
      await writePiReport('pi-compaction-background-stop', { kind: 'deterministic-http-provider-native-integration', task, outcome: 'aborted', context, diagnostics: await piDiagnostics() });
    } finally { fixture!.setHoldSummaries(false); }
  });

});
