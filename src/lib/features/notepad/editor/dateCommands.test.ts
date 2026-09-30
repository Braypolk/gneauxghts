import { describe, expect, it, vi } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { createMarkdownLanguage } from '../markdown/markdownLanguage';
import { formatDateInsertion, formatPickedDateTime, inlineDateTexts, slashTokenAtSelection } from './dateCommands';
import { getSlashMenuState, runSlashMenuSelection } from './slashMenu';

vi.mock('$lib/features/tasks/dateTimePicker', () => ({ openDateTimePicker: vi.fn(), isDateTimePickerOpen: () => false }));
function state(doc: string, pos = doc.length) { return EditorState.create({ doc, selection: { anchor: pos }, extensions: [createMarkdownLanguage(), history()] }); }

describe('inline date commands', () => {
  it('finds only standalone slash tokens at an empty caret in prose or tasks', () => {
    for (const doc of ['/date', 'Meeting /now', '- [ ] Ship /due', '  - [ ] Child /today']) expect(slashTokenAtSelection(state(doc))).not.toBeNull();
    for (const doc of ['https://site/date', 'path/date', 'text/date', '`/date`', '```\n/date\n```', '[a](https://site /date)', '    /date', '/date/text']) {
      const pos = doc.indexOf('/date') + 5;
      expect(slashTokenAtSelection(state(doc, pos)), doc).toBeNull();
    }
    expect(slashTokenAtSelection(state('before /date after', 12))).toMatchObject({ from: 7, to: 12, block: false });
    const selected = state('/date').update({ selection: { anchor: 0, head: 5 } }).state;
    expect(slashTokenAtSelection(selected)).toBeNull();
    expect(slashTokenAtSelection(state('/date '))).toBeNull();
  });
  it('limits inline menus to insertions and exposes due only in a task', () => {
    expect(getSlashMenuState('', false).groups.map((group) => group.key)).toEqual(['insert']);
    expect(getSlashMenuState('due', false, true).size).toBe(1);
    expect(getSlashMenuState('heading', true).size).toBe(6);
    expect(slashTokenAtSelection(state('/heading 1'))).toMatchObject({ block: true, filter: 'heading 1' });
    expect(getSlashMenuState('today', false).size).toBe(1);
  });
  it('resolves fixed local text at invocation with locale and timezone', () => {
    const instant = new Date('2026-09-30T03:32:00Z');
    expect(formatDateInsertion('date', instant, 'en-US', 'America/Denver')).toBe('09/29/2026');
    expect(formatDateInsertion('date', instant, 'en-GB', 'Asia/Tokyo')).toBe('30/09/2026');
    expect(formatDateInsertion('time', instant, 'en-GB', 'America/Denver')).toBe('21:32');
    expect(formatDateInsertion('now', instant, 'en-GB', 'America/Denver')).toBe('29/09/2026 21:32');
  });
  it('replaces only the invoked token as one undoable edit, preserving following text', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 29, 9, 32));
    let current = state('Before /date after', 12);
    const view = { get state() { return current; }, dispatch(spec: TransactionSpec) { current = current.update(spec).state; }, focus() {} } as unknown as EditorView;
    runSlashMenuSelection(view, 'date');
    expect(current.doc.toString()).toBe(`Before ${formatDateInsertion('date')} after`);
    expect(undo({ state: current, dispatch: (tr) => { current = tr.state; } })).toBe(true);
    expect(current.doc.toString()).toBe('Before /date after');
    expect(current.selection.main.head).toBe(12);
    redo({ state: current, dispatch: (tr) => { current = tr.state; } });
    const inserted = current.doc.toString();
    vi.advanceTimersByTime(86_400_000);
    expect(current.doc.toString()).toBe(inserted);
    vi.useRealTimers();
  });
  it('recognizes editable plain date/time text using locale order without hidden metadata', () => {
    expect(inlineDateTexts('Meet 09/29/2026 9:32 AM then 10:00 PM.', 'en-US')).toMatchObject([{ mode: 'datetime', date: '2026-09-29', time: '09:32' }, { mode: 'time', time: '22:00' }]);
    expect(inlineDateTexts('29/09/2026 21:32', 'en-GB')).toMatchObject([{ mode: 'datetime', date: '2026-09-29', time: '21:32' }]);
    expect(inlineDateTexts('02/29/2026 path09/29/2026 99:99', 'en-US')).toHaveLength(0);
    expect(formatPickedDateTime('datetime', '2026-03-08', '02:30', 'en-GB')).toBe('08/03/2026 2:30');
  });
  it('round-trips midnight chips in locales with the h24 hour cycle', () => {
    const locale = 'en-US-u-hc-h24';
    const text = formatDateInsertion('time', new Date('2026-09-30T00:32:00Z'), locale, 'UTC');
    expect(text).toBe('24:32');
    expect(inlineDateTexts(text, locale)).toMatchObject([{ mode: 'time', time: '00:32' }]);
    expect(formatPickedDateTime('time', null, '00:32', locale)).toBe(text);
    expect(inlineDateTexts('24:32', 'en-GB-u-hc-h23')).toHaveLength(0);
  });
});
