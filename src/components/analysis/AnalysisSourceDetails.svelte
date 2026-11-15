<svelte:options immutable={true} />

<!--
  One source of the analysis, inspected: what it is and which of its data the analysis reads (revision, simulation,
  live plan), what it covers and holds, where it came from, and what can be done about it (a newer revision, a deleted
  one, its name in this analysis, removing it).
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '@nasa-jpl/stellar-svelte';
  import {
    addAnalysisSource,
    analysisPlans,
    analysisSimulationDatasets,
    analysisSourceRecovery,
    analysisSourceRevisions,
    inspect,
    rebindAnalysisSource,
    removeAnalysisSource,
    setAnalysisSourceLabel,
  } from '../../stores/analysis';
  import type { AnalysisSourceBinding } from '../../types/analysis';
  import type { User } from '../../types/app';
  import {
    formatRange,
    getAnalysisSourceNames,
    getNewerRevision,
    getRevisionVersionLabel,
  } from '../../utilities/analysis';
  import { getAuthoredMission, getWorkspaceFileSnapshot } from '../../utilities/analysisSequence';
  import { getWorkspacesUrl } from '../../utilities/routes';
  import { getIntervalInMs } from '../../utilities/time';

  export let bindings: AnalysisSourceBinding[] = [];
  export let readOnly: boolean = false;
  export let sourceId: string;
  export let user: User | null;

  let replacement: number | null = null;

  $: binding = bindings.find(({ id }) => id === sourceId);
  $: revision =
    binding?.kind === 'imported' ? $analysisSourceRevisions.find(({ id }) => id === binding?.revisionId) : undefined;
  $: dataset =
    binding?.kind === 'simulation'
      ? $analysisSimulationDatasets.find(({ id }) => id === binding?.simulationDatasetId)
      : undefined;
  $: plan = binding?.kind === 'plan' ? ($analysisPlans ?? []).find(({ id }) => id === binding?.planId) : undefined;
  $: recovery =
    binding?.kind === 'imported' && !revision && binding.sourceId !== undefined
      ? $analysisSourceRecovery[binding.sourceId]
      : undefined;
  $: names = binding ? getAnalysisSourceNames(binding, { dataset, plan, revision, source: recovery }) : null;
  $: newer = getNewerRevision(revision);
  $: newerOffered = newer && !bindings.some(b => b.kind === 'imported' && b.revisionId === newer?.id) ? newer : null;
  $: mission = getAuthoredMission(revision);
  $: file = getWorkspaceFileSnapshot(revision);
  $: boundRevisions = new Set(bindings.flatMap(b => (b.kind === 'imported' ? [b.revisionId] : [])));
  $: choice =
    replacement ??
    recovery?.revisions.find(({ id }) => !boundRevisions.has(id))?.id ??
    recovery?.revisions[0]?.id ??
    null;
  $: planSimulations = (plan?.simulations ?? []).flatMap(s => s.simulation_datasets).sort((a, b) => b.id - a.id);
  // The plan a bound simulation is of, when that plan is a source too.
  $: planBinding = dataset?.simulation?.plan
    ? bindings.find(b => b.kind === 'plan' && b.planId === dataset?.simulation?.plan?.id)
    : undefined;

  function planEnd(of: { duration: string; start_time: string }) {
    return new Date(Date.parse(of.start_time) + getIntervalInMs(of.duration)).toISOString();
  }
</script>

