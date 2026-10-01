<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Calendar } from 'bits-ui';
  import { parseDate, type DateValue } from '@internationalized/date';
  import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { localCalendarDate, resolveDateShortcut, validCalendarDate } from './taskDates';
  import type { DateTimePickerOptions, PickerValue } from './dateTimePicker';
  import { hiddenFloatingPanelStyle, positionFloatingPanel } from '$lib/ui/floatingPanel';

  let { options, close }: { options: DateTimePickerOptions; close: (restoreFocus?: boolean) => void } = $props();
  const id = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let panelStyle = $state(hiddenFloatingPanelStyle);
  let dateText = $state(untrack(() => options.date ?? localCalendarDate()));
  let timeText = $state(untrack(() => options.time ?? '09:00'));
  let error = $state('');
  let saving = $state(false);
  let today = $state(localCalendarDate());
  let calendarValue = $state<DateValue | undefined>(untrack(() => parseDate(dateText)));
  let placeholder = $state<DateValue>(untrack(() => parseDate(dateText)));
  const years = $derived(Array.from(
    { length: Math.min(9999, placeholder.year + 100) - Math.max(1, placeholder.year - 100) + 1 },
    (_, index) => Math.max(1, placeholder.year - 100) + index
  ));
  const resolved = $derived(resolveDateShortcut(dateText, today));
  const hasDate = $derived(options.mode !== 'time');
  const hasTime = $derived(options.mode === 'time' || options.mode === 'datetime');
  const validTime = $derived(/^([01]\d|2[0-3]):[0-5]\d$/.test(timeText));

  function updateDate(value: string) {
    dateText = value;
    const date = resolveDateShortcut(value, localCalendarDate());
    if (date) { calendarValue = parseDate(date); placeholder = calendarValue; }
  }

  async function commit(remove = false) {
    if (saving) return;
    today = localCalendarDate();
    const date = resolveDateShortcut(dateText, today);
    if (!remove && ((hasDate && (!date || !validCalendarDate(date))) || (hasTime && !validTime))) return;
    saving = true;
    error = '';
    try {
      const value: PickerValue = { date: remove ? null : date, time: hasTime ? timeText : null };
      await options.onCommit(value);
      close();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally { saving = false; }
  }

  onMount(() => {
    const handle = setInterval(() => { today = localCalendarDate(); }, 30_000);
    return () => { clearInterval(handle); };
  });

  $effect(() => {
    if (!dialog) return;
    const panel = dialog;
    let focused = false;
    return positionFloatingPanel(options.reference, panel, (style) => {
      panelStyle = style;
      if (!focused && !options.editInNote) {
        focused = true;
        void tick().then(() => { if (panel.isConnected && panel.open) panel.querySelector('input')?.focus(); });
      }
    }, { boundsElement: options.boundsElement });
  });

  function dismiss() { if (!saving) close(); }

  function handleOutsidePointer(event: PointerEvent) {
    if (dialog && !event.composedPath().includes(dialog) && !saving) close(false);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  }
</script>

<svelte:window onkeydowncapture={handleKeydown} onpointerdowncapture={handleOutsidePointer} />

<div class="date-time-picker-root fixed inset-0 z-50" style:pointer-events={saving ? 'auto' : 'none'}>
  <dialog open bind:this={dialog} style={panelStyle} class={`date-time-picker pointer-events-auto m-0 overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-xl ${options.editInNote ? 'w-[min(20rem,calc(100vw-2rem))] p-3' : 'w-[min(23rem,calc(100vw-2rem))] p-5'}`} oncancel={(event) => { event.preventDefault(); dismiss(); }} aria-label={options.editInNote ? options.title : undefined} aria-labelledby={options.editInNote ? undefined : `${id}-title`} aria-describedby={options.editInNote ? undefined : `${id}-description`}>
    {#if !options.editInNote}
      <h2 id={`${id}-title`} class="text-base font-medium">{options.title}</h2>
      <p id={`${id}-description`} class="mt-1 text-xs text-muted-foreground">{hasDate ? 'Type a date or select one below.' : 'Type a time or use the time control.'}</p>
    {/if}
    <form class={options.editInNote ? 'space-y-3' : 'mt-4 space-y-3'} onsubmit={(event) => { event.preventDefault(); void commit(); }}>
      {#if hasDate}
        {#if !options.editInNote}
          <label class="block text-sm" for={`${id}-date`}>Date</label>
          <input id={`${id}-date`} aria-label="Date or shortcut" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={dateText} oninput={(event) => updateDate(event.currentTarget.value)} placeholder="YYYY-MM-DD, Friday, in 3 days" autocomplete="off" disabled={saving} />
          <p aria-live="polite" class="text-xs text-muted-foreground">{resolved ? `Selected: ${resolved}` : 'Use YYYY-MM-DD, today, tomorrow, next week, a weekday, or in N days.'}</p>
        {/if}
        {#if options.mode === 'due'}
          <div class="flex flex-wrap gap-1">
            {#each ['Today', 'Tomorrow', 'Next week'] as preset}
              <Button variant="ghost" size="sm" disabled={saving} onclick={() => updateDate(preset)} title={resolveDateShortcut(preset, today) ?? ''}>{preset} <span class="text-[10px] text-muted-foreground">{resolveDateShortcut(preset, today)}</span></Button>
            {/each}
          </div>
        {/if}
        <Calendar.Root type="single" value={calendarValue} bind:placeholder preventDeselect weekdayFormat="short" locale={navigator.language} disabled={saving} onValueChange={(value) => { if (value) updateDate(value.toString()); }} class="p-0">
          {#snippet children({ months, weekdays })}
            <Calendar.Header class="mb-3 flex items-center justify-between gap-2">
              <Calendar.PrevButton data-testid="date-picker-previous-month" aria-label="Previous month" class="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft class="size-4" /></Calendar.PrevButton>
              <Calendar.Heading class="sr-only" />
              <div class="flex items-center gap-2">
                <div class="relative">
                  <Calendar.MonthSelect aria-label="Calendar month" monthFormat="short" disabled={saving} class="h-9 w-20 appearance-none rounded-lg border border-border bg-transparent pl-2.5 pr-7 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" />
                  <ChevronDown class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
                <div class="relative">
                  <Calendar.YearSelect aria-label="Calendar year" {years} disabled={saving} class="h-9 w-22 appearance-none rounded-lg border border-border bg-transparent pl-2.5 pr-7 text-sm tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" />
                  <ChevronDown class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
              <Calendar.NextButton data-testid="date-picker-next-month" aria-label="Next month" class="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight class="size-4" /></Calendar.NextButton>
            </Calendar.Header>
            {#each months as month}
              <Calendar.Grid class="w-full table-fixed border-collapse">
                <Calendar.GridHead><Calendar.GridRow>{#each weekdays as day}<Calendar.HeadCell class="h-8 p-0 text-center text-xs font-normal text-muted-foreground">{day.slice(0, 2)}</Calendar.HeadCell>{/each}</Calendar.GridRow></Calendar.GridHead>
                <Calendar.GridBody>
                  {#each month.weeks as week}<Calendar.GridRow>
                    {#each week as date}<Calendar.Cell {date} month={month.value} class="h-11 p-0 text-center">
                      <Calendar.Day class="mx-auto flex size-9 items-center justify-center rounded-xl p-0 text-sm leading-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-selected:bg-accent data-selected:text-foreground data-outside-month:text-muted-foreground data-today:font-medium">{date.day}</Calendar.Day>
                    </Calendar.Cell>{/each}
                  </Calendar.GridRow>{/each}
                </Calendar.GridBody>
              </Calendar.Grid>
            {/each}
          {/snippet}
        </Calendar.Root>
      {/if}
      {#if hasTime}
        <label class="block text-sm" for={`${id}-time`}>Time</label>
        <input id={`${id}-time`} aria-label="Time" type="time" step="60" bind:value={timeText} disabled={saving} class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {/if}
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      <div class="flex flex-wrap justify-end gap-2 pt-1">
        {#if options.mode === 'due' && options.date}<Button variant="ghost" size="sm" disabled={saving} onclick={() => void commit(true)}>Remove due date</Button>{/if}
        <Button variant="outline" size="sm" disabled={saving} onclick={() => close()}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving || (hasDate && !resolved) || (hasTime && !validTime)}>{saving ? 'Saving…' : 'Apply'}</Button>
      </div>
    </form>
  </dialog>
</div>
