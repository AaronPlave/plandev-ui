<svelte:options immutable={true} />

<!--
  The analysis's sources: what each one is (its name, which version of its data, the analysis's alias for it), its
  details on demand, an update when a newer revision of an imported source exists, and the Sources browser to add
  their resources and activities as rows.
-->
<script lang="ts">
  import { Badge, Button } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    analysis,
    analysisPlans,
    analysisSimulationDatasets,
    analysisSourceRevisions,
    rebindAnalysisSource,
    removeAnalysisSource,
    setAnalysisSourceLabel,
  } from '../../stores/analysis';
  import type {
    AnalysisPlan,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { TimelineSourceRegistry } from '../../types/timelineSource';
  import {
    formatRange,
    getAnalysisSourceNames,
    getNewerRevision,
    getRevisionVersionLabel,
  } from '../../utilities/analysis';
  import { getIntervalInMs } from '../../utilities/time';
  import { getSource } from '../../utilities/timelineSources';
  import SourceBrowser from '../sources/SourceBrowser.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let registry: TimelineSourceRegistry;
  export let readOnly: boolean = false;
  export let user: User | null;

  const dispatch = createEventDispatcher<{ addSource: void }>();

  let detailsShown: Record<string, boolean> = {};
  let renaming: string | null = null;

  $: savedSources = $analysis?.definition.sources ?? [];
  // What each source is, recomputed whenever the details it is built from arrive or change.
  $: described = Object.fromEntries(
    bindings.map(binding => [
      binding.id,
      describe(binding, $analysisSourceRevisions, $analysisSimulationDatasets, $analysisPlans ?? [], savedSources),
    ]),
  );
  // Only the kinds of source the analysis has: an analysis of one plan shows no empty "Imported Sources".
  $: browserGroups = ['Imported Sources', 'Plans', 'Simulations'].filter(group =>
    registry.sources.some(source => source.group === group),
  );

  function describe(
    binding: AnalysisSourceBinding,
    revisions: AnalysisSourceRevision[],
    datasets: AnalysisSimulationDataset[],
    plans: AnalysisPlan[],
    saved: AnalysisSourceBinding[],
  ) {
    const revision = binding.kind === 'imported' ? revisions.find(({ id }) => id === binding.revisionId) : undefined;
    const dataset =
      binding.kind === 'simulation' ? datasets.find(({ id }) => id === binding.simulationDatasetId) : undefined;
    const plan = binding.kind === 'plan' ? plans.find(({ id }) => id === binding.planId) : undefined;
    const savedBinding = saved.find(({ id }) => id === binding.id);
    return {
      ...getAnalysisSourceNames(binding, { dataset, plan, revision }),
      dataset,
      newer: getNewerRevision(revision),
      plan,
      // The plan has been edited since this analysis last saved what it saw of it.
      planChanged:
        !!plan &&
        savedBinding?.kind === 'plan' &&
        savedBinding.planRevision !== undefined &&
        savedBinding.planRevision !== plan.revision,
      revision,
    };
  }

  function onRename(binding: AnalysisSourceBinding, event: Event) {
    setAnalysisSourceLabel(binding.id, (event.currentTarget as HTMLInputElement).value);
    renaming = null;
  }

  function planEnd(plan: { duration: string; start_time: string }) {
    return new Date(Date.parse(plan.start_time) + getIntervalInMs(plan.duration)).toISOString();
  }
</script>

<div class="analysis-sources">
  <div class="header">
    <span class="st-typography-medium">Sources</span>
    <Button size="xs" variant="outline" disabled={readOnly} on:click={() => dispatch('addSource')}>Add Source</Button>
  </div>

  <ul class="bound" aria-label="Analysis sources">
    {#each bindings as binding (binding.id)}
      {@const source = getSource(registry, binding.id)}
      {@const info = described[binding.id]}
      <li class="bound-source">
        <div class="flex items-start justify-between gap-1">
          <div class="min-w-0">
            {#if renaming === binding.id}
              <input
                class="st-input w-full"
                aria-label="Name in this analysis"
                placeholder={info.name}
                value={binding.label ?? ''}
                on:change={event => onRename(binding, event)}
                on:blur={() => (renaming = null)}
              />
            {:else}
              <div class="truncate font-medium">
                {binding.label || info.name}
                {#if binding.kind === 'plan'}
                  <Badge variant="secondary" class="ml-1 px-1 py-0 text-[10px]">Live</Badge>
                {/if}
              </div>
            {/if}
            <div class="truncate text-muted-foreground">
              {binding.label ? `${info.name} · ` : ''}{info.version}
            </div>
            {#if source?.resources?.unavailableReason}
              <div class="text-[11px] text-red-700">{source.resources.unavailableReason}</div>
            {/if}
            {#if info.planChanged}
              <div class="text-[11px] text-muted-foreground">The plan has changed since this analysis was saved</div>
            {/if}
          </div>
          <div class="flex shrink-0">
            <button
              class="st-button icon"
              aria-label="Details of {info.label}"
              aria-expanded={!!detailsShown[binding.id]}
              on:click={() => (detailsShown = { ...detailsShown, [binding.id]: !detailsShown[binding.id] })}>ⓘ</button
            >
            <button
              class="st-button icon"
              aria-label="Rename {info.label} in this analysis"
              disabled={readOnly}
              on:click={() => (renaming = binding.id)}>✎</button
            >
            <button
              class="st-button icon"
              aria-label="Remove {info.label}"
              disabled={readOnly}
              on:click={() => removeAnalysisSource(binding.id, user)}>×</button
            >
          </div>
        </div>

        {#if info.newer && !readOnly}
          <div class="newer">
            <span>Newer: {getRevisionVersionLabel(info.newer)}</span>
            <Button
              size="xs"
              variant="outline"
              on:click={() =>
                info.newer && rebindAnalysisSource(binding.id, { kind: 'imported', revisionId: info.newer.id }, user)}
              >Use it</Button
            >
          </div>
        {/if}

        {#if detailsShown[binding.id]}
          <dl class="details" aria-label="Details of {info.label}">
            {#if info.revision}
              {@const revision = info.revision}
              <dt>Source</dt>
              <dd>{revision.source.name}</dd>
              <dt>Revision</dt>
              <dd>{getRevisionVersionLabel(revision)}</dd>
              {#if revision.metadata?.product?.suggestedName}
                <dt>Product</dt>
                <dd>{revision.metadata.product.suggestedName}</dd>
              {/if}
              <dt>File</dt>
              <dd>{revision.metadata?.originalFileName ?? revision.original_file?.name ?? 'Read from the server'}</dd>
              <dt>Covers</dt>
              <dd>{formatRange(revision.coverage_start, revision.coverage_end)}</dd>
              <dt>Contents</dt>
              <dd>
                {revision.resources.length.toLocaleString()} resources ·
                {revision.activity_types.reduce((total, type) => total + type.count, 0).toLocaleString()} activities
              </dd>
              <dt>Import</dt>
              <dd>
                {revision.status}{revision.finished_at
                  ? ` · ${revision.finished_at.slice(0, 16).replace('T', ' ')}`
                  : ''}
              </dd>
              <dt>Format</dt>
              <dd>{revision.adapter}{revision.adapter_version ? ` ${revision.adapter_version}` : ''}</dd>
              {#if revision.content_hash}
                <dt>Content hash</dt>
                <dd class="truncate" title={revision.content_hash}>{revision.content_hash}</dd>
              {/if}
            {:else if info.dataset}
              {@const dataset = info.dataset}
              <dt>Plan</dt>
              <dd>{dataset.simulation?.plan?.name ?? '—'}</dd>
              <dt>Simulation</dt>
              <dd>{dataset.id} · {dataset.status}</dd>
              <dt>Covers</dt>
              <dd>{formatRange(dataset.simulation_start_time, dataset.simulation_end_time)}</dd>
            {:else if info.plan}
              {@const plan = info.plan}
              <dt>Plan</dt>
              <dd>{plan.name}</dd>
              <dt>Data</dt>
              <dd>Its current activity directives, live: edits to the plan show here as they happen.</dd>
              <dt>Plan bounds</dt>
              <dd>{formatRange(plan.start_time, planEnd(plan))}</dd>
              <dt>Plan revision</dt>
              <dd>{plan.revision}</dd>
            {/if}
            <dt>Rows refer to it as</dt>
            <dd>{binding.id}</dd>
          </dl>
        {/if}
      </li>
    {:else}
      <li class="text-muted-foreground">
        No sources yet.
        <button class="link" disabled={readOnly} on:click={() => dispatch('addSource')}>Add one</button>
      </li>
    {/each}
  </ul>

  <div class="browser">
    {#if browserGroups.length}
      <SourceBrowser groups={browserGroups} {readOnly} showUpload={false} {user} />
    {/if}
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

  .bound {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 8px;
    list-style: none;
    margin: 0;
    max-height: 50%;
    overflow: auto;
    padding: 8px;
  }

  .bound-source {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .newer {
    align-items: center;
    display: flex;
    gap: 6px;
    justify-content: space-between;
  }

  .details {
    display: grid;
    gap: 2px 8px;
    grid-template-columns: max-content 1fr;
    margin: 0;
  }

  .details dt {
    color: var(--st-gray-50);
  }

  .details dd {
    margin: 0;
    min-width: 0;
  }

  .link {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }

  .browser {
    flex: 1;
    min-height: 0;
  }
</style>
