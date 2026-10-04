<svelte:options immutable={true} />

<!--
  The analysis's sources: what it composes (with provenance and removal), an Add Source picker over every imported
  revision and every plan's simulations, and the Sources browser to add their resources and activities as rows.
-->
<script lang="ts">
  import { addAnalysisSource, removeAnalysisSource } from '../../stores/analysis';
  import type { AnalysisSourceBinding, AnalysisSourceOptions, AnalysisSourceTarget } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { TimelineSourceRegistry } from '../../types/timelineSource';
  import { isSameAnalysisSource } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { getSource } from '../../utilities/timelineSources';
  import { tooltip } from '../../utilities/tooltip';
  import SourceBrowser from '../sources/SourceBrowser.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let registry: TimelineSourceRegistry;
  export let readOnly: boolean = false;
  export let user: User | null;

  let adding: boolean = false;
  let options: AnalysisSourceOptions | null = null;
  let optionsFilter: string = '';

  $: needle = optionsFilter.trim().toLowerCase();
  $: revisionOptions = (options?.revisions ?? []).filter(
    revision => !needle || `${revision.source.name} r${revision.id}`.toLowerCase().includes(needle),
  );
  $: planOptions = (options?.plans ?? [])
    .map(plan => ({
      ...plan,
      datasets: plan.simulations.flatMap(simulation => simulation.simulation_datasets),
    }))
    .filter(plan => plan.datasets.length && (!needle || plan.name.toLowerCase().includes(needle)));

  async function toggleAdding() {
    adding = !adding;
    if (adding) {
      options = await effects.getAnalysisSourceOptions(user);
    }
  }

  function importedTarget(revisionId: number): AnalysisSourceTarget {
    return { kind: 'imported', revisionId };
  }

  function simulationTarget(simulationDatasetId: number): AnalysisSourceTarget {
    return { kind: 'simulation', simulationDatasetId };
  }

  function isAdded(current: AnalysisSourceBinding[], target: AnalysisSourceTarget) {
    return current.some(binding => isSameAnalysisSource(binding, target));
  }

  function formatRange(start: string | null, end: string | null) {
    return `${start?.slice(0, 10) ?? '?'} – ${end?.slice(0, 10) ?? '?'}`;
  }
</script>

<div class="analysis-sources">
  <div class="header">
    <span class="st-typography-medium">Sources</span>
    <button class="st-button secondary" disabled={readOnly} on:click={toggleAdding}>
      {adding ? 'Done' : 'Add Source'}
    </button>
  </div>

  {#if adding}
    <div class="picker" role="region" aria-label="Add Source">
      <input
        bind:value={optionsFilter}
        class="st-input w-full"
        placeholder="Filter"
        aria-label="Filter sources to add"
      />
      {#if !options}
        <div class="muted">Loading…</div>
      {:else}
        <div class="picker-group st-typography-label">Imported Sources</div>
        {#each revisionOptions as revision (revision.id)}
          {@const target = importedTarget(revision.id)}
          <div class="option">
            <div class="option-text">
              <div>{revision.source.name} <span class="muted">r{revision.id}</span></div>
              <div class="muted">
                {revision.status} · {revision.resources_aggregate.aggregate?.count ?? 0} resources ·
                {(revision.activity_types_aggregate.aggregate?.sum?.count ?? 0).toLocaleString()} activities ·
                {formatRange(revision.coverage_start, revision.coverage_end)}
              </div>
            </div>
            <button
              class="st-button tertiary"
              disabled={isAdded(bindings, target) || revision.status !== 'success'}
              on:click={() => addAnalysisSource(target, user)}>{isAdded(bindings, target) ? 'Added' : 'Add'}</button
            >
          </div>
        {:else}
          <div class="muted">No imported sources</div>
        {/each}
        <div class="picker-group st-typography-label">Plans</div>
        {#each planOptions as plan (plan.id)}
          <div class="plan-name">{plan.name} <span class="muted">plan {plan.id}</span></div>
          {#each plan.datasets as dataset (dataset.id)}
            {@const target = simulationTarget(dataset.id)}
            <div class="option nested">
              <div class="option-text">
                <div>Simulation {dataset.id}</div>
                <div class="muted">
                  {dataset.status} · {formatRange(dataset.simulation_start_time, dataset.simulation_end_time)}
                </div>
              </div>
              <button
                class="st-button tertiary"
                disabled={isAdded(bindings, target)}
                on:click={() => addAnalysisSource(target, user)}>{isAdded(bindings, target) ? 'Added' : 'Add'}</button
              >
            </div>
          {/each}
        {:else}
          <div class="muted">No simulated plans</div>
        {/each}
      {/if}
    </div>
  {/if}

  <ul class="bound" aria-label="Analysis sources">
    {#each bindings as binding (binding.id)}
      {@const source = getSource(registry, binding.id)}
      <li class="bound-source">
        <div class="option-text" use:tooltip={{ content: source?.description ?? '', placement: 'right' }}>
          <div>{source?.label ?? binding.id}</div>
          <div class="muted">{source?.group ?? ''} · {binding.id}</div>
        </div>
        <button
          class="st-button icon"
          aria-label="Remove {source?.label ?? binding.id}"
          disabled={readOnly}
          use:tooltip={{ content: 'Remove from analysis (and its rows)', placement: 'top' }}
          on:click={() => removeAnalysisSource(binding.id, user)}>×</button
        >
      </li>
    {:else}
      <li class="muted">No sources yet. Add an imported source or a plan's simulation.</li>
    {/each}
  </ul>

  <div class="browser">
    <SourceBrowser
      groups={['Imported Sources', 'Simulations']}
      emptyGroupMessages={{ 'Imported Sources': 'No imported sources added', Simulations: 'No simulations added' }}
      {readOnly}
      showUpload={false}
      {user}
    />
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

  .picker {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 45%;
    overflow: auto;
    padding: 8px;
  }

  .picker-group {
    color: var(--st-gray-60);
    margin-top: 4px;
  }

  .plan-name {
    margin-top: 2px;
  }

  .option,
  .bound-source {
    align-items: center;
    display: flex;
    gap: 4px;
    justify-content: space-between;
  }

  .option.nested {
    padding-left: 12px;
  }

  .option-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .muted {
    color: var(--st-gray-50);
  }

  .bound {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 4px;
    list-style: none;
    margin: 0;
    padding: 8px;
  }

  .browser {
    flex: 1;
    min-height: 0;
  }
</style>
