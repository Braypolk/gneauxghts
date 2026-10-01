import { describe, expect, it } from 'vitest';
import { currentDateTimeContext } from './dateTimeContext';

describe('current editor date/time conventions', () => {
  it('distinguishes US, British and year-first calendar text', () => {
    expect(currentDateTimeContext('en-US', 'America/Denver')).toEqual({
      locale: 'en-US', timeZone: 'America/Denver',
      dateOrder: ['month', 'day', 'year'], hourCycle: 'h12'
    });
    expect(currentDateTimeContext('en-GB', 'Europe/London')).toEqual({
      locale: 'en-GB', timeZone: 'Europe/London',
      dateOrder: ['day', 'month', 'year'], hourCycle: 'h23'
    });
    expect(currentDateTimeContext('ja-JP', 'Asia/Tokyo').dateOrder).toEqual(['year', 'month', 'day']);
  });
});
