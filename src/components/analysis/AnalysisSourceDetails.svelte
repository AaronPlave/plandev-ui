<svelte:options immutable={true} />

<!--
  One source of the analysis, inspected: what it is and which of its data the analysis reads (a revision, a simulation,
  a live plan), what it covers and holds, and what needs doing about it (a newer revision, a deleted one), with its
  name in this analysis. Where it came from in detail is under Details; removing it is in its menu in Sources.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { CalendarRange, Database, ExternalLink, Play } from 'lucide-svelte';
  import {
    addAnalysisSource,
    analysisPlanDirectives,
    analysisPlans,
    analysisSimulationDatasets,
    analysisSimulationTypeCounts,
    analysisSourceRecovery,
    analysisSourceRevisions,
    inspect,
    rebindAnalysisSource,
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
  import Collapse from '../Collapse.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let readOnly: boolean = false;
  export let sourceId: string;
  export let user: User | null;

  let replacement: number | null = null;
  let alias: string = '';

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

  $: icon = binding?.kind === 'plan' ? CalendarRange : binding?.kind === 'simulation' ? Play : Database;
  $: kindLabel =
    binding?.kind === 'plan'
      ? 'Plan · live directives'
      : binding?.kind === 'simulation'
        ? 'Simulation results'
        : mission
          ? 'Authored sequence'
          : 'Imported source';
  $: openHref =
    binding?.kind === 'plan'
      ? `${base}/plans/${binding.planId}`
      : dataset?.simulation?.plan
        ? `${base}/plans/${dataset.simulation.plan.id}?simulationDatasetId=${dataset.id}`
        : file
          ? getWorkspacesUrl(base, file.workspaceId, file.path)
          : null;
  $: openLabel = binding?.kind === 'plan' ? 'Open Plan' : binding?.kind === 'simulation' ? 'Open' : 'Open in SeqDev';
  $: directiveCount = plan ? ($analysisPlanDirectives[plan.id]?.length ?? 0) : 0;
  $: simulatedCount = dataset
    ? ($analysisSimulationTypeCounts[dataset.id] ?? []).reduce((total, type) => total + type.count, 0)
    : 0;
  $: resetAlias(binding?.id);

  function resetAlias(_id: string | undefined) {
    alias = binding?.label ?? '';
  }

  function saveAlias() {
    setAnalysisSourceLabel(sourceId, alias);
  }

  function planEnd(of: { duration: string; start_time: string }) {
    return new Date(Date.parse(of.start_time) + getIntervalInMs(of.duration)).toISOString();
  }
</script>

<div class="source-details">
  {#if !binding || !names}
    <div class="text-muted-foreground">This source is no longer in the analysis.</div>
  {:else}
    <div class="header">
      <svelte:component this={icon} size={16} class="shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <div class="title" title={names.label}>{names.label}</div>
        <div class="text-muted-foreground">{kindLabel}{binding.label ? ` · ${names.name}` : ''}</div>
      </div>
      {#if openHref}
        <Button size="xs" variant="outline" href={openHref} class="gap-1">{openLabel}<ExternalLink size={11} /></Button>
      {/if}
    </div>

    {#if recovery === null}
      <div class="problem">The source was deleted, so its data is gone. Remove it from the analysis (its menu).</div>
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
        <span>Newer revision: {getRevisionVersionLabel(next)}</span>
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
        <dt>Revision</dt>
        <dd>{getRevisionVersionLabel(revision)}</dd>
        <dt>Covers</dt>
        <dd>{formatRange(revision.coverage_start, revision.coverage_end)}</dd>
        <dt>Contents</dt>
        <dd>
          {#if mission}
            <button class="link" on:click={() => inspect({ kind: 'sequence', sourceId })}
              >Sequence {mission.sequenceId}</button
            >
          {:else}
            {revision.resources.length.toLocaleString()} resources ·
            {revision.activity_types.reduce((total, type) => total + type.count, 0).toLocaleString()} activities
          {/if}
        </dd>
        {#if file}
          <dt>Workspace</dt>
          <dd>{file.workspaceName}/{file.path} <span class="text-muted-foreground">(snapshot)</span></dd>
        {/if}
      {:else if dataset}
        <dt>Plan</dt>
        <dd>
          {#if planBinding}
            <button class="link" on:click={() => planBinding && inspect({ kind: 'source', sourceId: planBinding.id })}
              >{dataset.simulation?.plan?.name}</button
            >
          {:else}
            {dataset.simulation?.plan?.name ?? '—'}
          {/if}
        </dd>
        <dt>Status</dt>
        <dd>{dataset.status}</dd>
        <dt>Covers</dt>
        <dd>{formatRange(dataset.simulation_start_time, dataset.simulation_end_time)}</dd>
        <dt>Contents</dt>
        <dd>{dataset.dataset?.profiles.length ?? 0} resources · {simulatedCount} simulated activities</dd>
      {:else if plan}
        <dt>Bounds</dt>
        <dd>{formatRange(plan.start_time, planEnd(plan))}</dd>
        <dt>Directives</dt>
        <dd>{directiveCount.toLocaleString()} <span class="text-muted-foreground">(live)</span></dd>
        <dt>Revision</dt>
        <dd>{plan.revision}</dd>
      {/if}
    </dl>

    {#if plan}
      <section aria-label="Simulations">
        <div class="section-title">Simulations</div>
        {#each planSimulations as simulation (simulation.id)}
          {@const bound = bindings.find(b => b.kind === 'simulation' && b.simulationDatasetId === simulation.id)}
          <div class="row">
            {#if bound}
              <button
                class="link flex-1 text-left"
                title="Inspect this simulation"
                on:click={() => inspect({ kind: 'source', sourceId: bound.id })}>Simulation {simulation.id}</button
              >
            {:else}
              <span class="flex-1 text-muted-foreground">Simulation {simulation.id}</span>
            {/if}
            <span class="status" data-tone={simulation.status === 'failed' ? 'error' : 'muted'}
              >{bound ? 'Attached' : simulation.status}</span
            >
            {#if !bound && simulation.status === 'success' && !readOnly}
              <Button
                size="xs"
                variant="outline"
                class="h-5 px-2"
                on:click={() => addAnalysisSource({ kind: 'simulation', simulationDatasetId: simulation.id }, user)}
                >Add</Button
              >
            {/if}
          </div>
        {:else}
          <div class="text-muted-foreground">Not simulated yet.</div>
        {/each}
      </section>
    {/if}

    {#if !readOnly}
      <form class="alias" on:submit|preventDefault={saveAlias}>
        <label for="source-alias-{sourceId}" class="text-muted-foreground">Name in this analysis</label>
        <div class="row">
          <input
            id="source-alias-{sourceId}"
            class="st-input min-w-0 flex-1"
            placeholder={names.name}
            bind:value={alias}
          />
          <Button size="xs" variant="outline" type="submit" disabled={alias.trim() === (binding.label ?? '')}
            >Save</Button
          >
        </div>
      </form>
    {/if}

    {#if revision}
      <Collapse title="Details" defaultExpanded={false} padContent={false}>
        <dl class="details">
          <dt>Source</dt>
          <dd>{revision.source.name} <span class="text-muted-foreground">({revision.source.source_type})</span></dd>
          {#if !file}
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
          <dt>Ids</dt>
          <dd>source {revision.source.id} · revision {revision.id}</dd>
        </dl>
      </Collapse>
    {/if}
  {/if}
</div>

<style>
  .source-details {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    gap: 10px;
    height: 100%;
    overflow: auto;
    padding: 8px;
  }

  .header {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .title {
    font-size: 14px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-title {
    font-weight: 500;
    margin-bottom: 2px;
  }

  dl {
    display: grid;
    gap: 3px 8px;
    grid-template-columns: max-content minmax(0, 1fr);
    margin: 0;
  }

  dl.details {
    padding: 4px 8px 8px;
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
    min-height: 22px;
  }

  .alias {
    display: flex;
    flex-direction: column;
    gap: 4px;
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

  .status {
    background: var(--st-gray-15);
    border-radius: 3px;
    color: var(--st-gray-70);
    font-size: 10px;
    padding: 0 4px;
  }

  .status[data-tone='error'] {
    background: rgba(219, 81, 57, 0.15);
    color: #a8321e;
  }

  .link {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .link:hover {
    text-decoration: underline;
  }
</style>
