<svelte:options immutable={true} />

<!--
  The analysis's notes: findings a person wrote about its data. A note explains a time, an interval, a record, a
  resource, or a guide on the timeline (a marked time or time range, a value or value range). The guide is the mark
  across the rows and belongs to the layout; the note is what it means and belongs to this analysis, so it never
  travels when the layout is used elsewhere. A note about data its source no longer reads says so, and is never
  pointed at the new data.

  The list is for scanning: each note is its text and one line of what it is about. Selecting a note goes to it;
  editing is a deliberate step, and every keystroke is kept.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button, DropdownMenu } from '@nasa-jpl/stellar-svelte';
  import { Ellipsis, Link, Pencil, Trash2 } from 'lucide-svelte';
  import { createEventDispatcher, tick } from 'svelte';
  import {
    addAnalysisAnnotation,
    analysis,
    analysisAnnotations,
    explainGuide,
    focusedAnnotationId,
    markInterval,
    removeAnalysisAnnotation,
    updateAnalysisAnnotation,
  } from '../../stores/analysis';
  import { timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import { view, viewSetSelectedRow } from '../../stores/views';
  import type { AnalysisActivityRef, AnalysisAnnotation, AnalysisSourceBinding } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { getSourceIdentity } from '../../utilities/analysis';
  import { ANNOTATION_COLOR, describeNoteSubject } from '../../utilities/analysisAnnotations';
  import { formatDate } from '../../utilities/time';
  import { showFailureToast, showSuccessToast } from '../../utilities/toast';

  export let bindings: AnalysisSourceBinding[] = [];
  export let readOnly: boolean = false;
  export let readOnlyReason: string = '';
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    goTo: { endMs: number; ref: AnalysisActivityRef | null; startMs: number };
  }>();

  let editingId: number | null = null;
  let list: HTMLElement;

  $: notes = [...$analysisAnnotations].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  $: timeline = $view?.definition.plan.timelines[0];
  $: guides = [
    ...(timeline?.verticalGuides ?? []).map(guide => ({
      id: guide.id,
      label: `${guide.label.text || 'Unnamed'} · ${guide.timestamp2 ? 'time range' : 'time'}`,
      rowId: undefined,
    })),
    ...(timeline?.rows ?? []).flatMap(row =>
      row.horizontalGuides.map(guide => ({
        id: guide.id,
        label: `${guide.label.text || 'Unnamed'} · ${row.name} ${guide.y2 === undefined ? guide.y : `${guide.y}–${guide.y2}`}`,
        rowId: row.id,
      })),
    ),
  ];
  $: focus($focusedAnnotationId);

  async function focus(id: number | null) {
    if (id === null) {
      return;
    }
    // A new note starts empty: its text is what to write next.
    if (!readOnly && !$analysisAnnotations.find(note => note.id === id)?.text) {
      editingId = id;
    }
    await tick();
    const element = list?.querySelector<HTMLElement>(`[data-note="${id}"]`);
    element?.scrollIntoView({ block: 'nearest' });
    // After a menu that opened this has put focus back on its trigger.
    setTimeout(() => element?.querySelector('textarea')?.focus(), 80);
  }

  /** Why a note's subject can't be opened as it was written, or null when it can. */
  function getStaleReason(note: AnalysisAnnotation): string | null {
    if (!note.about) {
      return null;
    }
    const binding = bindings.find(({ id }) => id === note.about?.sourceId);
    if (!binding) {
      return `${note.about.sourceLabel} is no longer in this analysis.`;
    }
    return getSourceIdentity(binding) === note.about.data
      ? null
      : `Written when ${note.about.sourceLabel} read ${note.about.data}; it now reads ${getSourceIdentity(binding)}. Not checked against it.`;
  }

  function goTo(note: AnalysisAnnotation) {
    $focusedAnnotationId = note.id;
    if (note.guide?.kind === 'value' && note.guide.id !== undefined) {
      viewSetSelectedRow(note.guide.row?.id ?? null);
      return;
    }
    if (!note.start) {
      return;
    }
    const startMs = Date.parse(note.start);
    const { about } = note;
    dispatch('goTo', {
      endMs: note.end ? Date.parse(note.end) : startMs,
      ref:
        about?.kind === 'activity' && about.activityId !== undefined && !getStaleReason(note)
          ? { activityId: about.activityId, sourceId: about.sourceId }
          : null,
      startMs,
    });
  }

  function addAt(startMs: number) {
    addAnalysisAnnotation({ start: new Date(startMs).toISOString(), text: '' }, user);
  }

  async function copyLink(note: AnalysisAnnotation) {
    const url = new URL(`${base}/analyses/${$analysis?.id}`, location.origin);
    url.searchParams.set('note', `${note.id}`);
    if (note.start) {
      const startMs = Date.parse(note.start);
      const endMs = note.end ? Date.parse(note.end) : startMs;
      const pad = Math.max((endMs - startMs) * 0.25, 30 * 60_000);
      url.searchParams.set('start', `${Math.round(startMs - pad)}`);
      url.searchParams.set('end', `${Math.round(endMs + pad)}`);
      url.searchParams.set('cursor', `${Math.round(startMs)}`);
    }
    try {
      await navigator.clipboard.writeText(url.toString());
      showSuccessToast('Copied a link to this note');
    } catch {
      showFailureToast('Could Not Copy The Link');
    }
  }

  function time(iso: string): string {
    return formatDate(new Date(iso), $plugins.time.primary.format);
  }

  function when(note: AnalysisAnnotation): string {
    if (!note.start) {
      return '';
    }
    return note.end ? `${time(note.start)} – ${time(note.end)}` : time(note.start);
  }

  function startEdit(id: number) {
    editingId = id;
    focus(id);
  }
