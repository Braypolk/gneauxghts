const SHORT_MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric'
});

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

export function formatGraphDateShort(millis: number): string {
  return SHORT_MONTH_YEAR_FORMATTER.format(new Date(millis));
}

export function formatGraphFilterDate(millis: number): string {
  return FULL_DATE_FORMATTER.format(new Date(millis));
}
