import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { isDateTimePickerOpen, openDateTimePicker, type DateTimePickerClose } from '$lib/features/tasks/dateTimePicker';
import { dueAnnotations, formatDueDate, setTaskLineDueDate, subscribeCalendarDay, taskDueDate } from '$lib/features/tasks/taskDates';
import { formatPickedDateTime, inlineDateTexts, isExcludedDateContext, taskMarkerPattern, type InlineDateText } from './dateCommands';
import { editorFloatingReference } from './editorFloatingReference';

const pickerClosers = new WeakMap<EditorView, { close: DateTimePickerClose; editInNote: boolean }>();

function pickerClosed(view: EditorView, close: DateTimePickerClose, restoreFocus: boolean) {
  if (pickerClosers.get(view)?.close === close) pickerClosers.delete(view);
  if (restoreFocus && !isDateTimePickerOpen() && view.dom.isConnected) view.focus();
}

const refreshDates = StateEffect.define<null>();

export function openTaskDueDatePicker(view: EditorView, pos: number, token?: { from: number; to: number } | null, anchorElement?: HTMLElement) {
  const line = view.state.doc.lineAt(pos);
  if (!taskMarkerPattern.test(line.text) || isExcludedDateContext(view.state, line.from)) return;
  const expectedDoc = view.state.doc;
  const text = token ? line.text.slice(0, token.from - line.from) + line.text.slice(token.to - line.from) : line.text;
  const close = openDateTimePicker({
    mode: 'due', title: taskDueDate(text) ? 'Edit due date' : 'Add due date', date: taskDueDate(text),
    reference: editorFloatingReference(view, token?.from ?? pos, anchorElement),
    boundsElement: view.dom.closest<HTMLElement>('[data-pane-id]'),
    onCommit: ({ date }) => {
      if (!view.dom.isConnected || view.state.doc !== expectedDoc) throw new Error('The note changed while the picker was open. Cancel and reopen the task date.');
      const insert = setTaskLineDueDate(text, date);
      view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: Math.min(view.state.selection.main.head, line.from + insert.length) }, userEvent: 'input', annotations: isolateHistory.of('full') });
    },
    onClose: (restoreFocus) => pickerClosed(view, close, restoreFocus)
  });
  pickerClosers.set(view, { close, editInNote: false });
  return close;
}

function openInlineDatePicker(view: EditorView, from: number, value: InlineDateText, anchorElement: HTMLElement) {
  const expectedDoc = view.state.doc;
  view.focus();
  const close = openDateTimePicker({ mode: value.mode, title: value.mode === 'datetime' ? 'Edit date and time' : `Edit ${value.mode}`, date: value.date, time: value.time,
    editInNote: true,
    reference: editorFloatingReference(view, from, anchorElement),
    boundsElement: view.dom.closest<HTMLElement>('[data-pane-id]'),
    onCommit: ({ date, time }) => {
      if (!view.dom.isConnected || view.state.doc !== expectedDoc) throw new Error('The note changed while the picker was open. Cancel and reopen the date.');
      const insert = formatPickedDateTime(value.mode, date, time);
      close();
      view.dispatch({ changes: { from, to: from + value.text.length, insert }, selection: { anchor: from + insert.length }, userEvent: 'input', annotations: isolateHistory.of('full') });
    }, onClose: (restoreFocus) => pickerClosed(view, close, restoreFocus)
  });
  pickerClosers.set(view, { close, editInNote: true });
  view.dispatch({ selection: { anchor: from, head: from + value.text.length } });
}

class DateChip extends WidgetType {
  constructor(readonly label: string, readonly title: string, readonly due: boolean, readonly value: InlineDateText | null = null) { super(); }
  eq(other: DateChip) { return this.label === other.label && this.title === other.title && this.due === other.due && JSON.stringify(this.value) === JSON.stringify(other.value); }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = this.label === '+' ? 'cm-gn-date-add' : 'cm-gn-date-chip';
    button.textContent = this.label;
    button.title = this.title;
    button.setAttribute('aria-label', this.title);
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      const pos = view.posAtDOM(button);
      if (this.due) openTaskDueDatePicker(view, pos, null, button);
      else if (this.value) openInlineDatePicker(view, pos, this.value, button);
    });
    return button;
  }
  ignoreEvent() { return true; }
}

function buildDateDecorations(view: EditorView): DecorationSet {
  const ranges = [];
  for (const viewport of view.visibleRanges) {
    const first = view.state.doc.lineAt(viewport.from).number;
    const last = view.state.doc.lineAt(viewport.to).number;
    for (let lineNo = first; lineNo <= last; lineNo++) {
      const line = view.state.doc.line(lineNo);
      const annotations = taskMarkerPattern.test(line.text) && !isExcludedDateContext(view.state, line.from) ? dueAnnotations(line.text) : [];
      const effective = annotations[0];
      if (effective) {
        const from = line.from + effective.from, to = line.from + effective.to;
        if (!view.state.selection.ranges.some((range) => range.from <= to && range.to >= from)) {
          const completed = /^\s*(?:[-+*]|\d+[.)])\s+\[[xX]\]/.test(line.text);
          ranges.push(Decoration.replace({ widget: new DateChip(formatDueDate(effective.date, undefined, completed), `Edit due date: ${effective.date}`, true) }).range(from, to));
        }
      } else if (taskMarkerPattern.test(line.text) && !isExcludedDateContext(view.state, line.from)) {
        ranges.push(Decoration.widget({ widget: new DateChip('+', 'Add due date', true), side: 1 }).range(line.to));
      }
      for (const value of inlineDateTexts(line.text)) {
        const from = line.from + value.from, to = line.from + value.to;
        if (annotations.some((annotation) => value.from < annotation.to && value.to > annotation.from) || /@\w+\([^)]*$/.test(line.text.slice(0, value.from))) continue;
        if (isExcludedDateContext(view.state, from) || isExcludedDateContext(view.state, to)) continue;
        if (view.state.selection.ranges.some((range) => range.from <= to && range.to >= from)) continue;
        ranges.push(Decoration.replace({ widget: new DateChip(value.text, `Edit ${value.mode === 'datetime' ? 'date and time' : value.mode}: ${value.text}`, false, value) }).range(from, to));
      }
    }
  }
  return Decoration.set(ranges, true);
}

export function createTaskDateExtension() {
  return [ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    dispose: () => void;
    constructor(readonly view: EditorView) {
      this.decorations = buildDateDecorations(view);
      let initializing = true;
      this.dispose = subscribeCalendarDay(() => { if (!initializing && view.dom.isConnected) view.dispatch({ effects: refreshDates.of(null) }); });
      initializing = false;
    }
    update(update: ViewUpdate) {
      const picker = pickerClosers.get(update.view);
      if (update.docChanged && picker?.editInNote) picker.close(false);
      if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshDates)))) this.decorations = buildDateDecorations(update.view);
    }
    destroy() { this.dispose(); pickerClosers.get(this.view)?.close(); }
  }, { decorations: (plugin) => plugin.decorations })];
}
