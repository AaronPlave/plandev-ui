<svelte:options immutable={true} />

<!--
  The analysis's sources, each once, as one tree: open a source to add its resources and activities to the timeline,
  click its name to inspect it (identity, revision, coverage, provenance, import), and find the rest in its menu. A
  simulation of a plan that is also a source sits under that plan, with the plan's other simulations ready to add.
  What needs attention (a failed import, a deleted revision, a newer one) is said on the source's row.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    addAnalysisSource,
    analysisPlans,
    analysisSimulationDatasets,
    analysisSourceRecovery,
    analysisSourceRevisions,
    inspect,
    removeAnalysisSource,
  } from '../../stores/analysis';
  import { view } from '../../stores/views';
  import type {
    AnalysisPlan,
    AnalysisPlanSimulationDataset,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
    SourceRecovery,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { Layer, Row } from '../../types/timeline';
  import type { SourceBrowserAction, TimelineSourceRegistry } from '../../types/timelineSource';
  import { getNewerRevision } from '../../utilities/analysis';
  import { getAuthoredMission, getAuthoredSections } from '../../utilities/analysisSequence';
  import { addSourceItem, dragSourceItem } from '../sources/sourceBrowserActions';
  import AnalysisSourceNode, { type SourceStatus } from './AnalysisSourceNode.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let registry: TimelineSourceRegistry;
  export let readOnly: boolean = false;
  export let user: User | null;

  const dispatch = createEventDispatcher<{ addSource: void }>();

  let expanded: Record<string, boolean> = {};
  let filterText: string = '';

  $: rows = $view?.definition.plan.timelines[0]?.rows ?? [];
  $: sources = Object.fromEntries(registry.sources.map(source => [source.id, source]));
  $: labels = Object.fromEntries(registry.sources.map(source => [source.id, source.label]));
  const plansLoading = analysisPlans.loading;
  $: statuses = getStatuses(
    bindings,
    $analysisPlans ?? [],
    $plansLoading,
    $analysisSimulationDatasets,
    $analysisSourceRevisions,
    $analysisSourceRecovery,
  );
  $: sequenceSteps = Object.fromEntries(
    bindings.flatMap(binding => {
      const mission =
        binding.kind === 'imported'
          ? getAuthoredMission($analysisSourceRevisions.find(({ id }) => id === binding.revisionId))
          : null;
      return mission
        ? [[binding.id, getAuthoredSections(mission).reduce((n, section) => n + section.entries.length, 0)]]
        : [];
    }),
  );
  // Each bound plan's simulations, newest first, with the binding that reads each one.
  $: planSimulations = Object.fromEntries(
    bindings.flatMap(binding => {
      if (binding.kind !== 'plan') {
        return [];
      }
      const plan = ($analysisPlans ?? []).find(({ id }) => id === binding.planId);
      const datasets: AnalysisPlanSimulationDataset[] = (plan?.simulations ?? [])
        .flatMap(simulation => simulation.simulation_datasets)
        .sort((a, b) => b.id - a.id);
      return [
        [
          binding.id,
          datasets.map(dataset => ({
            binding: bindings.find(b => b.kind === 'simulation' && b.simulationDatasetId === dataset.id),
            dataset,
          })),
        ],
      ];
    }),
  );
  // A simulation shown under its plan is not shown again at the top.
  $: nested = new Set(
    Object.values(planSimulations).flatMap(simulations => simulations.flatMap(s => (s.binding ? [s.binding.id] : []))),
  );
  $: topLevel = bindings.filter(binding => !nested.has(binding.id));

  function getStatuses(
    all: AnalysisSourceBinding[],
    plans: AnalysisPlan[],
    plansLoading: boolean,
    datasets: AnalysisSimulationDataset[],
    revisions: AnalysisSourceRevision[],
    recoveries: Record<number, SourceRecovery | null>,
  ): Record<string, SourceStatus | null> {
    const getStatus = (binding: AnalysisSourceBinding): SourceStatus | null => {
      if (binding.kind === 'plan') {
        return plans.some(({ id }) => id === binding.planId) || plansLoading
          ? { text: 'Live', tone: 'muted' }
          : { text: 'Plan deleted', tone: 'error' };
      }
      if (binding.kind === 'simulation') {
        const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
        return dataset && dataset.status !== 'success'
          ? { text: dataset.status, tone: dataset.status === 'failed' ? 'error' : 'muted' }
          : null;
      }
      const revision = revisions.find(({ id }) => id === binding.revisionId);
      if (!revision) {
        const recovery = binding.sourceId === undefined ? undefined : recoveries[binding.sourceId];
        return recovery === undefined
          ? null
          : { text: recovery === null ? 'Source deleted' : 'Revision deleted', tone: 'error' };
      }
      if (revision.status === 'failed') {
        return { text: 'Import failed', tone: 'error' };
      }
      if (revision.status !== 'success') {
        return { text: 'Importing…', tone: 'muted' };
      }
      const newer = getNewerRevision(revision);
      return newer && !all.some(b => b.kind === 'imported' && b.revisionId === newer.id)
        ? { text: 'Newer revision', tone: 'warning' }
        : null;
    };
    return Object.fromEntries(all.map(binding => [binding.id, getStatus(binding)]));
  }

  function onAdd({
    detail: { action, layer, row },
  }: CustomEvent<{ action: SourceBrowserAction; layer?: Layer; row?: Row }>) {
    addSourceItem(registry, action, row, layer);
  }

  function onDragStart({ detail: { action, event } }: CustomEvent<{ action: SourceBrowserAction; event: DragEvent }>) {
    dragSourceItem(registry, action, event);
  }

  function onToggle({ detail: { id, open } }: CustomEvent<{ id: string; open: boolean }>) {
    expanded = { ...expanded, [id]: !open };
  }
</script>

<div class="analysis-sources">
  <div class="header">
    <span class="st-typography-medium">Sources</span>
    <Button size="xs" variant="outline" disabled={readOnly} on:click={() => dispatch('addSource')}>Add Source</Button>
  </div>
  {#if bindings.length}
    <div class="filter">
      <input
        bind:value={filterText}
        class="st-input w-full"
        autocomplete="off"
        placeholder="Filter sources, resources, activities"
        aria-label="Filter sources"
      />
    </div>
  {/if}
  <div class="tree" role="tree" aria-label="Analysis sources">
    {#each topLevel as binding (binding.id)}
      <AnalysisSourceNode
        {binding}
        {expanded}
        {filterText}
        {labels}
        {readOnly}
        {rows}
        {sequenceSteps}
        simulations={planSimulations[binding.id] ?? []}
        {sources}
        {statuses}
        on:add={onAdd}
        on:addSimulation={({ detail }) => addAnalysisSource({ kind: 'simulation', simulationDatasetId: detail }, user)}
        on:dragstart={onDragStart}
        on:remove={({ detail }) => removeAnalysisSource(detail, user)}
        on:rename={({ detail }) => inspect({ kind: 'source', sourceId: detail })}
        on:toggle={onToggle}
      />
    {:else}
      <div class="empty">
        No sources yet.
        <button class="link" disabled={readOnly} on:click={() => dispatch('addSource')}>Add one</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .analysis-sources {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    height: 100%;
    overflow: hidden;
  }

  .header {
    align-items: center;
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    justify-content: space-between;
    padding: 6px 8px;
  }

  .filter {
    padding: 6px 8px 4px;
  }

  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 8px;
  }

  .empty {
    color: var(--st-gray-60);
    padding: 8px;
  }

  .link {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }
</style>
