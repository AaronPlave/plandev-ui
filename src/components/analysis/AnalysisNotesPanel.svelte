<svelte:options immutable={true} />

<!--
  The analysis's notes: findings a person wrote about its data. Each has a time or an interval, an explanation, and
  optionally the activity it is about, with the data it was written against. A note is drawn on the timeline as a
  marker (or a shaded interval) and saved with the analysis; it is not part of the presentation, so it never travels
  when the presentation is applied to another analysis. A note about data its source no longer reads says so, and is
  never pointed at the new data.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { Trash2 } from 'lucide-svelte';
  import { createEventDispatcher, tick } from 'svelte';
  import {
    addAnalysisAnnotation,
    analysisAnnotations,
    focusedAnnotationId,
    removeAnalysisAnnotation,
    updateAnalysisAnnotation,
  } from '../../stores/analysis';
  import { timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import type { AnalysisActivityRef, AnalysisAnnotation, AnalysisSourceBinding } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { getSourceIdentity } from '../../utilities/analysis';
  import { ANNOTATION_COLOR } from '../../utilities/analysisAnnotations';
  import { formatDate } from '../../utilities/time';

  export let bindings: AnalysisSourceBinding[] = [];
  export let readOnly: boolean = false;
  export let readOnlyReason: string = '';
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    goTo: { endMs: number; ref: AnalysisActivityRef | null; startMs: number };
  }>();

  let list: HTMLElement;

  $: notes = [...$analysisAnnotations].sort((a, b) => a.start.localeCompare(b.start));
  $: focus($focusedAnnotationId);

  async function focus(id: number | null) {
    if (id === null) {
      return;
    }
    await tick();
    const element = list?.querySelector<HTMLElement>(`[data-note="${id}"]`);
    element?.scrollIntoView({ block: 'nearest' });
    // A new note starts empty: its text is what to write next.
    if (!$analysisAnnotations.find(note => note.id === id)?.text) {
      element?.querySelector('textarea')?.focus();
    }
  }

  /** Why a note's subject can't be opened as it was written, or null when it can. */
  function getStaleReason(note: AnalysisAnnotation): string | null {
    if (!note.about) {
      return null;
    }
    const binding = bindings.find(({ id }) => id === note.about?.sourceId);
    if (!binding) {
      return `Written about ${note.about.sourceLabel}, which is no longer in this analysis.`;
    }
    return getSourceIdentity(binding) === note.about.data
      ? null
      : `Written about ${note.about.sourceLabel} when it read other data (${note.about.data}). It now reads ${getSourceIdentity(binding)}; this note has not been checked against it.`;
  }

  function goTo(note: AnalysisAnnotation) {
    const startMs = Date.parse(note.start);
    const { about } = note;
    $focusedAnnotationId = note.id;
    dispatch('goTo', {
      endMs: note.end ? Date.parse(note.end) : startMs,
      ref:
        about?.kind === 'activity' && about.activityId !== undefined && !getStaleReason(note)
          ? { activityId: about.activityId, sourceId: about.sourceId }
          : null,
      startMs,
    });
  }

  function addAt(startMs: number, endMs?: number) {
    addAnalysisAnnotation(
      {
        end: endMs === undefined ? undefined : new Date(Math.max(startMs, endMs)).toISOString(),
        start: new Date(endMs === undefined ? startMs : Math.min(startMs, endMs)).toISOString(),
        text: '',
      },
      user,
    );
  }

  function time(iso: string): string {
    return formatDate(new Date(iso), $plugins.time.primary.format);
  }
</script>

<div class="notes">
  {#if readOnly}
    <div class="add read-only" role="note">{readOnlyReason}</div>
  {:else}
    <div class="add">
      <Button
        size="xs"
        variant="outline"
        disabled={$timeCursorMs === null}
        title={$timeCursorMs === null
          ? 'Place the time cursor on the timeline first'
          : 'Add a note at the time cursor'}
        on:click={() => $timeCursorMs !== null && addAt($timeCursorMs)}>Note at cursor</Button
      >
      <Button
        size="xs"
        variant="outline"
        disabled={$timeCursorMs === null || $timeCursorCompareMs === null}
        title={$timeCursorMs === null || $timeCursorCompareMs === null
          ? 'Place both time cursors (A and B) on the timeline first'
          : 'Add a note on the interval between the two time cursors'}
        on:click={() =>
          $timeCursorMs !== null && $timeCursorCompareMs !== null && addAt($timeCursorMs, $timeCursorCompareMs)}
        >Note on A–B interval</Button
      >
    </div>
  {/if}
  <div class="list" bind:this={list}>
    {#each notes as note (note.id)}
      {@const stale = getStaleReason(note)}
      <article class="note" class:focused={$focusedAnnotationId === note.id} data-note={note.id}>
        <header>
          <input
            type="color"
            aria-label="Note color"
            title="Color of the note's marker on the timeline"
            value={note.color ?? ANNOTATION_COLOR}
            disabled={readOnly}
            on:change={event => updateAnalysisAnnotation(note.id, { color: event.currentTarget.value })}
          />
          <button class="when" title="Show this on the timeline" on:click={() => goTo(note)}>
            {time(note.start)}{note.end ? ` – ${time(note.end)}` : ''}
          </button>
          {#if !readOnly}
            <button class="remove" aria-label="Delete note" title="Delete note" on:click={() => removeAnalysisAnnotation(note.id)}>
              <Trash2 size={12} />
            </button>
          {/if}
        </header>
        {#if note.about}
          <div class="about">
            About {note.about.kind === 'activity' ? 'activity' : 'resource'}
            <strong>{note.about.name}</strong>{note.about.key ? ` (${note.about.key})` : ''} in
            {sourceLabels[note.about.sourceId] ?? note.about.sourceLabel}
          </div>
        {/if}
        {#if stale}
          <div class="stale" role="note">{stale}</div>
        {/if}
        <textarea
          class="st-input"
          rows={Math.min(10, Math.max(2, note.text.split('\n').length))}
          placeholder="What does this show?"
          aria-label="Note text"
          value={note.text}
          disabled={readOnly}
          on:change={event => updateAnalysisAnnotation(note.id, { text: event.currentTarget.value })}
        />
        {#if note.createdBy}
          <div class="by">{note.createdBy}, {note.createdAt.slice(0, 16).replace('T', ' ')} UTC</div>
        {/if}
      </article>
    {:else}
      <div class="empty st-typography-label">
        No notes yet. Mark a time with the cursor, an interval with cursors A and B, or use Note on a selected
        activity, and say what it shows. Notes are saved with this analysis.
      </div>
    {/each}
  </div>
</div>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    height: 100%;
    min-height: 0;
  }

  .add {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
  }

  .list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow: auto;
    padding: 8px;
  }

  .note {
    border: 1px solid var(--st-gray-20);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
  }

  .note.focused {
    border-color: var(--st-utility-blue);
  }

  header {
    align-items: center;
    display: flex;
    gap: 6px;
  }

  input[type='color'] {
    background: none;
    border: 0;
    flex: none;
    height: 16px;
    padding: 0;
    width: 16px;
  }

  .when {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    flex: 1;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .remove {
    background: none;
    border: 0;
    color: var(--st-gray-60);
    cursor: pointer;
    padding: 0;
  }

  textarea {
    font: inherit;
    height: auto;
    padding: 4px;
    resize: vertical;
    width: 100%;
  }

  .stale {
    border-left: 2px solid var(--st-warning-yellow, #e6b300);
    padding-left: 6px;
  }

  .read-only,
  .about,
  .by,
  .empty {
    color: var(--st-gray-60);
  }
</style>
