import { mount, unmount } from 'svelte';
import DateTimePicker from './DateTimePicker.svelte';

export interface PickerValue { date: string | null; time: string | null }
export interface DateTimePickerOptions {
  title: string;
  mode: 'due' | 'date' | 'time' | 'datetime';
  date?: string | null;
  time?: string | null;
  onCommit: (value: PickerValue) => Promise<void> | void;
  onClose?: () => void;
}
let activeClose: (() => void) | null = null;
export function isDateTimePickerOpen() { return activeClose !== null; }

/** A modal owns its focus and temporary input only; commits belong to the caller. */
export function openDateTimePicker(options: DateTimePickerOptions): () => void {
  activeClose?.();
  const previousFocus = document.activeElement as HTMLElement | null;
  const target = document.createElement('div');
  document.body.appendChild(target);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    activeClose = null;
    void unmount(component).then(() => {
      target.remove();
      if (!activeClose && previousFocus?.isConnected) previousFocus.focus();
      options.onClose?.();
    });
  };
  const component = mount(DateTimePicker, { target, props: { options, close } });
  activeClose = close;
  return close;
}
