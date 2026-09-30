/** Authored calendar dates. Never interpret these as UTC instants. */
export interface DueAnnotation { from: number; to: number; date: string }
export type TaskDateFilter = 'all' | 'overdue' | 'today' | 'upcoming' | 'undated';

export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/** Protect bracketed reference labels even without the note's reference definitions. */
function protectedTextRanges(text: string): Array<{ from: number; to: number }> {
  const ranges = [...text.matchAll(/<[^>]*>/g)].map((match) => ({ from: match.index!, to: match.index! + match[0].length }));
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '`') { index++; continue; }
    const from = index;
    while (text[index] === '`') index++;
    const width = index - from;
    let end = index;
    let closed = false;
    while (end < text.length) {
      if (text[end] !== '`') { end++; continue; }
      const closing = end;
      while (text[end] === '`') end++;
      if (end - closing === width) { ranges.push({ from, to: end }); index = end; closed = true; break; }
    }
    // A code span can close on a continuation line outside the task projection.
    if (!closed) { ranges.push({ from, to: text.length }); break; }
  }
  const codeAndTagRanges = [...ranges];
  for (let from = 0; from < text.length; from++) {
    const protectedRange = codeAndTagRanges.find((range) => from >= range.from && from < range.to);
    if (protectedRange) { from = protectedRange.to - 1; continue; }
    if (text[from] === '\\') { from++; continue; }
    if (text[from] !== '[') continue;
    let to = balancedTextEnd(text, from, '[', ']', codeAndTagRanges);
    if (text[to] === '(') to = balancedTextEnd(text, to, '(', ')');
    else if (text[to] === '[') to = balancedTextEnd(text, to, '[', ']', codeAndTagRanges);
    ranges.push({ from, to });
    from = to - 1;
  }
  return ranges;
}

function balancedTextEnd(text: string, from: number, opening: string, closing: string, protectedRanges: Array<{ from: number; to: number }> = []): number {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    const protectedRange = protectedRanges.find((range) => index >= range.from && index < range.to);
    if (protectedRange) { index = protectedRange.to - 1; continue; }
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === opening) depth++;
    else if (text[index] === closing && --depth === 0) return index + 1;
  }
  // A link label or destination can continue on another Markdown line.
  return text.length;
}

export function dueAnnotations(text: string): DueAnnotation[] {
  const protectedRanges = protectedTextRanges(text);
  const annotations: DueAnnotation[] = [];
  for (const match of text.matchAll(/@due\((\d{4}-\d{2}-\d{2})\)/g)) {
    const from = match.index!, to = from + match[0].length;
    if (from > 0 && !/\s/.test(text[from - 1])) continue;
    if (to < text.length && !/[\s.,;!?]/.test(text[to])) continue;
    if (protectedRanges.some((range) => from < range.to && to > range.from) || !validCalendarDate(match[1])) continue;
    annotations.push({ from, to, date: match[1] });
  }
  return annotations;
}

export function taskDueDate(text: string): string | null {
  return dueAnnotations(text)[0]?.date ?? null;
}

export function taskDescription(text: string): string {
  const annotation = dueAnnotations(text)[0];
  return annotation ? (text.slice(0, annotation.from) + text.slice(annotation.to)).trim() : text;
}

/** Explicit edits consolidate valid annotations; invalid/unknown text stays intact. */
export function setTaskLineDueDate(text: string, date: string | null): string {
  if (date !== null && !validCalendarDate(date)) throw new Error('Choose a valid calendar date.');
  let result = text;
  for (const annotation of dueAnnotations(text).reverse()) {
    // Consume just one separating space, retaining all other authored whitespace.
    const from = annotation.from > 0 && text[annotation.from - 1] === ' ' ? annotation.from - 1 : annotation.from;
    result = result.slice(0, from) + result.slice(annotation.to);
  }
  if (date === null) return result;
  const content = result.trimEnd();
  // Keep trailing spaces at the end: two spaces encode a Markdown hardbreak.
  const updated = `${content} @due(${date})${result.slice(content.length)}`;
  if (taskDueDate(updated) !== date) throw new Error('Close any unfinished inline code or link before adding a due date.');
  return updated;
}

export function localCalendarDate(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** UTC is only an arithmetic/formatting carrier; the authored value stays date-only. */
export function calendarDateForFormatting(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(12, 0, 0, 0);
  return calendar;
}

export function addCalendarDays(date: string, days: number): string {
  const calendar = calendarDateForFormatting(date);
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return `${String(calendar.getUTCFullYear()).padStart(4, '0')}-${String(calendar.getUTCMonth() + 1).padStart(2, '0')}-${String(calendar.getUTCDate()).padStart(2, '0')}`;
}

export function resolveDateShortcut(value: string, today = localCalendarDate()): string | null {
  const input = value.trim().toLowerCase();
  if (validCalendarDate(input)) return input;
  if (input === 'today') return today;
  if (input === 'tomorrow') return addCalendarDays(today, 1);
  if (input === 'next week') return addCalendarDays(today, 7);
  const days = /^in (\d{1,3}) days?$/.exec(input);
  if (days && Number(days[1]) <= 365) return addCalendarDays(today, Number(days[1]));
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(input);
  return weekday < 0 ? null : addCalendarDays(today, (weekday - calendarDateForFormatting(today).getUTCDay() + 7) % 7);
}

export function formatDueDate(date: string, today = localCalendarDate(), completed = false): string {
  if (date === today) return 'Today';
  if (date === addCalendarDays(today, 1)) return 'Tomorrow';
  const label = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' }).format(calendarDateForFormatting(date));
  return !completed && date < today ? `Overdue · ${label}` : label;
}

export function matchesTaskDateFilter(text: string, completed: boolean, filter: TaskDateFilter, today: string): boolean {
  const due = taskDueDate(text);
  switch (filter) {
    case 'all': return true;
    case 'undated': return due === null;
    case 'overdue': return !completed && due !== null && due < today;
    case 'today': return due === today;
    case 'upcoming': return due !== null && due > today;
  }
}

export function millisecondsUntilLocalMidnight(now = new Date()): number {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, midnight.getTime() - now.getTime());
}

/** One local clock subscription, also refreshed after sleep/timezone changes. */
export function subscribeCalendarDay(refresh: (today: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const update = () => {
    clearTimeout(timer);
    refresh(localCalendarDate());
    timer = setTimeout(update, millisecondsUntilLocalMidnight());
  };
  const visible = () => { if (document.visibilityState === 'visible') update(); };
  update();
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', visible);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('focus', update);
    document.removeEventListener('visibilitychange', visible);
  };
}
