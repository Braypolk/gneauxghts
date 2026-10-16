// Explicit fixture-only launch wrapper; the ordinary workspace remains mounted.
import { invoke } from '@tauri-apps/api/core';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import { runInteractiveProbe } from './interactiveProbe';
import { expandedPhases, expandedUnobserved, requireSharedReport, type SharedProbeReport } from './expandedProbeContract';

export async function runExpandedProbe() {
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean; followonsGate?: boolean }>('pi_probe_config');
  if (!config.fixture || !config.interactiveGate || !config.expandedGate || !new URL(location.href).searchParams.has('piExpandedTest')) return;
  const launchId = crypto.randomUUID();
  const report: { gate: string; launchId: string; phase: string; status: string; checks: string[];
    shared: SharedProbeReport[]; followons?: unknown; storageFaults?: unknown; unobserved: readonly string[]; error?: string } = {
    gate: 'expanded-native-workspace-fixture', launchId, phase: 'starting', status: 'running', checks: [], shared: [], unobserved: expandedUnobserved,
  };
  const original = new URL(location.href);
  try {
    const api = chatApi as ChatApi & { prototypeState(): Promise<{ interactiveStateJson?: string }> };
    const phases = expandedPhases((await api.prototypeState()).interactiveStateJson);
    report.phase = phases.includes('first') ? 'first' : 'relaunch';
    await invoke('pi_ui_report', { report });
    for (const phase of phases) {
      const url = new URL(original); url.searchParams.set('piInteractiveTest', phase);
      history.replaceState(history.state, '', url);
      const shared = requireSharedReport(await runInteractiveProbe(), phase);
      // Timings and receipts are bounded by the existing native report size cap.
      const { timings, ...receipts } = shared.receipts;
      report.shared.push({ ...shared, receipts: { ...receipts, timingEventCount: Array.isArray(timings) ? timings.length : 0 } });
      report.checks.push(...shared.checks);
    }
    if (phases.includes('relaunch')) {
      if(config.followonsGate){
        const {runExpandedFollowonsProbe}=await import('./expandedFollowonsProbe');
        const followons=await runExpandedFollowonsProbe();
        if(!followons || followons.status!=='passed')throw new Error(followons?.error ?? 'Enabled native follow-on gate produced no passing report');
        report.followons=followons;
      }
      const {runNativeStorageFaultProbe}=await import('./nativeStorageFaultProbe');
      report.storageFaults=await runNativeStorageFaultProbe({phase:'last-after-ui',generatedSyntheticRoot:true});
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error); }
  finally { history.replaceState(history.state, '', original); }
  await invoke('pi_ui_report', { report });
  return report;
}
