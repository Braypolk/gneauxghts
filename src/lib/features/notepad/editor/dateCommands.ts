import { calendarDateForFormatting, validCalendarDate as validInlineDate } from '$lib/features/tasks/taskDates';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorMenuGroup } from './blockTypes';

export const dateInsertGroups: readonly EditorMenuGroup[] = [{
  key: 'insert', label: 'Insert', items: [
    { id: 'date', label: 'Date' }, { id: 'today', label: 'Today' },
    { id: 'time', label: 'Time' }, { id: 'now', label: 'Now' }
  ]
}];
export const dueMenuGroup: EditorMenuGroup = { key: 'task-date', label: 'Task', items: [{ id: 'due', label: 'Due date' }] };
export const taskMarkerPattern = /^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\](?:\s|$)/;

export function isExcludedDateContext(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  if (/\]\([^)]*$/.test(line.text.slice(0, pos - line.from))) return true;
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (/Code|Link|URL|Image|HTML/.test(node.name)) return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

export function slashTokenAtSelection(state: EditorState): { from: number; to: number; filter: string; block: boolean; task: boolean } | null {
  const selection = state.selection.main;
  if (!selection.empty || state.selection.ranges.length !== 1) return null;
  const line = state.doc.lineAt(selection.head);
  if (/^\/(?:date|today|time|now|due)\s/.test(line.text)) return null;
  if (selection.head === line.to && /^\/[a-zA-Z0-9 ]*$/.test(line.text) && !isExcludedDateContext(state, line.from) && !isExcludedDateContext(state, selection.head)) {
    return { from: line.from, to: line.to, filter: line.text.slice(1), block: true, task: false };
  }
  const before = line.text.slice(0, selection.head - line.from);
  const match = /(?:^|\s)(\/([a-zA-Z]*))$/.exec(before);
  if (!match || /[\w/]/.test(line.text[selection.head - line.from] ?? '')) return null;
  const from = selection.head - match[1].length;
  if (isExcludedDateContext(state, from) || isExcludedDateContext(state, selection.head)) return null;
  return { from, to: selection.head, filter: match[2], block: from === line.from && selection.head === line.to, task: taskMarkerPattern.test(line.text) };
}

export function formatDateInsertion(command: string, now = new Date(), locale?: string, timeZone?: string): string {
  const date = () => formatCalendarText(now, locale, timeZone);
  const time = () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn', timeZone }).format(now);
  switch (command) {
    case 'date': case 'today': return date();
    case 'time': return time();
    case 'now': return `${date()} ${time()}`;
    default: throw new Error('Unknown date insertion command');
  }
}

export interface InlineDateText { from: number; to: number; mode: 'date' | 'time' | 'datetime'; date: string | null; time: string | null; text: string }

function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const textPatterns = new Map<string, { pattern: string; periods: string[]; hour12?: boolean; midnight24: boolean }>();
function dateTextPattern(kind: 'date' | 'time', locale?: string) {
  const key = `${locale ?? 'system'}:${kind}`;
  const cached = textPatterns.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(locale, kind === 'date'
    ? { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }
    : { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' });
  const periods = [9, 21].map((hour) => formatter.formatToParts(new Date(2026, 8, 29, hour)).find((part) => part.type === 'dayPeriod')?.value).filter(Boolean) as string[];
  const parts = formatter.formatToParts(new Date(2026, 8, 29, 9, 32));
  const pattern = parts.map((part) => {
    if (part.type === 'literal') return escapePattern(part.value).replace(/[\s\u00a0\u202f]+/g, '[\\s\\u00a0\\u202f]+');
    if (part.type === 'dayPeriod') return `(?<dayPeriod>${periods.map(escapePattern).join('|')})`;
    return `(?<${part.type}>${part.type === 'year' ? '\\d{4}' : '\\d{1,2}'})`;
  }).join('');
  const result = { pattern, periods, hour12: formatter.resolvedOptions().hour12, midnight24: formatter.resolvedOptions().hourCycle === 'h24' };
  textPatterns.set(key, result);
  return result;
}

/** Presentation inferred from plain text in the current locale, never hidden metadata. */
export function inlineDateTexts(text: string, locale?: string): InlineDateText[] {
  const date = dateTextPattern('date', locale);
  const time = dateTextPattern('time', locale);
  const variants = [
    { mode: 'datetime' as const, pattern: `${date.pattern} ${time.pattern}` },
    { mode: 'date' as const, pattern: date.pattern },
    { mode: 'time' as const, pattern: time.pattern }
  ];
  const result: InlineDateText[] = [];
  for (const variant of variants) {
    for (const match of text.matchAll(new RegExp(variant.pattern, 'gu'))) {
      const from = match.index!;
      const to = from + match[0].length;
      if (/[\p{L}\p{N}_/@(\\-]/u.test(text[from - 1] ?? '') || /[\p{L}\p{N}_/:-]/u.test(text[to] ?? '')) continue;
      if (result.some((entry) => from < entry.to && to > entry.from)) continue;
      const groups = match.groups!;
      const calendar = groups.year ? `${groups.year}-${groups.month.padStart(2, '0')}-${groups.day.padStart(2, '0')}` : null;
      if (calendar && !validInlineDate(calendar)) continue;
      let hour = Number(groups.hour);
      const minute = Number(groups.minute);
      if (groups.hour) {
        if (minute > 59 || hour > (time.hour12 ? 12 : time.midnight24 ? 24 : 23) || (time.hour12 && hour < 1)) continue;
        if (time.hour12) hour = hour % 12 + (groups.dayPeriod === time.periods[1] ? 12 : 0);
        else if (time.midnight24) hour %= 24;
      }
      result.push({ from, to, mode: variant.mode, date: calendar, time: groups.hour ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null, text: match[0] });
    }
  }
  return result.sort((a, b) => a.from - b.from);
}

/** Format chosen wall-clock text independently, including nonexistent DST times. */
export function formatPickedDateTime(mode: 'date' | 'time' | 'datetime', date: string | null, time: string | null, locale?: string): string {
  const formattedDate = date ? formatCalendarText(calendarDateForFormatting(date), locale, 'UTC') : '';
  const [hour, minute] = (time ?? '00:00').split(':').map(Number);
  const formattedTime = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 15, hour, minute)));
  return mode === 'datetime' ? `${formattedDate} ${formattedTime}` : mode === 'date' ? formattedDate : formattedTime;
}

function formatCalendarText(value: Date, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn', timeZone }).formatToParts(value).map((part) => part.type === 'year' ? part.value.padStart(4, '0') : part.value).join('');
}
