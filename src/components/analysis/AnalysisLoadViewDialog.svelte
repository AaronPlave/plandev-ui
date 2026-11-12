<svelte:options immutable={true} />

<!--
  Loading a saved View's timeline into this analysis. Pick a view, then review what comes across: the timeline
  replaces this analysis's timeline and nothing else changes (sources, name, ownership), and the view itself is only
  read. Layers name sources in the Plan's terms, so each is translated to one of this analysis's sources or left out
  and listed here first; nothing is guessed.
-->
<script lang="ts">
  import { Button, Dialog } from '@nasa-jpl/stellar-svelte';
  import {
    analysisSourceBindings,
    readViewForTimelineImport,
    replaceAnalysisTimeline,
    type ViewForTimelineImport,
  } from '../../stores/analysis';
  import { initialViewsLoading, view, views } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { DataGridColumnDef, RowId } from '../../types/data-grid';
  import type { ViewSlim } from '../../types/view';
  import {
    countUnboundLayers,
    getUnboundLayerOptions,
    importViewTimeline,
    type OmittedLayer,
    type ViewImportChoices,
  } from '../../utilities/analysisViewImport';
  import { showSuccessToast } from '../../utilities/toast';
  import DataGrid from '../ui/DataGrid/DataGrid.svelte';

  export let open: boolean = false;
  /** Names of this analysis's sources, by binding id. */
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const columnDefs: DataGridColumnDef<ViewSlim>[] = [
    { field: 'name', filter: 'text', headerName: 'Name', resizable: true, sortable: true },
    { field: 'owner', filter: 'text', headerName: 'Owner', resizable: true, sortable: true, width: 120 },
    {
      field: 'updated_at',
      filter: 'text',
      headerName: 'Last Edited',
      resizable: true,
      sortable: true,
      valueFormatter: ({ value }: { value: string | null }) => (value ? value.slice(0, 16).replace('T', ' ') : ''),
      width: 150,
    },
  ];

  let choices: ViewImportChoices = { activitySourceId: null, resourceSourceId: null };
  let filter: string = '';
  let loaded: ViewForTimelineImport | null = null;
  let loading: boolean = false;
  let selectedViewId: RowId | null = null;
  let timelineIndex: number = 0;

  $: if (!open) {
    reset();
  }
  $: bindings = $analysisSourceBindings;
  $: options = getUnboundLayerOptions(bindings);
  $: analysisTimeline = $view?.definition.plan.timelines[0];
  $: currentRows = analysisTimeline?.rows.length ?? 0;
  $: source = loaded?.timelines[timelineIndex] ?? null;
  $: unbound = source ? countUnboundLayers(source) : { activity: 0, resource: 0 };
  $: result =
    loaded && source
      ? importViewTimeline(source, analysisTimeline?.id ?? 0, bindings, loaded.planSources, choices)
      : null;
  $: layerTotal = source ? source.rows.reduce((total, row) => total + row.layers.length, 0) : 0;
  $: omittedByReason = groupByReason(result?.omitted ?? []);
  $: viewRows = $views.map(({ created_at, id, name, owner, updated_at }) => ({
    created_at,
    id,
    name,
    owner,
    updated_at,
  }));

  function reset() {
    filter = '';
    loaded = null;
    loading = false;
    selectedViewId = null;
    timelineIndex = 0;
  }

  function groupByReason(omitted: OmittedLayer[]): { layers: OmittedLayer[]; reason: string }[] {
    const byReason = new Map<string, OmittedLayer[]>();
    omitted.forEach(layer => byReason.set(layer.reason, [...(byReason.get(layer.reason) ?? []), layer]));
    return [...byReason.entries()].map(([reason, layers]) => ({ layers, reason }));
  }

  function describeLayers(layers: OmittedLayer[]): string {
    const rows = [...new Set(layers.map(({ row }) => `"${row}"`))];
    return `${layers.length} layer${layers.length === 1 ? '' : 's'} in ${rows.slice(0, 4).join(', ')}${rows.length > 4 ? `, and ${rows.length - 4} more` : ''}`;
  }

  async function choose(viewId: RowId | null) {
    if (viewId === null || loading) {
      return;
    }
    loading = true;
    const read = await readViewForTimelineImport(Number(viewId), user);
    loading = false;
    if (read) {
      loaded = read;
      timelineIndex = 0;
      choices = options.defaults;
    }
  }

  function load() {
    if (result && loaded && replaceAnalysisTimeline(result.timeline, user)) {
      const omitted = result.omitted.length;
      showSuccessToast(
        `Loaded the timeline of "${loaded.name}"${omitted ? `; ${omitted} layer${omitted === 1 ? '' : 's'} left out` : ''}`,
      );
      open = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[85vh] max-w-[680px] flex-col gap-3">
    <Dialog.Header>
      <Dialog.Title>Load Timeline from View</Dialog.Title>
      <Dialog.Description>
        Use the timeline of a saved view in this analysis. The view is not changed, and only its timeline is used.
      </Dialog.Description>
    </Dialog.Header>

    {#if !loaded}
      <input bind:value={filter} class="st-input w-full" placeholder="Filter views" aria-label="Filter views" />
      <div class="h-[320px]">
        <DataGrid
          bind:currentSelectedRowId={selectedViewId}
          {columnDefs}
          filterExpression={filter}
          loading={$initialViewsLoading}
          rowData={viewRows}
          rowSelection="single"
          noRowsOverlayText="No saved views"
          on:rowDoubleClicked={({ detail: { data } }) => choose(data.id)}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" on:click={() => (open = false)}>Cancel</Button>
        <Button disabled={selectedViewId === null || loading} on:click={() => choose(selectedViewId)}>
          {loading ? 'Reading…' : 'Next'}
        </Button>
      </Dialog.Footer>
    {:else if result && source}
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto text-xs">
        <div>
          Timeline of <span class="font-medium">"{loaded.name}"</span>: {source.rows.length}
          {source.rows.length === 1 ? 'row' : 'rows'}, {layerTotal}
          {layerTotal === 1 ? 'layer' : 'layers'}.
        </div>

        {#if currentRows}
          <div class="rounded border border-destructive/50 p-2" role="alert">
            This replaces the timeline this analysis has now ({currentRows}
            {currentRows === 1 ? 'row' : 'rows'}). Its sources, name and sharing stay as they are.
          </div>
        {/if}

        {#if loaded.timelines.length > 1}
          <label class="flex flex-col gap-1">
            <span>
              This view has {loaded.timelines.length} timelines; an analysis shows one. Load
            </span>
            <select class="st-select" bind:value={timelineIndex}>
              {#each loaded.timelines as timeline, index (timeline.id)}
                <option value={index}>
                  Timeline {index + 1} ({timeline.rows.length}
                  {timeline.rows.length === 1 ? 'row' : 'rows'})
                </option>
              {/each}
            </select>
          </label>
        {/if}

        {#if unbound.activity}
          <label class="flex flex-col gap-1">
            <span>
              The view's activity layers ({unbound.activity}) show a plan's activities. In this analysis they read
            </span>
            <select class="st-select" bind:value={choices.activitySourceId}>
              <option value={null}>
                {options.activity.length ? 'Choose a source…' : 'No plan or simulation in this analysis'}
              </option>
              {#each options.activity as binding (binding.id)}
                <option value={binding.id}>{sourceLabels[binding.id] ?? binding.id}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if unbound.resource}
          <label class="flex flex-col gap-1">
            <span>
              The view's resource layers ({unbound.resource}) show a plan's simulation. In this analysis they read
            </span>
            <select class="st-select" bind:value={choices.resourceSourceId}>
              <option value={null}>
                {options.resource.length ? 'Choose a source…' : 'No simulation in this analysis'}
              </option>
              {#each options.resource as binding (binding.id)}
                <option value={binding.id}>{sourceLabels[binding.id] ?? binding.id}</option>
              {/each}
            </select>
          </label>
        {/if}

        <div>
          <span class="font-medium">{result.kept} of {layerTotal}</span>
          {layerTotal === 1 ? 'layer' : 'layers'} will be loaded.
        </div>
        {#if omittedByReason.length}
          <div class="rounded border p-2" role="status">
            <div class="mb-1 font-medium">Left out ({result.omitted.length})</div>
            <ul class="flex flex-col gap-1">
              {#each omittedByReason as { layers, reason } (reason)}
                <li>
                  {reason}.
                  <span class="text-muted-foreground">{describeLayers(layers)}.</span>
                </li>
              {/each}
            </ul>
            <div class="mt-1 text-muted-foreground">
              Add the missing sources to this analysis first and load the view again to include them.
            </div>
          </div>
        {/if}
      </div>
      <Dialog.Footer>
        <Button variant="outline" on:click={() => (loaded = null)}>Back</Button>
        <Button variant={currentRows ? 'destructive' : 'default'} on:click={load}>
          {currentRows ? 'Replace Timeline' : 'Load Timeline'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
