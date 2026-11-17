<svelte:options immutable={true} />

<!--
  The analysis's inspector, in four tabs. Inspect shows what is selected or followed to, in its own terms: a record (an
  authored sequence's step shows in its sequence), a source, a sequence, a row of the Sources tree; a compact trail
  returns along what was followed. At Time
  is what every source says at the cursor; Annotations lists them and edits the one opened; the Timeline Editor edits
  the selected row.
-->
<script lang="ts">
  import { Tabs } from '@nasa-jpl/stellar-svelte';
  import { ChevronRight } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    analysisAnnotationFocus,
    analysisInspector,
    analysisInspectorHistory,
    analysisInspectorTab,
    analysisMaxTimeRange,
    analysisRecordLabels,
    analysisTimelineSources,
    inspect,
    inspectReturnTo,
    type AnalysisInspectState,
    type AnalysisInspectorTab,
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
  import AnalysisNodeDetails from './AnalysisNodeDetails.svelte';
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

  const tabs: { label: string; title: string; value: AnalysisInspectorTab }[] = [
    { label: 'Inspect', title: 'What is selected: a record, a source, a sequence', value: 'inspect' },
    { label: 'At Time', title: 'What every source says at the time cursor (and B)', value: 'time' },
    { label: 'Annotations', title: 'Marks and findings on this analysis', value: 'annotations' },
    { label: 'Timeline Editor', title: 'Edit the selected row', value: 'editor' },
  ];

  $: target = $analysisInspector;
  $: tab = $analysisInspectorTab;
  $: authored = getAuthoredSequenceSources(bindings, revisions);
  // An authored sequence's step is inspected in its sequence.
  $: selectedInSequence = selected ? authored.some(({ binding }) => binding.id === selected?.sourceId) : false;
  // Where Inspect has been since the last pick in Sources: a trail of what was followed, not a hierarchy.
  $: trail = $analysisInspectorHistory.map(place => describe(place, $analysisRecordLabels));
  $: current = describe({ selected, target }, $analysisRecordLabels);
  $: isSimulationsGroup = target.kind === 'node' && target.nodeId === `${target.sourceId}/simulations`;

  function describe({ selected: ref, target: of }: AnalysisInspectState, labels: Record<string, string>): string {
    switch (of.kind) {
      case 'source':
        return sourceLabels[of.sourceId] ?? 'Source';
      case 'sequence':
        return `${sourceLabels[of.sourceId] ?? 'Sequence'}${of.entryId ? ' › step' : ''}`;
      case 'node':
        return of.nodeId.endsWith('/simulations')
          ? 'Simulations'
          : (findLabel(
              $analysisTimelineSources.sources.find(({ id }) => id === of.sourceId)?.browserNodes ?? [],
              of.nodeId,
            ) ?? 'Item');
    }
    return ref ? (labels[`${ref.sourceId}::${ref.activityId}`] ?? 'Record') : 'Selection';
  }

  function findLabel(nodes: { children?: typeof nodes; id: string; label: string }[], id: string): string | null {
    for (const node of nodes) {
      if (node.id === id) {
        return node.label;
      }
      const found = node.children ? findLabel(node.children, id) : null;
      if (found) {
        return found;
      }
    }
    return null;
  }

  function onTab(value: string | undefined) {
    if (value && value !== tab && (value !== 'editor' || !readOnly)) {
      $analysisInspectorTab = value as AnalysisInspectorTab;
    }
  }
</script>

<div class="inspector">
  <Tabs.Root value={tab} onValueChange={onTab} class="contents">
    <Tabs.List class="tabs" aria-label="Inspector">
      {#each tabs as { label, title, value } (value)}
        <Tabs.Trigger
          {value}
          {title}
          disabled={value === 'editor' && readOnly}
          class="tab h-6 gap-1 border bg-transparent px-1.5 text-xs data-[state=active]:border data-[state=inactive]:border-transparent data-[state=active]:shadow-none"
          >{label}</Tabs.Trigger
        >
      {/each}
    </Tabs.List>
  </Tabs.Root>
  {#if tab === 'inspect' && trail.length}
    <nav class="trail" aria-label="Followed from">
      {#each trail as label, index}
        <button class="crumb" title="Back to {label}" on:click={() => inspectReturnTo(index)}>{label}</button>
        <ChevronRight size={11} class="sep" />
      {/each}
      <span class="crumb current" aria-current="page">{current}</span>
    </nav>
  {/if}

  <div class="body">
    {#if tab === 'time'}
      <AnalysisAtTimePanel
        {bindings}
        {readOnly}
        {sourceLabels}
        {user}
        on:reveal={({ detail }) => dispatch('reveal', { endMs: detail, startMs: detail })}
        on:selectActivity={({ detail }) => dispatch('select', { ...detail, inspect: false })}
      />
    {:else if tab === 'editor'}
      <TimelineEditorPanel gridSection="RightTop" showHeader={false} timeBounds={$analysisMaxTimeRange} />
    {:else if tab === 'annotations'}
      <AnalysisAnnotations
        {bindings}
        focusId={$analysisAnnotationFocus}
        {readOnly}
        {readOnlyReason}
        {sourceLabels}
        {user}
        on:goTo
      />
    {:else if target.kind === 'source' || (target.kind === 'node' && isSimulationsGroup)}
      <AnalysisSourceDetails {bindings} {readOnly} sourceId={target.sourceId} {user} />
    {:else if target.kind === 'node'}
      <AnalysisNodeDetails nodeId={target.nodeId} {readOnly} sourceId={target.sourceId} />
    {:else if target.kind === 'sequence' || selectedInSequence}
      <AnalysisSequencePanel
        {bindings}
        {datasets}
        entryId={target.kind === 'sequence' ? target.entryId : undefined}
        explicit={target.kind === 'sequence'}
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
    grid-template-rows: min-content min-content minmax(0, 1fr);
    height: 100%;
  }

  .inspector :global(.tabs) {
    background: var(--st-gray-10);
    border-bottom: 1px solid var(--st-gray-20);
    border-radius: 0;
    display: flex;
    flex-wrap: nowrap;
    gap: 2px;
    overflow-x: auto;
    height: auto;
    justify-content: flex-start;
    min-height: 36px;
    padding: 4px 6px;
  }

  .trail {
    align-items: center;
    border-bottom: 1px solid var(--st-gray-15);
    display: flex;
    font-size: 11px;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
    padding: 3px 8px;
    white-space: nowrap;
  }

  .crumb {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    max-width: 12em;
    overflow: hidden;
    padding: 0;
    text-overflow: ellipsis;
  }

  .crumb.current {
    color: var(--st-gray-80);
    cursor: default;
    flex: 1;
    max-width: none;
  }

  .trail :global(.sep) {
    color: var(--st-gray-50);
    flex: none;
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }
</style>