<div class="source-details">
  {#if !binding || !names}
    <div class="text-muted-foreground">This source is no longer in the analysis.</div>
  {:else}
    <div class="title">{names.label}</div>
    <div class="text-muted-foreground">{names.name} · {names.version}</div>

    {#if recovery === null}
      <div class="problem">The source was deleted, so its data is gone. Remove it; rows that show it go with it.</div>
    {:else if recovery && !recovery.revisions.length}
      <div class="problem">This revision was deleted, and no successful revision remains.</div>
    {:else if recovery && choice !== null}
      <div class="problem">This revision was deleted. Its rows stay on this source; pick a revision to show them.</div>
      {#if !readOnly}
        <div class="row">
          <select
            class="st-select min-w-0 flex-1"
            aria-label="Replacement revision"
            value={choice}
            on:change={event => (replacement = Number(event.currentTarget.value))}
          >
            {#each recovery.revisions as option (option.id)}
              <option value={option.id} disabled={boundRevisions.has(option.id)}
                >{getRevisionVersionLabel(option)}{option.id === recovery.revisions[0].id ? ' · latest' : ''}</option
              >
            {/each}
          </select>
          <Button
            size="xs"
            variant="outline"
            disabled={boundRevisions.has(choice)}
            on:click={() =>
              recovery &&
              choice !== null &&
              rebindAnalysisSource(
                sourceId,
                { kind: 'imported', revisionId: choice, sourceId: recovery.id, sourceName: recovery.name },
                user,
              )}>Use it</Button
          >
        </div>
      {/if}
    {/if}

    {#if newerOffered && revision && !readOnly}
      {@const current = revision}
      {@const next = newerOffered}
      <div class="notice">
        <span>A newer revision exists: {getRevisionVersionLabel(next)}.</span>
        <Button
          size="xs"
          variant="outline"
          on:click={() =>
            rebindAnalysisSource(
              sourceId,
              { kind: 'imported', revisionId: next.id, sourceId: current.source.id, sourceName: current.source.name },
              user,
            )}>Use it</Button
        >
      </div>
    {/if}

    <dl>
      {#if revision}
        <dt>Source</dt>
        <dd>{revision.source.name}</dd>
        <dt>Revision</dt>
        <dd>{getRevisionVersionLabel(revision)}</dd>
        <dt>Covers</dt>
        <dd>{formatRange(revision.coverage_start, revision.coverage_end)}</dd>
        <dt>Contents</dt>
        <dd>
          {#if mission}
            Sequence {mission.sequenceId}
            <button class="link" on:click={() => inspect({ kind: 'sequence', sourceId })}>inspect</button>
          {:else}
            {revision.resources.length.toLocaleString()} resources ·
            {revision.activity_types.reduce((total, type) => total + type.count, 0).toLocaleString()} activities
          {/if}
        </dd>
        {#if file}
          <dt>From</dt>
          <dd>
            <a href={getWorkspacesUrl(base, file.workspaceId, file.path)} title="Open the file as it is now in SeqDev"
              >{file.workspaceName}/{file.path}</a
            >
            <span class="text-muted-foreground">(workspace {file.workspaceId}; this is a snapshot)</span>
          </dd>
        {:else}
          <dt>File</dt>
          <dd>{revision.metadata?.originalFileName ?? revision.original_file?.name ?? 'Read from the server'}</dd>
        {/if}
        {#if revision.metadata?.product?.suggestedName && !mission}
          <dt>Product</dt>
          <dd>{revision.metadata.product.suggestedName}</dd>
        {/if}
        <dt>Import</dt>
        <dd class:problem-text={revision.status === 'failed'}>
          {revision.status}{revision.finished_at ? ` · ${revision.finished_at.slice(0, 16).replace('T', ' ')}` : ''}
        </dd>
        <dt>Format</dt>
        <dd>{revision.adapter}{revision.adapter_version ? ` ${revision.adapter_version}` : ''}</dd>
        {#if revision.content_hash}
          <dt>Content</dt>
          <dd class="truncate" title={revision.content_hash}>{revision.content_hash}</dd>
        {/if}
      {:else if dataset}
        <dt>Plan</dt>
        <dd>
          {#if dataset.simulation?.plan}
            {@const of = dataset.simulation.plan}
            {#if planBinding}
              <button class="link" on:click={() => planBinding && inspect({ kind: 'source', sourceId: planBinding.id })}
                >{of.name}</button
              >
            {:else}
              <a href="{base}/plans/{of.id}">{of.name}</a>
            {/if}
          {:else}
            —
          {/if}
        </dd>
        <dt>Simulation</dt>
        <dd>{dataset.id} · {dataset.status}</dd>
        <dt>Covers</dt>
        <dd>{formatRange(dataset.simulation_start_time, dataset.simulation_end_time)}</dd>
        <dt>Contents</dt>
        <dd>
          {dataset.dataset?.profiles.length ?? 0} simulated resources, and the simulated activities. Results as simulated:
          later plan edits are not in them.
        </dd>
      {:else if plan}
        <dt>Plan</dt>
        <dd><a href="{base}/plans/{plan.id}">{plan.name}</a></dd>
        <dt>Data</dt>
        <dd>Its current activity directives, live: edits to the plan show here as they happen.</dd>
        <dt>Bounds</dt>
        <dd>{formatRange(plan.start_time, planEnd(plan))}</dd>
        <dt>Revision</dt>
        <dd>{plan.revision}</dd>
        <dt>Simulations</dt>
        <dd>
          {#each planSimulations as simulation (simulation.id)}
            {@const bound = bindings.find(b => b.kind === 'simulation' && b.simulationDatasetId === simulation.id)}
            <div class="row">
              <span class="flex-1">Simulation {simulation.id} · {simulation.status}</span>
              {#if bound}
                <button class="link" on:click={() => inspect({ kind: 'source', sourceId: bound.id })}
                  >in analysis</button
                >
              {:else if simulation.status === 'success' && !readOnly}
                <Button
                  size="xs"
                  variant="ghost"
                  class="h-5 px-1.5"
                  on:click={() => addAnalysisSource({ kind: 'simulation', simulationDatasetId: simulation.id }, user)}
                  >Add</Button
                >
              {/if}
            </div>
          {:else}
            <span class="text-muted-foreground">Not simulated yet: its resources come from a simulation.</span>
          {/each}
        </dd>
      {/if}
    </dl>

    {#if !readOnly}
      <label class="flex flex-col gap-1">
        <span class="text-muted-foreground">Name in this analysis</span>
        <input
          class="st-input"
          placeholder={`${names.name}`}
          value={binding.label ?? ''}
          on:change={event => setAnalysisSourceLabel(sourceId, event.currentTarget.value)}
        />
      </label>
      <div>
        <Button size="xs" variant="ghost" class="text-red-700" on:click={() => removeAnalysisSource(sourceId, user)}
          >Remove from analysis</Button
        >
      </div>
    {/if}
  {/if}
</div>

<style>
  .source-details {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    gap: 8px;
    height: 100%;
    overflow: auto;
    padding: 8px;
  }

  .title {
    font-size: 14px;
    font-weight: 500;
    word-break: break-word;
  }

  dl {
    display: grid;
    gap: 3px 8px;
    grid-template-columns: max-content minmax(0, 1fr);
    margin: 0;
  }

  dt {
    color: var(--st-gray-60);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .row,
  .notice {
    align-items: center;
    display: flex;
    gap: 6px;
  }

  .notice {
    background: rgba(217, 119, 6, 0.08);
    border-radius: 4px;
    justify-content: space-between;
    padding: 4px 6px;
  }

  .problem,
  .problem-text {
    color: #a8321e;
  }

  .link {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    padding: 0;
  }
</style>
