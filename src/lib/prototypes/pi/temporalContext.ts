import { currentDateTimeContext, type ChatDateTimeContext } from '$lib/features/chat/dateTimeContext';

/** Native-admitted configuration, not evidence of an old note's authoring format. */
export type FrozenTemporal = {
  referenceInstant: string;
  timeZone: string;
  dateTimeContext?: ChatDateTimeContext | null;
};
export type PreparedTemporal = FrozenTemporal & { referenceLabel: string; prompt: string };

/** Retry reuses the admitted configuration and never samples current conventions. */
export function temporalAdmissionInput(originalEvidence?: { temporal?: PreparedTemporal }): {
  dateTimeContext?: ChatDateTimeContext | null; expectedTemporal?: FrozenTemporal;
} {
  if (originalEvidence === undefined) return { dateTimeContext: currentDateTimeContext() };
  const original = originalEvidence?.temporal;
  if (!original || typeof original.referenceInstant !== 'string' || !original.referenceInstant || original.referenceInstant.length > 64
    || typeof original.timeZone !== 'string' || !original.timeZone || original.timeZone.length > 128
    || original.dateTimeContext && !Array.isArray(original.dateTimeContext.dateOrder)) {
    throw new Error('Original temporal context is unavailable; start a fresh message.');
  }
  const dateTimeContext = original.dateTimeContext ? { ...original.dateTimeContext, dateOrder: [...original.dateTimeContext.dateOrder] } : original.dateTimeContext;
  return { dateTimeContext, expectedTemporal: { referenceInstant: original.referenceInstant, timeZone: original.timeZone, dateTimeContext } };
}
