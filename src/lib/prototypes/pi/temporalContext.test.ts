import { beforeEach, expect, it, vi } from 'vitest';
import { temporalAdmissionInput, type PreparedTemporal } from './temporalContext';
const current = vi.hoisted(() => vi.fn());
vi.mock('$lib/features/chat/dateTimeContext', () => ({ currentDateTimeContext: current }));
const conventions = { locale: 'en-GB', timeZone: 'Europe/London', dateOrder: ['day', 'month', 'year'] as Array<'day' | 'month' | 'year'>, hourCycle: 'h23' as const };
beforeEach(() => { current.mockReset(); current.mockReturnValue(conventions); });
it('fresh admission supplies existing editor conventions for native validation', () => {
  expect(temporalAdmissionInput()).toEqual({ dateTimeContext: conventions });
  expect(current).toHaveBeenCalledTimes(1);
});
it('Retry preserves the admitted instant and conventions and excludes derived prompt fields', () => {
  const original: PreparedTemporal = { referenceInstant: '2026-03-29T00:30:00+00:00', timeZone: 'Europe/London', dateTimeContext: conventions, referenceLabel: 'native reference', prompt: 'native prompt' };
  const retry = temporalAdmissionInput({ temporal: original });
  expect(retry).toEqual({ dateTimeContext: conventions, expectedTemporal: { referenceInstant: original.referenceInstant, timeZone: original.timeZone, dateTimeContext: conventions } });
  expect(current).not.toHaveBeenCalled();
  retry.dateTimeContext!.dateOrder.reverse();
  expect(original.dateTimeContext!.dateOrder).toEqual(['day', 'month', 'year']);
});
it('an admitted anchor without optional conventions remains unchanged on Retry', () => {
  expect(temporalAdmissionInput({ temporal: { referenceInstant: '2026-01-01T00:00:00Z', timeZone: 'UTC', referenceLabel: 'UTC reference', prompt: 'native prompt' } })).toEqual({ dateTimeContext: undefined, expectedTemporal: { referenceInstant: '2026-01-01T00:00:00Z', timeZone: 'UTC', dateTimeContext: undefined } });
  expect(current).not.toHaveBeenCalled();
});
it.each([undefined, {}, { referenceInstant: '', timeZone: 'UTC' }, { referenceInstant: '2026-01-01T00:00:00Z' }, { referenceInstant: '2026-01-01T00:00:00Z', timeZone: 'UTC', dateTimeContext: {} }])('Retry rejects unavailable stored temporal context without sampling a new anchor: %j', temporal => {
  expect(() => temporalAdmissionInput({ temporal: temporal as PreparedTemporal | undefined })).toThrow('Original temporal context is unavailable');
  expect(current).not.toHaveBeenCalled();
});
