import { mount, unmount } from 'svelte';
import DateTimePicker from './DateTimePicker.svelte';
import type { ReferenceElement } from '@floating-ui/dom';

export interface PickerValue { date: string | null; time: string | null }
export type DateTimePickerClose = (restoreFocus?: boolean) => void;
export interface DateTimePickerOptions {
  title: string;
  mode: 'due' | 'date' | 'time' | 'datetime';
  date?: string | null;
  time?: string | null;
  reference: ReferenceElement;
  boundsElement?: HTMLElement | null;
  editInNote?: boolean;
  onCommit: (value: PickerValue) => Promise<void> | void;
  /** Called after unmount; when provided, the caller owns focus restoration. */
  onClose?: (restoreFocus: boolean) => void;
}
let activeClose: DateTimePickerClose | null = null;
export function isDateTimePickerOpen() { return activeClose !== null; }

/** The anchored picker owns temporary input only; commits belong to the caller. */
export function openDateTimePicker(options: DateTimePickerOptions): DateTimePickerClose {
  activeClose?.();
  const previousFocus = document.activeElement as HTMLElement | null;
  const target = document.createElement('div');
  document.body.appendChild(target);
  let closed = false;
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    activeClose = null;
    void unmount(component).then(() => {
      target.remove();
      // Editors restore focus through EditorView.focus(), including WebKit's
      // scroll-preserving fallback. A native focus first can jump to an old caret.
      if (options.onClose) options.onClose(restoreFocus);
      else if (restoreFocus && !activeClose && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
  };
  const component = mount(DateTimePicker, { target, props: { options, close } });
  activeClose = close;
  return close;
}
