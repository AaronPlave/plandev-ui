<svelte:options immutable={true} />

<!--
  The analysis's annotations: what someone marked and what it means. One thing whatever it marks — a time or a time
  range across the rows, a value or value range on a row, an activity or a resource — edited in one place: its label,
  its place, and its explanation. With `focusKey`, one annotation, open to edit; without, all of them, to find one.
  Marks on the rows are drawn by the timeline; an annotation about a record by a flag at its time.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button, DropdownMenu } from '@nasa-jpl/stellar-svelte';
  import { Ellipsis, Link, Plus, Trash2 } from 'lucide-svelte';
  import { createEventDispatcher, tick } from 'svelte';
  import {
    addTimeAnnotation,
    analysis,
    analysisAnnotations,
    inspect,
    removeAnnotation,
    updateAnnotation,
  } from '../../stores/analysis';
  import { timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import { view, viewSetSelectedRow } from '../../stores/views';
  import type { AnalysisActivityRef, AnalysisSourceBinding } from '../../types/analysis';
  import { getSourceIdentity } from '../../utilities/analysis';
  import { describeAnnotation, listAnnotations, type AnnotationItem } from '../../utilities/analysisAnnotations';
  import { formatDate, getDoyTime, getUnixEpochTime } from '../../utilities/time';
  import { showFailureToast, showSuccessToast } from '../../utilities/toast';

  export let bindings: AnalysisSourceBinding[] = [];
  /** The annotation to show, open; null for the list of them all. */
  export let focusKey: string | null = null;
  export let readOnly: boolean = false;
  export let readOnlyReason: string = '';
  export let sourceLabels: Record<string, string> = {};

  const dispatch = createEventDispatcher<{
    goTo: { endMs: number; ref: AnalysisActivityRef | null; startMs: number };
  }>();

  let descriptionInput: HTMLTextAreaElement;
  let lastFocused: string | null = null;

  $: items = listAnnotations($view?.definition.plan.timelines[0], $analysisAnnotations);
  $: item = focusKey ? items.find(({ key }) => key === focusKey) : undefined;
  $: stale = item ? getStaleReason(item) : null;
  // A new annotation opens on its label: what to say next.
  $: if (focusKey !== lastFocused) {
    lastFocused = focusKey;
    if (item && !readOnly && !item.description) {
      tick().then(() => setTimeout(() => descriptionInput?.focus(), 50));
    }
  }

  /** Why an annotation's record can't be gone to as it was written, or null when it can. */
  function getStaleReason(of: AnnotationItem): string | null {
    const about = of.note?.about;
    if (!about) {
      return null;
    }
    const binding = bindings.find(({ id }) => id === about.sourceId);
    if (!binding) {
      return `${about.sourceLabel} is no longer in this analysis.`;
    }
    return getSourceIdentity(binding) === about.data
      ? null
      : `Written when ${about.sourceLabel} read ${about.data}; it now reads ${getSourceIdentity(binding)}. Not checked against it.`;
  }

  function goTo(of: AnnotationItem) {
    if (of.kind === 'value' && of.row) {
      viewSetSelectedRow(of.row.id);
      return;
    }
    if (of.startMs === undefined) {
      return;
    }
    const about = of.note?.about;
    dispatch('goTo', {
      endMs: of.endMs ?? of.startMs,
      ref:
        about?.kind === 'activity' && about.activityId !== undefined && !getStaleReason(of)
          ? { activityId: about.activityId, sourceId: about.sourceId }
          : null,
      startMs: of.startMs,
    });
  }

  function open(of: AnnotationItem) {
    inspect({ key: of.key, kind: 'annotation' });
    goTo(of);
  }

  async function copyLink(of: AnnotationItem) {
    const url = new URL(`${base}/analyses/${$analysis?.id}`, location.origin);
    if (of.note) {
      url.searchParams.set('note', `${of.note.id}`);
    }
    if (of.startMs !== undefined) {
      const endMs = of.endMs ?? of.startMs;
      const pad = Math.max((endMs - of.startMs) * 0.25, 30 * 60_000);
      url.searchParams.set('start', `${Math.round(of.startMs - pad)}`);
      url.searchParams.set('end', `${Math.round(endMs + pad)}`);
      url.searchParams.set('cursor', `${Math.round(of.startMs)}`);
    }
    try {
      await navigator.clipboard.writeText(url.toString());
      showSuccessToast('Copied a link to this annotation');
    } catch {
      showFailureToast('Could Not Copy The Link');
    }
  }

  function time(ms: number): string {
    return formatDate(new Date(ms), $plugins.time.primary.format);
  }

  function when(of: AnnotationItem): string {
    if (of.startMs === undefined) {
      return '';
    }
    return of.endMs !== undefined ? `${time(of.startMs)} – ${time(of.endMs)}` : time(of.startMs);
  }

  function setTime(of: AnnotationItem, field: 'end' | 'start', text: string) {
    const ms = getUnixEpochTime(text.trim());
    if (!ms) {
      showFailureToast('Write The Time As YYYY-DDDThh:mm:ss');
      return;
    }
    updateAnnotation(of.key, { [field]: ms });
  }

  function setValue(of: AnnotationItem, field: 'end' | 'start', text: string) {
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value)) {
      showFailureToast('The Value Must Be A Number');
      return;
    }
    updateAnnotation(of.key, { [field]: value });
  }

  function toggleRange(of: AnnotationItem, range: boolean) {
    if (!range) {
      updateAnnotation(of.key, { end: null });
    } else if (of.kind === 'time' && of.startMs !== undefined) {
      // The other cursor when there is one, else an hour on.
      const other = [$timeCursorMs, $timeCursorCompareMs].find(ms => ms !== null && ms !== of.startMs);
      updateAnnotation(of.key, { end: other ?? of.startMs + 3_600_000 });
    } else if (of.values?.length) {
      updateAnnotation(of.key, { end: of.values[0] + Math.max(Math.abs(of.values[0]) * 0.1, 1) });
    }
  }
