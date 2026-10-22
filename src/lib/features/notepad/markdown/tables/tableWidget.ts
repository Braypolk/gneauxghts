import { EditorView, WidgetType } from '@codemirror/view';
import MarkdownIt from 'markdown-it';
import { changeTable, editTableCell, type TableOperation } from './tableCommands';
import { tableSourceEffect, type MarkdownTable, type TableCellLocation } from './tableModel';

const inline = new MarkdownIt({ html: false, linkify: false, breaks: false });
// Cell activation edits its Markdown. Keep previews passive, including images:
// no remote asset loads or a second link navigation surface inside the button.
inline.renderer.rules.link_open = inline.renderer.rules.link_close = () => '';
inline.renderer.rules.image = (tokens: { content: string }[], index: number) => inline.utils.escapeHtml(tokens[index].content);

interface MountedTable {
  ref: MarkdownTable;
  readOnly: boolean;
  active: { row: number; column: number };
  grid: HTMLTableElement;
  toolbar: HTMLElement;
  status: HTMLElement;
  composing: HTMLInputElement | null;
  cancelledComposition: HTMLInputElement | null;
}
const mounted = new WeakMap<HTMLElement, MountedTable>();

export function focusTableCell(view: EditorView, location: TableCellLocation) {
  const container = [...view.dom.querySelectorAll<HTMLElement>('.gn-table')]
    .find(element => element.dataset.tableFrom === String(location.from));
  const preview = container?.querySelector<HTMLButtonElement>(`.gn-table-cell-preview[data-row="${location.row}"][data-column="${location.column}"]`);
  preview?.click();
}

function showSource(view: EditorView, table: MarkdownTable) {
  view.dispatch({ selection: { anchor: table.from, head: table.to }, effects: tableSourceEffect.of(table.from) });
  view.focus();
}

function updateToolbar(data: MountedTable) {
  const { row, column } = data.active;
  for (const button of data.toolbar.querySelectorAll<HTMLButtonElement>('button[data-operation]')) {
    const operation = button.dataset.operation;
    button.disabled = data.readOnly || (operation === 'removeRow' && row === 0) || (operation === 'removeColumn' && data.ref.alignments.length === 1);
  }
  const alignment = data.toolbar.querySelector<HTMLSelectElement>('select');
  if (alignment) { alignment.value = data.ref.alignments[column] ?? 'left'; alignment.disabled = data.readOnly; }
  data.status.textContent = `Row ${row + 1}, column ${column + 1}`;
}

function makeCell(view: EditorView, container: HTMLElement, data: MountedTable, row: number, column: number) {
  const cell = document.createElement(row === 0 ? 'th' : 'td');
  const preview = document.createElement('button');
  preview.type = 'button'; preview.className = 'gn-table-cell-preview';
  preview.dataset.row = String(row); preview.dataset.column = String(column);
  preview.setAttribute('aria-label', `Edit ${row === 0 ? 'header' : 'row ' + (row + 1)}, column ${column + 1}`);
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'gn-table-cell-input'; input.hidden = true;
  input.setAttribute('aria-label', `${row === 0 ? 'Header' : 'Row ' + (row + 1)}, column ${column + 1}`);
  input.autocomplete = 'off';
  const activate = (select = true) => {
    if (mounted.get(container) !== data) return;
    data.active = { row, column }; updateToolbar(data);
    if (data.readOnly) return;
    for (const other of data.grid.querySelectorAll<HTMLInputElement>('input')) if (other !== input) {
      other.hidden = true; other.previousElementSibling?.removeAttribute('hidden');
    }
    preview.hidden = true; input.hidden = false; input.focus({ preventScroll: true });
    if (select) input.select();
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  preview.onclick = event => { event.preventDefault(); event.stopPropagation(); activate(); };
  input.onfocus = () => { data.active = { row, column }; updateToolbar(data); };
  input.onblur = () => {
    if (mounted.get(container) !== data) return;
    input.hidden = true; preview.hidden = false;
    if (data.composing === input) { data.composing = null; editTableCell(view, data.ref, row, column, input.value); }
  };
  const commit = () => {
    if (mounted.get(container) !== data || data.readOnly) return;
    const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
    const length = input.value.length;
    if (!editTableCell(view, data.ref, row, column, input.value)) return;
    const delta = input.value.length - length;
    input.setSelectionRange(Math.max(0, start + delta), Math.max(0, end + delta));
  };
  input.oninput = event => { if (!(event as InputEvent).isComposing && data.composing !== input) commit(); };
  input.addEventListener('compositionstart', () => { data.composing = input; data.cancelledComposition = null; });
  input.addEventListener('compositionend', () => {
    if (mounted.get(container) !== data) return;
    data.composing = null;
    if (data.cancelledComposition === input) {
      input.value = data.ref.rows[row]?.cells[column]?.value ?? '';
      data.cancelledComposition = null; return;
    }
    commit();
  });
  input.onkeydown = event => {
    if (mounted.get(container) !== data) return;
    if (event.isComposing || data.composing === input) return;
    if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      // Existing pane shortcuts route Undo/Redo to the shared document root.
      // A native input undo would change only this disposable projection.
      event.preventDefault(); event.stopPropagation();
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, code: event.code,
        metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true }));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); input.blur();
      view.dispatch({ selection: { anchor: data.ref.to } }); view.focus(); return;
    }
    if (event.key !== 'Tab' && event.key !== 'Enter') return;
    event.preventDefault(); event.stopPropagation();
    const columns = data.ref.alignments.length;
    let targetRow = row, targetColumn = column;
    if (event.key === 'Enter') targetRow += event.shiftKey ? -1 : 1;
    else {
      targetColumn += event.shiftKey ? -1 : 1;
      if (targetColumn < 0) { targetRow--; targetColumn = columns - 1; }
      if (targetColumn >= columns) { targetRow++; targetColumn = 0; }
    }
    if (targetRow < 0) { input.blur(); view.dispatch({ selection: { anchor: data.ref.from } }); view.focus(); return; }
    if (targetRow >= data.ref.rows.length) { changeTable(view, data.ref, 'addRow', row, targetColumn); return; }
    focusTableCell(view, { from: data.ref.from, row: targetRow, column: targetColumn });
  };
  cell.append(preview, input);
  return cell;
}

