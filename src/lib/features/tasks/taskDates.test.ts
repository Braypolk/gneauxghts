import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { addCalendarDays, dueAnnotations, formatDueDate, localCalendarDate, matchesTaskDateFilter, millisecondsUntilLocalMidnight, resolveDateShortcut, setTaskLineDueDate, subscribeCalendarDay, taskDueDate, validCalendarDate } from './taskDates';

describe('authored calendar deadlines', () => {
  it('validates Gregorian dates without a permissive Date parser', () => {
    for (const valid of ['0001-01-01', '2024-02-29', '9999-12-31']) expect(validCalendarDate(valid)).toBe(true);
    for (const invalid of ['0000-01-01', '2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '2026-01-00']) expect(validCalendarDate(invalid)).toBe(false);
  });
  it('keeps invalid, escaped and protected annotations as ordinary text', () => {
    const text = 'Ship `@due(2026-10-01)` [@due(2026-10-02)](url) \\@due(2026-10-03) @due(2026-02-29) @due(2026-10-04) @due(2026-10-05)';
    expect(taskDueDate(text)).toBe('2026-10-04');
    const edited = setTaskLineDueDate(text, '2026-10-06');
    expect(edited).toContain('`@due(2026-10-01)`');
    expect(edited).toContain('@due(2026-02-29)');
    expect(dueAnnotations(edited)).toHaveLength(1);
    expect(taskDueDate(edited)).toBe('2026-10-06');
    expect(setTaskLineDueDate(edited, null)).not.toContain(' @due(2026-10-06)');
    expect(taskDueDate('``code ` @due(2026-10-01) ``')).toBeNull();
    expect(taskDueDate('mail@due(2026-10-01)')).toBeNull();
  });
  it('edits only supported dates, preserving authored creation text and spacing', () => {
    expect(setTaskLineDueDate('- [ ] Send 💡 @created(2020-01-01) @due(2026-10-01)', '2026-10-03')).toBe('- [ ] Send 💡 @created(2020-01-01) @due(2026-10-03)');
    expect(setTaskLineDueDate('Task  @due(2026-10-01)  more', null)).toBe('Task   more');
    expect(() => setTaskLineDueDate('Task', '2026-02-29')).toThrow();
  });
  it('resolves narrow shortcuts and seven calendar days, including DST', () => {
    expect(resolveDateShortcut('Friday', '2026-09-29')).toBe('2026-10-02');
    expect(resolveDateShortcut('Tuesday', '2026-09-29')).toBe('2026-09-29');
    expect(resolveDateShortcut('next week', '2026-09-29')).toBe('2026-10-06');
    expect(resolveDateShortcut('in 3 days', '2026-09-29')).toBe('2026-10-02');
    expect(resolveDateShortcut('in 366 days', '2026-09-29')).toBeNull();
    expect(resolveDateShortcut('next Friday afternoon', '2026-09-29')).toBeNull();
    expect(addCalendarDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addCalendarDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('compares date-only boundaries and never labels completed tasks overdue', () => {
    const task = 'Task @due(2026-09-29)';
    expect(matchesTaskDateFilter(task, false, 'today', '2026-09-29')).toBe(true);
    expect(matchesTaskDateFilter(task, false, 'overdue', '2026-09-30')).toBe(true);
    expect(matchesTaskDateFilter(task, true, 'overdue', '2026-09-30')).toBe(false);
    expect(matchesTaskDateFilter(task, true, 'upcoming', '2026-09-28')).toBe(true);
    expect(matchesTaskDateFilter('Task @due(invalid)', false, 'undated', '2026-09-29')).toBe(true);
    expect(formatDueDate('2026-09-29', '2026-09-30', true)).not.toContain('Overdue');
  });
  it('schedules the next local midnight using calendar arithmetic', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 23, 59, 59));
    expect(localCalendarDate()).toBe('2026-09-29');
    expect(millisecondsUntilLocalMidnight()).toBe(1000);
    vi.advanceTimersByTime(1000);
    expect(localCalendarDate()).toBe('2026-09-30');
    vi.useRealTimers();
  });
});

describe('local calendar clock', () => {
  it('schedules short and long DST days without a fixed 24-hour assumption', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'America/Denver';
      expect(millisecondsUntilLocalMidnight(new Date(2026, 2, 8))).toBe(23 * 60 * 60 * 1000);
      expect(millisecondsUntilLocalMidnight(new Date(2026, 10, 1))).toBe(25 * 60 * 60 * 1000);
      expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
});

it('matches Rust-owned portable Markdown fixtures', () => {
  const fixtures: Array<{ text: string; due: string | null; set: string; edited?: string; error?: string; removed: string }> = JSON.parse(readFileSync(new URL('../../../../src-tauri/test-fixtures/contracts/task-dates.json', import.meta.url).pathname, 'utf8'));
  for (const fixture of fixtures) {
    expect(taskDueDate(fixture.text), fixture.text).toBe(fixture.due);
    if (fixture.error) expect(() => setTaskLineDueDate(fixture.text, fixture.set), fixture.text).toThrow(fixture.error);
    else expect(setTaskLineDueDate(fixture.text, fixture.set), fixture.text).toBe(fixture.edited);
    expect(setTaskLineDueDate(fixture.text, null), fixture.text).toBe(fixture.removed);
  }
});

it('refreshes calendar observers at midnight and after resume, then releases listeners', () => {
  vi.useFakeTimers();
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', fakeWindow); vi.stubGlobal('document', fakeDocument);
  try {
    vi.setSystemTime(new Date(2026, 8, 29, 23, 59, 59));
    const refresh = vi.fn();
    const dispose = subscribeCalendarDay(refresh);
    expect(refresh).toHaveBeenLastCalledWith('2026-09-29');
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenLastCalledWith('2026-09-30');
    vi.setSystemTime(new Date(2026, 9, 3, 10));
    fakeWindow.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenLastCalledWith('2026-10-03');
    vi.setSystemTime(new Date(2026, 9, 4, 10));
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenLastCalledWith('2026-10-04');
    dispose(); const calls = refresh.mock.calls.length;
    fakeWindow.dispatchEvent(new Event('focus')); vi.advanceTimersByTime(86_400_000);
    expect(refresh).toHaveBeenCalledTimes(calls);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});
