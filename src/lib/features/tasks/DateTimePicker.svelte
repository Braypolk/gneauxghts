<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Calendar } from 'bits-ui';
  import { parseDate, type DateValue } from '@internationalized/date';
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { localCalendarDate, resolveDateShortcut, validCalendarDate } from './taskDates';
  import type { DateTimePickerOptions, PickerValue } from './dateTimePicker';

  let { options, close }: { options: DateTimePickerOptions; close: () => void } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let dateText = $state(untrack(() => options.date ?? localCalendarDate()));
  let timeText = $state(untrack(() => options.time ?? '09:00'));
  let error = $state('');
  let saving = $state(false);
  let today = $state(localCalendarDate());
  let calendarValue = $state<DateValue | undefined>(untrack(() => parseDate(dateText)));
  let placeholder = $state<DateValue>(untrack(() => parseDate(dateText)));
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
    dialog.showModal();
    const handle = setInterval(() => { today = localCalendarDate(); }, 30_000);
    return () => { clearInterval(handle); dialog.close(); };
  });
</script>

<dialog bind:this={dialog} class="date-time-picker w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl" oncancel={(event) => { event.preventDefault(); if (!saving) close(); }} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
  <h2 id={`${id}-title`} class="text-base font-medium">{options.title}</h2>
  <p id={`${id}-description`} class="mt-1 text-xs text-muted-foreground">{hasDate ? 'Type a date or select one below.' : 'Type a time or use the time control.'}</p>
  <form class="mt-4 space-y-3" onsubmit={(event) => { event.preventDefault(); void commit(); }}>
    {#if hasDate}
      <label class="block text-sm" for={`${id}-date`}>Date</label>
      <input id={`${id}-date`} aria-label="Date or shortcut" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={dateText} oninput={(event) => updateDate(event.currentTarget.value)} placeholder="YYYY-MM-DD, Friday, in 3 days" autocomplete="off" disabled={saving} />
      <p aria-live="polite" class="text-xs text-muted-foreground">{resolved ? `Selected: ${resolved}` : 'Use YYYY-MM-DD, today, tomorrow, next week, a weekday, or in N days.'}</p>
      {#if options.mode === 'due'}
        <div class="flex flex-wrap gap-1">
          {#each ['Today', 'Tomorrow', 'Next week'] as preset}
            <Button variant="ghost" size="sm" disabled={saving} onclick={() => updateDate(preset)} title={resolveDateShortcut(preset, today) ?? ''}>{preset} <span class="text-[10px] text-muted-foreground">{resolveDateShortcut(preset, today)}</span></Button>
          {/each}
        </div>
      {/if}
      <Calendar.Root type="single" value={calendarValue} bind:placeholder preventDeselect locale={navigator.language} disabled={saving} onValueChange={(value) => { if (value) updateDate(value.toString()); }} class="rounded-lg border border-border p-2">
        {#snippet children({ months, weekdays })}
          <Calendar.Header class="mb-2 flex items-center justify-between">
            <Calendar.PrevButton data-testid="date-picker-previous-month" aria-label="Previous month" class="rounded-md p-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft class="size-4" /></Calendar.PrevButton>
            <Calendar.Heading class="text-sm font-medium" />
            <Calendar.NextButton data-testid="date-picker-next-month" aria-label="Next month" class="rounded-md p-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight class="size-4" /></Calendar.NextButton>
          </Calendar.Header>
          {#each months as month}
            <Calendar.Grid class="w-full border-collapse">
              <Calendar.GridHead><Calendar.GridRow>{#each weekdays as day}<Calendar.HeadCell class="pb-1 text-xs font-normal text-muted-foreground">{day}</Calendar.HeadCell>{/each}</Calendar.GridRow></Calendar.GridHead>
              <Calendar.GridBody>
                {#each month.weeks as week}<Calendar.GridRow>
                  {#each week as date}<Calendar.Cell {date} month={month.value} class="p-0 text-center">
                    <Calendar.Day class="size-8 rounded-md text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-selected:bg-primary data-selected:text-primary-foreground data-outside-month:text-muted-foreground data-today:underline">{date.day}</Calendar.Day>
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
      <Button variant="outline" size="sm" disabled={saving} onclick={close}>Cancel</Button>
      <Button type="submit" size="sm" disabled={saving || (hasDate && !resolved) || (hasTime && !validTime)}>{saving ? 'Saving…' : 'Apply'}</Button>
    </div>
  </form>
</dialog>

<style>
  .date-time-picker::backdrop { background: color-mix(in oklab, var(--background) 65%, transparent); }
</style>
