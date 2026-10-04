<svelte:options immutable={true} />

<!--
  Adding a source to an analysis: an existing imported source (its newest revision, or an older one), a plan's
  current activities or one of its simulations, or a new file imported first. Importing makes an ordinary Source
  revision that any analysis can use; this analysis only references it.
-->
<script lang="ts">
  import { Badge, Button, Dialog, Tabs } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import type {
    AnalysisSourceBinding,
    AnalysisSourceOptions,
    AnalysisSourceTarget,
    SourceAdapterDescriptor,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { formatRange, getRevisionVersionLabel, isSameAnalysisSource } from '../../utilities/analysis';
  import effects from '../../utilities/effects';

  export let bindings: AnalysisSourceBinding[] = [];
  export let open: boolean = false;
  export let tab: 'imported' | 'plans' | 'import' = 'imported';
  export let user: User | null;

  const dispatch = createEventDispatcher<{ add: AnalysisSourceTarget }>();

  let options: AnalysisSourceOptions | null = null;
  let adapters: SourceAdapterDescriptor[] = [];
  let filter: string = '';
  let olderShown: Record<number, boolean> = {};

  let file: File | null = null;
  let importInto: 'new' | number = 'new';
  let newSourceName: string = '';
  let adapter: string = 'auto';
  let addWhenImported: boolean = true;
  let importing: boolean = false;
  let imported: string = '';

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
    imported = '';
    [options, adapters] = await Promise.all([effects.getAnalysisSourceOptions(user), effects.getSourceAdapters(user)]);
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

  function onFile(event: Event) {
    file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    if (file && !newSourceName) {
      newSourceName = file.name.replace(/(\.[a-z0-9]+)+$/i, '');
    }
  }

  async function importFile() {
    if (!file) {
      return;
    }
    importing = true;
    const revisionId = await effects.importSourceRevision(
      file,
      importInto === 'new' ? { sourceName: newSourceName.trim() || file.name } : { sourceId: importInto },
      adapter,
      user,
    );
    importing = false;
    if (revisionId !== null) {
      imported = `Importing ${file.name}. It is usable once the import finishes.`;
      if (addWhenImported) {
        add({ kind: 'imported', revisionId });
      }
      file = null;
      newSourceName = '';
      options = await effects.getAnalysisSourceOptions(user);
    }
  }

  function revisionStats(revision: AnalysisSourceOptions['sources'][number]['revisions'][number]): string {
    if (revision.status !== 'success') {
      return revision.status === 'failed' ? 'Import failed' : 'Importing…';
    }
    const resources = revision.resources_aggregate.aggregate?.count ?? 0;
    const activities = revision.activity_types_aggregate.aggregate?.sum?.count ?? 0;
    return `${resources.toLocaleString()} resources · ${activities.toLocaleString()} activities · ${formatRange(revision.coverage_start, revision.coverage_end)}`;
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
            {@const [newest, ...older] = source.revisions}
            {@const target = importedTarget(newest.id)}
            <div class="source">
              <div class="text-sm font-medium">{source.name}</div>
              <div class="option">
                <div class="min-w-0">
                  <div>{getRevisionVersionLabel(newest)} <span class="text-muted-foreground">· newest</span></div>
                  <div class="truncate text-muted-foreground">{revisionStats(newest)}</div>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={isAdded(bindings, target) || newest.status !== 'success'}
                  on:click={() => add(target)}>{isAdded(bindings, target) ? 'Added' : 'Add'}</Button
                >
              </div>
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
                        <div>{getRevisionVersionLabel(revision)}</div>
                        <div class="truncate text-muted-foreground">{revisionStats(revision)}</div>
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
                    disabled={isAdded(bindings, simulation)}
                    on:click={() => add(simulation)}>{isAdded(bindings, simulation) ? 'Added' : 'Add'}</Button
                  >
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-muted-foreground">No plans{needle ? ' match' : ''}.</div>
          {/each}
        {:else}
          <form class="flex flex-col gap-3" on:submit|preventDefault={importFile}>
            <label class="field">
              <span>File</span>
              <input type="file" class="st-input" aria-label="File to import" on:change={onFile} />
            </label>
            <label class="field">
              <span>Import as</span>
              <select bind:value={importInto} class="st-select" aria-label="Import as">
                <option value="new">A new source</option>
                {#each ownSources as source (source.id)}
                  <option value={source.id}>A new revision of {source.name}</option>
                {/each}
              </select>
            </label>
            {#if importInto === 'new'}
              <label class="field">
                <span>Source name</span>
                <input bind:value={newSourceName} class="st-input" aria-label="Source name" />
              </label>
            {/if}
            <label class="field">
              <span>Format</span>
              <select bind:value={adapter} class="st-select" aria-label="Format">
                <option value="auto">Detect from the file</option>
                {#each adapters as descriptor (descriptor.id)}
                  <option value={descriptor.id}>
                    {descriptor.display_name} ({descriptor.extensions.join(', ')})
                  </option>
                {/each}
              </select>
            </label>
            <label class="flex items-center gap-2">
              <input type="checkbox" bind:checked={addWhenImported} />
              Add it to this analysis
            </label>
            <div class="text-muted-foreground">
              Uploads go through the browser. For very large products, import from the server with the source-ingest
              CLI, then add the source here.
            </div>
            <div class="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={!file || importing}
                >{importing ? 'Uploading…' : 'Import'}</Button
              >
              {#if imported}<span role="status">{imported}</span>{/if}
            </div>
          </form>
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

  .field {
    display: grid;
    gap: 4px;
  }
</style>
