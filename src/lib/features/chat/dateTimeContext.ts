/** Current editor conventions, not an authoring locale or timezone for old text. */
export interface ChatDateTimeContext {
  locale: string;
  timeZone: string;
  dateOrder: Array<'year' | 'month' | 'day'>;
  hourCycle: 'h11' | 'h12' | 'h23' | 'h24';
}

export function currentDateTimeContext(locale?: string, timeZone?: string): ChatDateTimeContext {
  // Match the editor's Gregorian, Latin-digit date and minute-precision time options.
  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    calendar: 'gregory', numberingSystem: 'latn', timeZone
  });
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', numberingSystem: 'latn', timeZone
  });
  const dateOrder = date.formatToParts(new Date(2001, 10, 22))
    .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
    .map((part) => part.type as 'year' | 'month' | 'day');
  return {
    locale: date.resolvedOptions().locale,
    timeZone: date.resolvedOptions().timeZone,
    dateOrder,
    hourCycle: time.resolvedOptions().hourCycle!
  };
}
