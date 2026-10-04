<svelte:options immutable={true} />

<!--
  Adding a source to an analysis: an existing imported source (its newest revision, or an older one), a plan's
  current activities or one of its simulations, or a new file imported first. Importing makes an ordinary Source
  revision that any analysis can use; this analysis only references it.
-->
<script lang="ts">
  import { Badge, Button, Dialog, Tabs } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import type { AnalysisSourceBinding, AnalysisSourceOptions, AnalysisSourceTarget } from '../../types/analysis';
  import type { User } from '../../types/app';
  import {
    formatRange,
    formatRequestTime,
    getRevisionSummary,
    getRevisionVersionLabel,
    isSameAnalysisSource,
    splitSourceRevisions,
  } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import SourceImportForm from '../sources/SourceImportForm.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let open: boolean = false;
  export let tab: 'imported' | 'plans' | 'import' = 'imported';
  export let user: User | null;

  const dispatch = createEventDispatcher<{ add: AnalysisSourceTarget }>();

  let options: AnalysisSourceOptions | null = null;
  let filter: string = '';
  let olderShown: Record<number, boolean> = {};

  $: if (open) {
    load();
  }
  $: needle = filter.trim().toLowerCase();
  $: sources = (options?.sources ?? []).filter(
    source => source.revisions.length && (!needle || source.name.toLowerCase().includes(needle)),
  );
  $: plans = (options?.plans ?? []).filter(plan => !needle || plan.name.toLowerCase().includes(needle));
  $: ownSources = (options?.sources ?? []).filter(source => source.owner === user?.id);

  async function load() {
    options = await effects.getAnalysisSourceOptions(user);
  }

  function isAdded(current: AnalysisSourceBinding[], target: AnalysisSourceTarget) {
    return current.some(binding => isSameAnalysisSource(binding, target));
  }

  function importedTarget(revisionId: number): AnalysisSourceTarget {
    return { kind: 'imported', revisionId };
  }

  function planTarget(plan: { id: number; revision: number }): AnalysisSourceTarget {
    return { kind: 'plan', planId: plan.id, planRevision: plan.revision };
  }

  function simulationTarget(simulationDatasetId: number): AnalysisSourceTarget {
    return { kind: 'simulation', simulationDatasetId };
  }

  function add(target: AnalysisSourceTarget) {
    dispatch('add', target);
  }

  async function onImported({ detail: { add: addIt, revisionId } }: CustomEvent<{ add: boolean; revisionId: number }>) {
    if (addIt) {
      add({ kind: 'imported', revisionId });
    }
    options = await effects.getAnalysisSourceOptions(user);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[80vh] max-w-[640px] flex-col gap-3">
    <Dialog.Header>
      <Dialog.Title>Add Source</Dialog.Title>
      <Dialog.Description>
        An analysis references its sources; it never copies them. Add data that already exists, or import a file as a
        new source anyone can use.
      </Dialog.Description>
    </Dialog.Header>

    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col">
      <Tabs.List class="self-start">
        <Tabs.Trigger value="imported">Imported Sources</Tabs.Trigger>
        <Tabs.Trigger value="plans">Plans</Tabs.Trigger>
        <Tabs.Trigger value="import">Import New Source</Tabs.Trigger>
      </Tabs.List>

      {#if tab !== 'import'}
        <input bind:value={filter} class="st-input mt-2 w-full" placeholder="Filter" aria-label="Filter sources" />
      {/if}

      <div class="mt-2 min-h-0 flex-1 overflow-auto text-xs">
        {#if !options}
          <div class="text-muted-foreground">Loading…</div>
        {:else if tab === 'imported'}
          {#each sources as source (source.id)}
            {@const { older, pending, usable } = splitSourceRevisions(source.revisions)}
            <div class="source">
              <div class="text-sm font-medium">{source.name}</div>
              {#if usable}
                {@const target = importedTarget(usable.id)}
                <div class="option">
                  <div class="min-w-0">
                    <div>
                      {getRevisionVersionLabel(usable)} <span class="text-muted-foreground">· latest successful</span>
                    </div>
                    <div class="truncate text-muted-foreground">{getRevisionSummary(usable)}</div>
                  </div>
                  <Button size="xs" variant="outline" disabled={isAdded(bindings, target)} on:click={() => add(target)}
                    >{isAdded(bindings, target) ? 'Added' : 'Add'}</Button
                  >
                </div>
              {/if}
              {#each pending as revision (revision.id)}
                <div class="option">
                  <div class="min-w-0">
                    <div>{getRevisionSummary(revision)}</div>
                    <div class="truncate text-muted-foreground" title={revision.error?.message}>
                      {formatRequestTime(revision)}{revision.error?.message ? ` · ${revision.error.message}` : ''}
                    </div>
                  </div>
                </div>
              {/each}
              {#if older.length}
                <button
                  class="older-toggle text-muted-foreground"
                  aria-expanded={!!olderShown[source.id]}
                  on:click={() => (olderShown = { ...olderShown, [source.id]: !olderShown[source.id] })}
                >
                  {olderShown[source.id] ? 'Hide' : 'Show'}
                  {older.length} older revision{older.length === 1 ? '' : 's'}
                </button>
                {#if olderShown[source.id]}
                  {#each older as revision (revision.id)}
                    {@const olderTarget = importedTarget(revision.id)}
                    <div class="option nested">
                      <div class="min-w-0">
                        {#if revision.status === 'success'}
                          <div>{getRevisionVersionLabel(revision)}</div>
                          <div class="truncate text-muted-foreground">{getRevisionSummary(revision)}</div>
                        {:else}
                          <div>{getRevisionSummary(revision)}</div>
                          <div class="truncate text-muted-foreground">{formatRequestTime(revision)}</div>
                        {/if}
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isAdded(bindings, olderTarget) || revision.status !== 'success'}
                        on:click={() => add(olderTarget)}>{isAdded(bindings, olderTarget) ? 'Added' : 'Add'}</Button
                      >
                    </div>
                  {/each}
                {/if}
              {/if}
            </div>
          {:else}
            <div class="text-muted-foreground">
              No imported sources{needle ? ' match' : ' yet'}.
              <button class="link" on:click={() => (tab = 'import')}>Import one</button>
            </div>
          {/each}
        {:else if tab === 'plans'}
          {#each plans as plan (plan.id)}
            {@const current = planTarget(plan)}
            {@const datasets = plan.simulations.flatMap(simulation => simulation.simulation_datasets)}
            <div class="source">
              <div class="text-sm font-medium">{plan.name}</div>
              <div class="option">
                <div class="min-w-0">
                  <div>
                    Current activities <Badge variant="secondary" class="ml-1 px-1 py-0 text-[10px]">Live</Badge>
                  </div>
                  <div class="text-muted-foreground">
                    The plan's activity directives as they are now, and as it changes
                  </div>
                </div>
                <Button size="xs" variant="outline" disabled={isAdded(bindings, current)} on:click={() => add(current)}
                  >{isAdded(bindings, current) ? 'Added' : 'Add'}</Button
                >
              </div>
              {#each datasets as dataset (dataset.id)}
                {@const simulation = simulationTarget(dataset.id)}
                <div class="option">
                  <div class="min-w-0">
                    <div>Simulation {dataset.id}</div>
                    <div class="text-muted-foreground">
                      {dataset.status} · {formatRange(dataset.simulation_start_time, dataset.simulation_end_time)}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isAdded(bindings, simulation) || dataset.status !== 'success'}
                    on:click={() => add(simulation)}>{isAdded(bindings, simulation) ? 'Added' : 'Add'}</Button
                  >
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-muted-foreground">No plans{needle ? ' match' : ''}.</div>
          {/each}
        {:else}
          <SourceImportForm offerAdd {ownSources} {user} on:imported={onImported} />
        {/if}
      </div>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>

<style>
  .source {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0;
  }

  .option {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding-left: 8px;
  }

  .option.nested {
    padding-left: 20px;
  }

  .older-toggle,
  .link {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 0 0 8px;
    text-align: left;
    text-decoration: underline;
  }
</style>