</script>

<div class="notes">
  {#if readOnly}
    <div class="add read-only" role="note">{readOnlyReason} Notes stay readable and their text can be copied.</div>
  {:else}
    <div class="add">
      <Button
        size="xs"
        variant="outline"
        disabled={$timeCursorMs === null}
        title={$timeCursorMs === null
          ? 'Click the timeline to place the time cursor first'
          : 'A note at the time cursor'}
        on:click={() => $timeCursorMs !== null && addAt($timeCursorMs)}>Note at cursor</Button
      >
      <Button
        size="xs"
        variant="outline"
        disabled={$timeCursorMs === null || $timeCursorCompareMs === null}
        title={$timeCursorMs === null || $timeCursorCompareMs === null
          ? 'Place both time cursors (A and B) first'
          : 'Shade the A–B interval across the rows with a time guide, and explain it'}
        on:click={() =>
          $timeCursorMs !== null &&
          $timeCursorCompareMs !== null &&
          markInterval($timeCursorMs, $timeCursorCompareMs, user)}>Mark A–B</Button
      >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild let:builder>
          <Button
            builders={[builder]}
            size="xs"
            variant="outline"
            disabled={!guides.length}
            title={guides.length
              ? 'Explain a time or value guide already on the timeline'
              : 'No guides yet: place one from the timeline (right-click) or the Timeline Editor'}
            >Explain a guide…</Button
          >
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="max-h-[320px] overflow-auto">
          {#each guides as guide (`${guide.rowId ?? 't'}:${guide.id}`)}
            <DropdownMenu.Item
              class="text-xs"
              on:click={() => explainGuide({ id: guide.id, rowId: guide.rowId }, user)}
            >
              {guide.label}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  {/if}
  <div class="list" bind:this={list}>
    {#each notes as note (note.id)}
      {@const stale = getStaleReason(note)}
      {@const subject = describeNoteSubject(note, note.about ? sourceLabels[note.about.sourceId] : undefined)}
      {@const editing = editingId === note.id && !readOnly}
      <article
        class="note"
        class:focused={$focusedAnnotationId === note.id}
        data-note={note.id}
        style:--note-color={note.color ?? ANNOTATION_COLOR}
      >
        {#if editing}
          <!-- Kept on every keystroke: closing or leaving the page right after typing loses nothing. -->
          <textarea
            class="st-input"
            rows={Math.min(10, Math.max(3, note.text.split('\n').length + 1))}
            placeholder={note.guide ? 'What does this mark mean?' : 'What does this show?'}
            aria-label="Note text"
            value={note.text}
            on:input={event => updateAnalysisAnnotation(note.id, { text: event.currentTarget.value })}
            on:blur={() => (editingId = null)}
            on:keydown={event => event.key === 'Escape' && (editingId = null)}
          />
        {:else}
          <button
            class="body"
            title={readOnly ? 'Go to this note' : 'Go to this note; double-click to edit'}
            on:click={() => goTo(note)}
            on:dblclick={() => !readOnly && startEdit(note.id)}
          >
            <span class="text" class:untitled={!note.text}>{note.text || 'No text yet'}</span>
          </button>
        {/if}
        <div class="meta">
          {#if subject}<span class="subject" title={subject}>{subject}</span>{/if}
          {#if when(note)}<span class="when">{when(note)}</span>{/if}
          <span class="grow" />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild let:builder>
              <Button builders={[builder]} size="icon" variant="ghost" class="h-5 w-5" aria-label="Note actions">
                <Ellipsis size={12} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="text-xs">
              {#if !readOnly}
                <DropdownMenu.Item class="gap-2 text-xs" on:click={() => startEdit(note.id)}>
                  <Pencil size={12} />Edit text
                </DropdownMenu.Item>
              {/if}
              <DropdownMenu.Item class="gap-2 text-xs" on:click={() => copyLink(note)}>
                <Link size={12} />Copy link to this note
              </DropdownMenu.Item>
              {#if !readOnly}
                <label class="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="color"
                    aria-label="Note color"
                    value={note.color ?? ANNOTATION_COLOR}
                    on:change={event => updateAnalysisAnnotation(note.id, { color: event.currentTarget.value })}
                  />
                  Flag color
                </label>
                <DropdownMenu.Item
                  class="gap-2 text-xs text-red-700"
                  on:click={() => removeAnalysisAnnotation(note.id)}
                >
                  <Trash2 size={12} />Delete note{note.guide?.id !== undefined ? ' (the guide stays)' : ''}
                </DropdownMenu.Item>
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        {#if stale}
          <div class="stale" role="note">{stale}</div>
        {/if}
        {#if $focusedAnnotationId === note.id}
          <div class="provenance">
            {#if note.about}
              {note.about.kind === 'activity' ? 'Record' : 'Resource'} in {note.about.data}{note.about.key
                ? `, key ${note.about.key}`
                : ''}.
            {/if}
            {note.createdBy ?? 'Someone'}, {time(note.createdAt)}
          </div>
        {/if}
      </article>
    {:else}
      <div class="empty st-typography-label">
        No notes yet. Mark a time or a range with a guide (right-click the timeline), then explain it here; or add a
        note at the cursor, or on a selected activity. Notes stay with this analysis.
      </div>
    {/each}
  </div>
</div>

<style>
  .notes {
    min-width: 0;
    overflow: hidden;
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
    min-height: 0;
    overflow: auto;
    padding: 4px 0;
  }

  .note {
    min-width: 0;
    border-left: 3px solid var(--note-color);
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 8px;
    padding: 4px 6px;
  }

  .note + .note {
    border-top: 1px solid var(--st-gray-15, #f0f0f0);
  }

  .note.focused {
    background: var(--st-gray-10);
  }

  .body {
    min-width: 0;
    overflow-wrap: anywhere;
    width: 100%;
    background: none;
    border: 0;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
    user-select: text;
  }

  .text {
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    display: -webkit-box;
    overflow: hidden;
    white-space: pre-wrap;
  }

  .focused .text {
    -webkit-line-clamp: unset;
  }

  .untitled {
    color: var(--st-gray-50);
    font-style: italic;
  }

  .meta {
    align-items: center;
    color: var(--st-gray-60);
    display: flex;
    font-size: 11px;
    gap: 6px;
    min-width: 0;
  }

  .subject {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .grow {
    flex: 1;
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
    font-size: 11px;
    padding-left: 6px;
  }

  .provenance {
    color: var(--st-gray-60);
    font-size: 11px;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .read-only,
  .empty {
    color: var(--st-gray-60);
  }

  .empty {
    padding: 8px;
  }
</style>
