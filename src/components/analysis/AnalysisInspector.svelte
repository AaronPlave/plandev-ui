<svelte:options immutable={true} />

<!--
  The analysis's one inspector: what is selected, in its own terms. An activity shows its details (an authored
  sequence's step shows in its sequence, the one place a step is inspected); a source, a sequence or an annotation
  shows itself. At Time is a mode beside it (what every source says at the cursor), and the row editor opens here when
  a row is edited, until Done. Back returns to what was shown before.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { ArrowLeft, Crosshair, StickyNote, TextSearch } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    analysisInspector,
    analysisInspectorHistory,
    analysisMaxTimeRange,
    inspect,
    inspectBack,
  } from '../../stores/analysis';
  import { timeCursorMs } from '../../stores/plan';
  import type {
    AnalysisActivityRef,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { getAuthoredSequenceSources } from '../../utilities/analysisSequence';
  import TimelineEditorPanel from '../timeline/form/TimelineEditorPanel.svelte';
  import AnalysisActivityDetails from './AnalysisActivityDetails.svelte';
  import AnalysisAnnotations from './AnalysisAnnotations.svelte';
  import AnalysisAtTimePanel from './AnalysisAtTimePanel.svelte';
  import AnalysisSequencePanel from './AnalysisSequencePanel.svelte';
  import AnalysisSourceDetails from './AnalysisSourceDetails.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let datasets: AnalysisSimulationDataset[] = [];
  export let readOnly: boolean = false;
  export let readOnlyReason: string = '';
  export let revisions: AnalysisSourceRevision[] = [];
  export let selected: AnalysisActivityRef | null = null;
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  type Range = { endMs: number; startMs: number };
  const dispatch = createEventDispatcher<{
    goTo: Range & { ref: AnalysisActivityRef | null };
    reveal: Range;
    select: Range & { inspect?: boolean; ref: AnalysisActivityRef };
    zoom: Range;
  }>();

  $: target = $analysisInspector;
  $: mode = target.kind === 'time' ? 'time' : target.kind === 'editor' ? 'editor' : 'inspect';
  $: authored = getAuthoredSequenceSources(bindings, revisions);
  // An authored sequence's step is inspected in its sequence.
  $: selectedInSequence = selected ? authored.some(({ binding }) => binding.id === selected?.sourceId) : false;
</script>

<div class="inspector">
  <div class="bar">
    {#if mode === 'editor'}
      <span class="flex-1 font-medium">Timeline editor</span>
      <Button
        size="xs"
        variant="outline"
        on:click={() => ($analysisInspectorHistory.length ? inspectBack() : inspect({ kind: 'selection' }))}
        >Done</Button
      >
    {:else}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Back"
        title="Back"
        disabled={!$analysisInspectorHistory.length}
        on:click={() => inspectBack()}><ArrowLeft size={14} /></Button
      >
      <div class="modes" role="group" aria-label="Inspector mode">
        <button
          class:active={mode === 'inspect'}
          aria-pressed={mode === 'inspect'}
          on:click={() => mode !== 'inspect' && inspect({ kind: 'selection' })}><TextSearch size={13} />Inspect</button
        >
        <button
          class:active={mode === 'time'}
          aria-pressed={mode === 'time'}
          title="What every source says at the time cursor (and at B, to compare)"
          on:click={() => inspect({ kind: 'time' })}><Crosshair size={13} />At Time</button
        >
      </div>
      <span class="flex-1" />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Annotations"
        title="All annotations"
        class={target.kind === 'annotations' ? 'bg-accent' : ''}
        on:click={() => inspect({ kind: 'annotations' })}><StickyNote size={14} /></Button
      >
    {/if}
  </div>

  <div class="body">
    {#if target.kind === 'time'}
      <AnalysisAtTimePanel
        {bindings}
        {readOnly}
        {sourceLabels}
        {user}
        on:reveal={({ detail }) => dispatch('reveal', { endMs: detail, startMs: detail })}
        on:selectActivity={({ detail }) => dispatch('select', { ...detail, inspect: false })}
      />
    {:else if target.kind === 'editor'}
      <TimelineEditorPanel gridSection="RightTop" showHeader={false} timeBounds={$analysisMaxTimeRange} />
    {:else if target.kind === 'source'}
      <AnalysisSourceDetails {bindings} {readOnly} sourceId={target.sourceId} {user} />
    {:else if target.kind === 'annotation' || target.kind === 'annotations'}
      <AnalysisAnnotations
        {bindings}
        focusKey={target.kind === 'annotation' ? target.key : null}
        {readOnly}
        {readOnlyReason}
        {sourceLabels}
        on:goTo
      />
    {:else if target.kind === 'sequence' || selectedInSequence}
      <AnalysisSequencePanel
        {bindings}
        {datasets}
        entryId={target.kind === 'sequence' ? target.entryId : undefined}
        {readOnly}
        {revisions}
        {selected}
        sourceId={target.kind === 'sequence' ? target.sourceId : selected?.sourceId}
        {user}
        on:select
      />
    {:else}
      <AnalysisActivityDetails
        {bindings}
        {datasets}
        {readOnly}
        {revisions}
        {selected}
        {sourceLabels}
        {user}
        on:inspectAt={() => {
          inspect({ kind: 'time' });
          dispatch('reveal', { endMs: $timeCursorMs ?? 0, startMs: $timeCursorMs ?? 0 });
        }}
        on:select
        on:zoom
      />
    {/if}
  </div>
</div>

<style>
  .inspector {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: min-content minmax(0, 1fr);
    height: 100%;
  }

  .bar {
    align-items: center;
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    font-size: 12px;
    gap: 4px;
    min-height: 36px;
    padding: 4px 6px;
  }

  .modes {
    background: var(--st-gray-10);
    border-radius: 6px;
    display: flex;
    padding: 2px;
  }

  .modes button {
    align-items: center;
    background: none;
    border: 0;
    border-radius: 4px;
    color: var(--st-gray-70);
    cursor: pointer;
    display: flex;
    font-size: 12px;
    gap: 4px;
    padding: 2px 8px;
  }

  .modes button.active {
    background: white;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    color: var(--st-gray-100);
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }
</style>
