import { assertExpandedPhase } from './expanded-report.mjs';

// Retain failed native reports before validation can throw and discard evidence.
export async function retainExpandedPhase({ report, phase, priorLaunchId, evidence, flush, screenshot }) {
  evidence.phases.push(report); flush();
  let screenshotError;
  try { await screenshot(phase); }
  catch (error) { screenshotError = error; (evidence.screenshotErrors ??= []).push({ phase, error: String(error) }); }
  flush();
  const accepted = assertExpandedPhase(report, phase, priorLaunchId);
  if (screenshotError) throw screenshotError;
  return accepted;
}