export class MarkdownTableWidget extends WidgetType {
  constructor(readonly ref: MarkdownTable, readonly readOnly: boolean) { super(); }
  override eq(other: MarkdownTableWidget) { return this.ref.from === other.ref.from && this.ref.source === other.ref.source && this.readOnly === other.readOnly; }
  override toDOM(view: EditorView) {
    const container = document.createElement('div'); container.className = 'gn-table'; container.contentEditable = 'false';
    const toolbar = document.createElement('div'); toolbar.className = 'gn-table-toolbar'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Table controls');
    const scroll = document.createElement('div'); scroll.className = 'gn-table-scroll';
    const grid = document.createElement('table'); grid.setAttribute('aria-label', 'Markdown table'); scroll.append(grid);
    const status = document.createElement('span'); status.className = 'gn-table-position';
    const data: MountedTable = { ref: this.ref, readOnly: this.readOnly, active: { row: 0, column: 0 }, toolbar, grid, status, composing: null, cancelledComposition: null };
    mounted.set(container, data);
    const control = (label: string, text: string, operation: TableOperation) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.title = label; button.setAttribute('aria-label', label); button.dataset.operation = operation;
      button.onclick = event => { event.preventDefault(); event.stopPropagation(); changeTable(view, data.ref, operation, data.active.row, data.active.column); };
      return button;
    };
    toolbar.append(control('Add row below selected cell', '+ Row', 'addRow'), control('Remove selected row', '− Row', 'removeRow'),
      control('Add column after selected cell', '+ Column', 'addColumn'), control('Remove selected column', '− Column', 'removeColumn'));
    const alignment = document.createElement('select'); alignment.setAttribute('aria-label', 'Column alignment');
    for (const [value, label] of [['left', 'Align left'], ['center', 'Align center'], ['right', 'Align right']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; alignment.append(option);
    }
    alignment.onchange = () => changeTable(view, data.ref, alignment.value as TableOperation, data.active.row, data.active.column);
    const source = document.createElement('button'); source.type = 'button'; source.textContent = 'Source'; source.title = 'Edit table Markdown source';
    source.onclick = event => { event.preventDefault(); event.stopPropagation(); showSource(view, data.ref); };
    toolbar.append(alignment, source, status); container.append(toolbar, scroll);
    this.updateDOM(container, view);
    return container;
  }
  override updateDOM(container: HTMLElement, view: EditorView) {
    const data = mounted.get(container);
    if (!data) return false;
    if (data.composing && (data.ref.source !== this.ref.source || this.readOnly)) {
      data.cancelledComposition = data.composing;
      data.composing = null;
    }
    data.ref = this.ref; data.readOnly = this.readOnly; container.dataset.tableFrom = String(this.ref.from);
    const columns = this.ref.alignments.length;
    if (data.grid.rows.length !== this.ref.rows.length || data.grid.rows[0]?.cells.length !== columns) {
      data.grid.replaceChildren();
      const head = document.createElement('thead'), body = document.createElement('tbody');
      for (let row = 0; row < this.ref.rows.length; row++) {
        const tr = document.createElement('tr');
        for (let column = 0; column < columns; column++) tr.append(makeCell(view, container, data, row, column));
        (row === 0 ? head : body).append(tr);
      }
      data.grid.append(head, body);
    }
    data.active.row = Math.min(data.active.row, this.ref.rows.length - 1);
    data.active.column = Math.min(data.active.column, columns - 1);
    for (let row = 0; row < this.ref.rows.length; row++) for (let column = 0; column < columns; column++) {
      const cell = data.grid.rows[row].cells[column], value = this.ref.rows[row].cells[column]?.value ?? '';
      cell.style.textAlign = this.ref.alignments[column];
      const preview = cell.firstElementChild as HTMLButtonElement, input = cell.lastElementChild as HTMLInputElement;
      preview.innerHTML = inline.renderInline(value) || '<span class="gn-table-empty">Empty</span>';
      if (input.value !== value && data.composing !== input) input.value = value;
      input.disabled = this.readOnly;
      if (this.readOnly) { input.hidden = true; preview.hidden = false; }
    }
    updateToolbar(data);
    return true;
  }
  override ignoreEvent() { return true; }
  override destroy(container: HTMLElement) { mounted.delete(container); }
}

export class TableSourceDoneWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number) { super(); }
  override eq(other: TableSourceDoneWidget) { return this.from === other.from && this.to === other.to; }
  override toDOM(view: EditorView) {
    const wrapper = document.createElement('div'); wrapper.className = 'gn-table-source-controls'; wrapper.contentEditable = 'false';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Done editing table source';
    button.onclick = () => { view.dispatch({ selection: { anchor: this.to }, effects: tableSourceEffect.of(null) }); view.focus(); };
    wrapper.append(button); return wrapper;
  }
  override ignoreEvent() { return true; }
}
