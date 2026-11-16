<svelte:options immutable={true} />

<!--
  The analysis's annotations, one concept whatever they mark: a time or a time range across the rows, a value or a
  value range on a row, a record of a source, or nothing (a finding). The list finds one; opening one (here or on the
  timeline) edits it, with only what its kind of mark has. Marks are drawn by the timeline; a record's by a flag at its
  start.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button, DropdownMenu } from '@nasa-jpl/stellar-svelte';
  import { ChevronLeft, Ellipsis, Link, Plus, Trash2 } from 'lucide-svelte';
  import { createEventDispatcher, tick } from 'svelte';
  import {
    addGeneralAnnotation,
    addTimeAnnotation,
    addValueAnnotation,
    analysis,
    analysisAnnotations,
    annotateActivity,
    inspect,
    removeAnnotation,
    selectedAnalysisActivity,
    updateAnnotation,
  } from '../../stores/analysis';
  import { timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import { selectedRow, viewSetSelectedRow } from '../../stores/views';
  import type { AnalysisActivityRef, AnalysisSourceBinding } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { Annotation, AnnotationAnchor } from '../../types/timeline';
  import {
    ANNOTATION_COLOR,
    canBeReusable,
    describeAnchor,
    getAnnotationTimes,
    getStaleReason,
    sortAnnotations,
  } from '../../utilities/analysisAnnotations';
  import { formatDate, getDoyTime, getUnixEpochTime } from '../../utilities/time';
  import { showFailureToast, showSuccessToast } from '../../utilities/toast';
  import Collapse from '../Collapse.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  /** The annotation open to edit; null for the list. */
  export let focusId: number | null = null;
  export let readOnly: boolean = false;
  export let readOnlyReason: string = '';
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    goTo: { endMs: number; ref: AnalysisActivityRef | null; startMs: number };
  }>();

  let titleInput: HTMLInputElement;
  let lastFocused: number | null = null;

  $: annotations = sortAnnotations($analysisAnnotations);
  $: current = focusId !== null ? annotations.find(({ id }) => id === focusId) : undefined;
  $: stale = current ? getStaleReason(current, bindings) : null;
  // A new annotation opens on its title: what to say first.
  $: if (focusId !== lastFocused) {
    lastFocused = focusId;
    if (current && !readOnly && !current.description) {
      tick().then(() => setTimeout(() => titleInput?.select(), 50));
    }
  }

  function sourceLabelOf(of: Annotation): string | undefined {
    return of.anchor.kind === 'record' ? sourceLabels[of.anchor.record.sourceId] : undefined;
  }

  function goTo(of: Annotation) {
    const { anchor } = of;
    if (anchor.kind === 'value') {
      if (anchor.rowId !== null) {
        viewSetSelectedRow(anchor.rowId);
      }
      return;
    }
    const { endMs, startMs } = getAnnotationTimes(of);
    if (startMs === undefined) {
      return;
    }
    const record = anchor.kind === 'record' ? anchor.record : null;
    dispatch('goTo', {
      endMs: endMs ?? startMs,
      ref:
        record?.kind === 'activity' && record.activityId !== undefined && !stale
          ? { activityId: record.activityId, sourceId: record.sourceId }
          : null,
      startMs,
    });
  }

  function open(of: Annotation) {
    inspect({ id: of.id, kind: 'annotation' });
    goTo(of);
  }

  async function copyLink(of: Annotation) {
    const url = new URL(`${base}/analyses/${$analysis?.id}`, location.origin);
    url.searchParams.set('annotation', `${of.id}`);
    const { endMs, startMs } = getAnnotationTimes(of);
    if (startMs !== undefined) {
      const end = endMs ?? startMs;
      const pad = Math.max((end - startMs) * 0.25, 30 * 60_000);
      url.searchParams.set('start', `${Math.round(startMs - pad)}`);
      url.searchParams.set('end', `${Math.round(end + pad)}`);
      url.searchParams.set('cursor', `${Math.round(startMs)}`);
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

  function setAnchor(of: Annotation, anchor: AnnotationAnchor) {
    updateAnnotation(of.id, { anchor });
  }

  function setTime(of: Annotation, field: 'end' | 'start', text: string) {
    if (of.anchor.kind !== 'time') {
      return;
    }
    if (!getUnixEpochTime(text.trim())) {
      showFailureToast('Write The Time As YYYY-DDDThh:mm:ss');
      return;
    }
    setAnchor(of, { ...of.anchor, [field]: text.trim() });
  }

  function setValue(of: Annotation, field: 'y' | 'y2', text: string) {
    const value = Number(text);
    if (of.anchor.kind !== 'value' || text.trim() === '' || !Number.isFinite(value)) {
      showFailureToast('The Value Must Be A Number');
      return;
    }
    setAnchor(of, { ...of.anchor, [field]: value });
  }

  function toggleRange(of: Annotation, range: boolean) {
    const { anchor } = of;
    if (anchor.kind === 'time') {
      const { end: _, ...single } = anchor;
      // The other cursor when there is one, else an hour on.
      const startMs = getUnixEpochTime(anchor.start);
      const other = [$timeCursorMs, $timeCursorCompareMs].find(ms => ms !== null && ms !== startMs);
      setAnchor(of, range ? { ...anchor, end: getDoyTime(new Date(other ?? startMs + 3_600_000)) } : single);
    } else if (anchor.kind === 'value') {
      const { y2: _, ...single } = anchor;
      setAnchor(of, range ? { ...anchor, y2: anchor.y + Math.max(Math.abs(anchor.y) * 0.1, 1) } : single);
    }
  }

  function annotateSelection() {
    if ($selectedAnalysisActivity) {
      annotateActivity($selectedAnalysisActivity, user);
    }
  }
</script>

<div class="annotations">
  {#if focusId !== null}
    <div class="bar">
      <Button size="xs" variant="ghost" class="h-6 gap-0.5 px-1" on:click={() => inspect({ kind: 'annotations' })}
        ><ChevronLeft size={13} />All annotations</Button
      >
    </div>
    {#if !current}
      <div class="empty">This annotation is no longer in the analysis.</div>
    {:else}
      {@const of = current}
      {@const anchor = of.anchor}
      <div class="head" style:--color={of.color ?? ANNOTATION_COLOR}>
        <span class="kind">{describeAnchor(of, sourceLabelOf(of))}</span>
        <span class="grow" />
        {#if anchor.kind !== 'general' && !(anchor.kind === 'value' && anchor.rowId === null)}
          <Button size="xs" variant="outline" on:click={() => goTo(of)}>Go to</Button>
        {/if}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild let:builder>
            <Button builders={[builder]} size="icon-sm" variant="ghost" aria-label="Annotation actions">
              <Ellipsis size={14} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="text-xs">
            <DropdownMenu.Item class="gap-2 text-xs" on:click={() => copyLink(of)}>
              <Link size={12} />Copy link
            </DropdownMenu.Item>
            {#if !readOnly}
              <DropdownMenu.Separator />
              <DropdownMenu.Item class="gap-2 text-xs text-red-700" on:click={() => removeAnnotation(of.id)}>
                <Trash2 size={12} />Delete
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      <label class="field">
        <span>Title</span>
        <input
          bind:this={titleInput}
          class="st-input w-full"
          value={of.label}
          placeholder="Title"
          disabled={readOnly}
          on:input={event => updateAnnotation(of.id, { label: event.currentTarget.value })}
        />
      </label>

      {#if anchor.kind === 'time'}
        <div class="pair">
          <label class="field">
            <span>{anchor.end ? 'From' : 'Time'}</span>
            <input
              class="st-input w-full"
              value={anchor.start}
              disabled={readOnly}
              on:change={event => setTime(of, 'start', event.currentTarget.value)}
            />
          </label>
          {#if anchor.end}
            <label class="field">
              <span>To</span>
              <input
                class="st-input w-full"
                value={anchor.end}
                disabled={readOnly}
                on:change={event => setTime(of, 'end', event.currentTarget.value)}
              />
            </label>
          {/if}
        </div>
      {:else if anchor.kind === 'value'}
        {#if anchor.rowId === null}
          <div class="stale" role="note">
            Its row ({anchor.rowName ?? 'unnamed'}) is no longer on the timeline. It keeps what it marked.
          </div>
        {/if}
        <div class="pair">
          <label class="field">
            <span>{anchor.y2 !== undefined ? 'From' : 'Value'}{anchor.units ? ` (${anchor.units})` : ''}</span>
            <input
              class="st-input w-full"
              type="number"
              step="any"
              value={anchor.y}
              disabled={readOnly || anchor.rowId === null}
              on:change={event => setValue(of, 'y', event.currentTarget.value)}
            />
          </label>
          {#if anchor.y2 !== undefined}
            <label class="field">
              <span>To{anchor.units ? ` (${anchor.units})` : ''}</span>
              <input
                class="st-input w-full"
                type="number"
                step="any"
                value={anchor.y2}
                disabled={readOnly || anchor.rowId === null}
                on:change={event => setValue(of, 'y2', event.currentTarget.value)}
              />
            </label>
          {/if}
        </div>
      {:else if anchor.kind === 'record'}
        <div class="record">
          <span class="font-medium">{anchor.record.name}</span>
          {#if anchor.start}<span class="text-muted-foreground"> · {time(Date.parse(anchor.start))}</span>{/if}
        </div>
        {#if stale}
          <div class="stale" role="note">{stale}</div>
        {/if}
      {/if}
      {#if (anchor.kind === 'time' || (anchor.kind === 'value' && anchor.rowId !== null)) && !readOnly}
        <label class="check">
          <input
            type="checkbox"
            checked={anchor.kind === 'time' ? !!anchor.end : anchor.y2 !== undefined}
            on:change={event => toggleRange(of, event.currentTarget.checked)}
          />
          Range
        </label>
      {/if}

      <label class="field">
        <span>Description</span>
        <!-- Kept on every keystroke: leaving right after typing loses nothing. -->
        <textarea
          class="st-input w-full"
          rows={Math.min(12, Math.max(4, (of.description ?? '').split('\n').length + 1))}
          placeholder={readOnly ? 'No description' : 'What does it show? (optional)'}
          value={of.description ?? ''}
          disabled={readOnly}
          on:input={event => updateAnnotation(of.id, { description: event.currentTarget.value || undefined })}
        />
      </label>

      {#if !readOnly}
        <div class="row">
          <label class="check">
            <input
              type="color"
              aria-label="Color"
              value={of.color ?? ANNOTATION_COLOR}
              on:change={event => updateAnnotation(of.id, { color: event.currentTarget.value })}
            />
            Color
          </label>
          {#if canBeReusable(of)}
            <label
              class="check"
              title="Saved with this analysis's layout and brought when the layout is used in another analysis (a limit, a reference mark). Otherwise it stays with this analysis."
            >
              <input
                type="checkbox"
                checked={!!of.reusable}
                on:change={event => updateAnnotation(of.id, { reusable: event.currentTarget.checked || undefined })}
              />
              Part of the layout
            </label>
          {/if}
        </div>
      {/if}

      <Collapse title="Details" defaultExpanded={false} padContent={false}>
        <dl>
          {#if anchor.kind === 'record'}
            <dt>Data</dt>
            <dd>{anchor.record.data}</dd>
            {#if anchor.record.key}
              <dt>Key</dt>
              <dd>{anchor.record.key}</dd>
            {/if}
          {/if}
          <dt>Made</dt>
          <dd>{of.createdBy ?? 'Someone'}{of.createdAt ? `, ${time(Date.parse(of.createdAt))}` : ''}</dd>
          {#if of.updatedAt}
            <dt>Changed</dt>
            <dd>{time(Date.parse(of.updatedAt))}</dd>
          {/if}
          <dt>Kept</dt>
          <dd>{of.reusable ? 'With this analysis and its saved layouts' : 'With this analysis only'}</dd>
        </dl>
      </Collapse>
    {/if}
  {:else}
    <div class="head">
      <span class="font-medium">Annotations ({annotations.length})</span>
      <span class="grow" />
      {#if !readOnly}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild let:builder>
            <Button builders={[builder]} size="xs" variant="outline" class="gap-1"><Plus size={12} />Add</Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="text-xs">
            <DropdownMenu.Item
              class="text-xs"
              disabled={$timeCursorMs === null}
              on:click={() => $timeCursorMs !== null && addTimeAnnotation($timeCursorMs, undefined, user)}
              >Time at the cursor</DropdownMenu.Item
            >
            <DropdownMenu.Item
              class="text-xs"
              disabled={$timeCursorMs === null || $timeCursorCompareMs === null}
              on:click={() =>
                $timeCursorMs !== null &&
                $timeCursorCompareMs !== null &&
                addTimeAnnotation($timeCursorMs, $timeCursorCompareMs, user)}>Range from A to B</DropdownMenu.Item
            >
            <DropdownMenu.Item
              class="text-xs"
              disabled={!$selectedRow?.yAxes.length}
              on:click={() => $selectedRow && addValueAnnotation($selectedRow.id, user)}
              >Value on the selected row{$selectedRow ? ` (${$selectedRow.name})` : ''}</DropdownMenu.Item
            >
            <DropdownMenu.Item class="text-xs" disabled={!$selectedAnalysisActivity} on:click={annotateSelection}
              >The selected record</DropdownMenu.Item
            >
            <DropdownMenu.Item class="text-xs" on:click={() => addGeneralAnnotation(user)}>A finding</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
    {#if readOnly && readOnlyReason}
      <div class="text-muted-foreground">{readOnlyReason}</div>
    {/if}
    <ul class="list">
      {#each annotations as entry (entry.id)}
        {@const times = getAnnotationTimes(entry)}
        <li>
          <button class="entry" style:--color={entry.color ?? ANNOTATION_COLOR} on:click={() => open(entry)}>
            <span class="line">
              <span class="name">{entry.label || 'Untitled'}</span>
              {#if entry.reusable}<span class="tag" title="Part of the layout">Layout</span>{/if}
              <span class="when">{times.startMs !== undefined ? time(times.startMs) : ''}</span>
            </span>
            <span class="what"
              >{describeAnchor(entry, sourceLabelOf(entry))}{entry.description
                ? ` · ${entry.description.split('\n')[0]}`
                : ''}</span
            >
          </button>
        </li>
      {:else}
        <li class="empty">
          Nothing marked yet. Add one here, right-click the timeline to mark a time or a row's value, or annotate a
          record from Inspect.
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

  .bar {
    margin: -4px 0 -4px -4px;
  }

  .head {
    align-items: center;
    border-left: 3px solid var(--color, transparent);
    display: flex;
    gap: 6px;
    min-height: 24px;
    padding-left: 6px;
  }

  .kind {
    color: var(--st-gray-70);
  }

  .grow {
    flex: 1;
  }

  .field {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .field > span {
    color: var(--st-gray-60);
  }

  .pair,
  .row {
    display: flex;
    gap: 8px;
  }

  .check {
    align-items: center;
    display: flex;
    gap: 6px;
  }

  .record {
    word-break: break-word;
  }

  .stale {
    border-left: 2px solid var(--st-warning-yellow, #e6b300);
    padding-left: 6px;
  }

  dl {
    display: grid;
    gap: 3px 8px;
    grid-template-columns: max-content minmax(0, 1fr);
    margin: 0;
    padding: 4px 8px 8px;
  }

  dt {
    color: var(--st-gray-60);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
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
    align-items: center;
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

  .tag {
    background: var(--st-gray-15);
    border-radius: 3px;
    color: var(--st-gray-70);
    font-size: 10px;
    padding: 0 4px;
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