</script>

<div class="annotations">
  {#if focusKey}
    {#if !item}
      <div class="empty">This annotation is no longer in the analysis.</div>
      <Button size="xs" variant="ghost" on:click={() => inspect({ kind: 'annotations' })}>All annotations</Button>
    {:else}
      {@const current = item}
      <div class="head" style:--color={current.color}>
        <span class="kind"
          >{describeAnnotation(
            current,
            current.note?.about ? sourceLabels[current.note.about.sourceId] : undefined,
          )}</span
        >
        <span class="grow" />
        {#if current.startMs !== undefined || current.kind === 'value'}
          <Button size="xs" variant="ghost" on:click={() => goTo(current)}>Go to</Button>
        {/if}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild let:builder>
            <Button builders={[builder]} size="icon-sm" variant="ghost" aria-label="Annotation actions">
              <Ellipsis size={13} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="text-xs">
            <DropdownMenu.Item class="gap-2 text-xs" on:click={() => copyLink(current)}>
              <Link size={12} />Copy link
            </DropdownMenu.Item>
            <DropdownMenu.Item class="gap-2 text-xs" on:click={() => inspect({ kind: 'annotations' })}>
              All annotations
            </DropdownMenu.Item>
            {#if !readOnly}
              <DropdownMenu.Separator />
              <DropdownMenu.Item class="gap-2 text-xs text-red-700" on:click={() => removeAnnotation(current.key)}>
                <Trash2 size={12} />Delete annotation
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      {#if current.kind === 'record' || current.kind === 'unanchored'}
        <div class="subject">{current.label || 'Annotation'}</div>
      {:else}
        <input
          class="st-input label"
          aria-label="Label"
          placeholder="Label"
          value={current.label}
          disabled={readOnly}
          on:input={event => updateAnnotation(current.key, { label: event.currentTarget.value })}
        />
      {/if}

      {#if current.kind === 'time' && current.startMs !== undefined}
        <div class="place">
          <input
            class="st-input"
            aria-label={current.endMs === undefined ? 'Time' : 'From'}
            value={getDoyTime(new Date(current.startMs))}
            disabled={readOnly}
            on:change={event => setTime(current, 'start', event.currentTarget.value)}
          />
          {#if current.endMs !== undefined}
            <span>–</span>
            <input
              class="st-input"
              aria-label="To"
              value={getDoyTime(new Date(current.endMs))}
              disabled={readOnly}
              on:change={event => setTime(current, 'end', event.currentTarget.value)}
            />
          {/if}
        </div>
      {:else if current.kind === 'value' && current.values}
        <div class="place">
          <input
            class="st-input"
            type="number"
            step="any"
            aria-label={current.values.length === 2 ? 'From value' : 'Value'}
            value={current.values[0]}
            disabled={readOnly}
            on:change={event => setValue(current, 'start', event.currentTarget.value)}
          />
          {#if current.values.length === 2}
            <span>–</span>
            <input
              class="st-input"
              type="number"
              step="any"
              aria-label="To value"
              value={current.values[1]}
              disabled={readOnly}
              on:change={event => setValue(current, 'end', event.currentTarget.value)}
            />
          {/if}
        </div>
      {:else if current.startMs !== undefined}
        <div class="text-muted-foreground">{when(current)}</div>
      {/if}
      {#if (current.kind === 'time' || current.kind === 'value') && !readOnly}
        <label class="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={current.kind === 'time' ? current.endMs !== undefined : current.values?.length === 2}
            on:change={event => toggleRange(current, event.currentTarget.checked)}
          />
          A range
        </label>
      {/if}

      <!-- Kept on every keystroke: leaving right after typing loses nothing. -->
      <textarea
        bind:this={descriptionInput}
        class="st-input"
        rows={Math.min(12, Math.max(4, current.description.split('\n').length + 1))}
        placeholder={readOnly ? 'No explanation' : 'What does it show? (optional)'}
        aria-label="Explanation"
        value={current.description}
        disabled={readOnly}
        on:input={event => updateAnnotation(current.key, { description: event.currentTarget.value })}
      />
      {#if !readOnly}
        <label class="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="color"
            aria-label="Color"
            value={current.color}
            on:change={event => updateAnnotation(current.key, { color: event.currentTarget.value })}
          />
          Color
        </label>
      {/if}
      {#if stale}
        <div class="stale" role="note">{stale}</div>
      {/if}
      {#if current.note}
        <div class="text-muted-foreground">
          {#if current.note.about}
            {current.note.about.kind === 'activity' ? 'Record' : 'Resource'} in {current.note.about.data}{current.note
              .about.key
              ? `, key ${current.note.about.key}`
              : ''}.
          {/if}
          {current.note.createdBy ?? 'Someone'}, {time(Date.parse(current.note.createdAt))}. Kept with this analysis
          only.
        </div>
      {/if}
    {/if}
  {:else}
    <div class="head">
      <span class="font-medium">Annotations ({items.length})</span>
      <span class="grow" />
      {#if !readOnly}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild let:builder>
            <Button builders={[builder]} size="xs" variant="outline"><Plus size={12} class="mr-1" />Add</Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="text-xs">
            <DropdownMenu.Item
              class="text-xs"
              disabled={$timeCursorMs === null}
              on:click={() => $timeCursorMs !== null && addTimeAnnotation($timeCursorMs)}
              >Mark the cursor's time</DropdownMenu.Item
            >
            <DropdownMenu.Item
              class="text-xs"
              disabled={$timeCursorMs === null || $timeCursorCompareMs === null}
              on:click={() =>
                $timeCursorMs !== null &&
                $timeCursorCompareMs !== null &&
                addTimeAnnotation($timeCursorMs, $timeCursorCompareMs)}>Mark the A–B range</DropdownMenu.Item
            >
            <DropdownMenu.Label class="text-[11px] font-normal text-muted-foreground"
              >A value: right-click its row. An activity: Annotate in its details.</DropdownMenu.Label
            >
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
    {#if readOnly && readOnlyReason}
      <div class="text-muted-foreground">{readOnlyReason}</div>
    {/if}
    <ul class="list">
      {#each items as entry (entry.key)}
        <li>
          <button class="entry" style:--color={entry.color} on:click={() => open(entry)}>
            <span class="line">
              <span class="name">{entry.label || 'Unlabeled'}</span>
              <span class="when">{entry.startMs !== undefined ? time(entry.startMs) : ''}</span>
            </span>
            <span class="what"
              >{describeAnnotation(
                entry,
                entry.note?.about ? sourceLabels[entry.note.about.sourceId] : undefined,
              )}{entry.description ? ` · ${entry.description.split('\n')[0]}` : ''}</span
            >
          </button>
        </li>
      {:else}
        <li class="empty">
          Nothing marked yet. Right-click the timeline to mark a time, a row to mark a value, or annotate an activity
          from its details. Each annotation can have a label and an explanation.
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .annotations {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    gap: 8px;
    height: 100%;
    min-height: 0;
    overflow: auto;
    padding: 8px;
  }

  .head {
    align-items: center;
    border-left: 3px solid var(--color, transparent);
    display: flex;
    gap: 6px;
    padding-left: 6px;
  }

  .kind {
    color: var(--st-gray-70);
  }

  .grow {
    flex: 1;
  }

  .label {
    font-weight: 500;
  }

  .subject {
    font-size: 13px;
    font-weight: 500;
  }

  .place {
    align-items: center;
    display: flex;
    gap: 4px;
  }

  .place .st-input {
    flex: 1;
    min-width: 0;
  }

  .stale {
    border-left: 2px solid var(--st-warning-yellow, #e6b300);
    padding-left: 6px;
  }

  .list {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .entry {
    background: none;
    border: 0;
    border-left: 3px solid var(--color);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    padding: 4px 6px;
    text-align: left;
    width: 100%;
  }

  .entry:hover {
    background: var(--st-gray-10);
  }

  .line {
    display: flex;
    gap: 6px;
  }

  .name {
    flex: 1;
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when,
  .what {
    color: var(--st-gray-60);
  }

  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    color: var(--st-gray-60);
  }
</style>
