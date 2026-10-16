// Explicit fixture-only launch wrapper; the ordinary workspace remains mounted.
import { invoke } from '@tauri-apps/api/core';
import { chatApi, type ChatApi } from '$lib/features/chat/api';
import { runInteractiveProbe, captureSharedSuspensionUi } from './interactiveProbe';
import { expandedPhases, expandedUnobserved, requireSharedReport, sharedProbeReport, type SharedProbeReport } from './expandedProbeContract';

export async function runExpandedProbe() {
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean; expandedGate: boolean; followonsGate?: boolean }>('pi_probe_config');
  if (!config.fixture || !config.interactiveGate || !config.expandedGate || !new URL(location.href).searchParams.has('piExpandedTest')) return;
  const {maybeRunIosPublicationFaultProbe}=await import('./iosPublicationFaultProbe');
  const publication=await maybeRunIosPublicationFaultProbe();
  if(publication)return;
  const launchId = crypto.randomUUID();
  const report: { gate: string; launchId: string; phase: string; status: string; checks: string[];
    shared: SharedProbeReport[]; followons?: unknown; storageFaults?: unknown; supplementalEvidence?: unknown; supplementalSuspension?: unknown; supplementalSuspensionRelaunch?: unknown; unobserved: readonly string[]; error?: string } = {
    gate: 'expanded-native-workspace-fixture', launchId, phase: 'starting', status: 'running', checks: [], shared: [], unobserved: expandedUnobserved,
  };
  const original = new URL(location.href);
  try {
    const api = chatApi as ChatApi & { prototypeState(): Promise<{ interactiveStateJson?: string; supplementalSuspensionStateJson?: string } | undefined>; prototypeCheckpoint(value: unknown): Promise<void> };
    const phases = expandedPhases((await api.prototypeState())?.interactiveStateJson);
    report.phase = phases.includes('first') ? 'first' : 'relaunch';
    await invoke('pi_ui_report', { report });
    if (phases.includes('relaunch')) {
      const { verifySupplementalSuspensionRelaunch } = await import('./supplementalSuspensionProbe');
      report.supplementalSuspensionRelaunch = await verifySupplementalSuspensionRelaunch({ api, capture: captureSharedSuspensionUi });
    }
    for (const phase of phases) {
      const url = new URL(original); url.searchParams.set('piInteractiveTest', phase);
      history.replaceState(history.state, '', url);
      const shared = sharedProbeReport(await runInteractiveProbe(), phase);
      // Timings and receipts are bounded by the existing native report size cap.
      const { timings, ...receipts } = shared.receipts;
      report.shared.push({ ...shared, receipts: { ...receipts, timingEventCount: Array.isArray(timings) ? timings.length : 0 } });
      report.checks.push(...shared.checks);
      requireSharedReport(shared, phase);
    }
    if (phases.includes('relaunch')) {
      if(config.followonsGate){
        const {runExpandedFollowonsProbe}=await import('./expandedFollowonsProbe');
        const followons=await runExpandedFollowonsProbe();
        report.followons=followons;
        if(!followons || followons.status!=='passed')throw new Error(followons?.error ?? 'Enabled native follow-on gate produced no passing report');
        const {runSupplementalEvidenceProbe}=await import('./supplementalEvidenceProbe');
        const supplementalEvidence=await runSupplementalEvidenceProbe({api,fixtureBaseUrl:new URL((await api.getSettings()).localBaseUrl!).origin});
        report.supplementalEvidence=supplementalEvidence;
        if(!supplementalEvidence || supplementalEvidence.status!=='passed')throw new Error(supplementalEvidence?.error ?? 'Supplemental evidence gate failed');
      }
      const {runNativeStorageFaultProbe}=await import('./nativeStorageFaultProbe');
      report.storageFaults=await runNativeStorageFaultProbe({phase:'last-after-ui',generatedSyntheticRoot:true});
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error); }
  finally { history.replaceState(history.state, '', original); }
  await invoke('pi_ui_report', { report });
  if (config.followonsGate && report.status === 'passed' && report.phase === 'first') {
    try {
      const {runSupplementalSuspensionProbe}=await import('./supplementalSuspensionProbe');
      const api=chatApi as ChatApi & { prototypeState(): Promise<{ supplementalSuspensionStateJson?: string } | undefined>; prototypeCheckpoint(value: unknown): Promise<void> };
      await runSupplementalSuspensionProbe({api,launchId,capture:captureSharedSuspensionUi,emit:async value=>{
        report.supplementalSuspension=value; await invoke('pi_ui_report',{report});
      }});
    } catch(error) { report.status='failed'; report.error=String(error); await invoke('pi_ui_report',{report}); }
  }
  return report;
}
