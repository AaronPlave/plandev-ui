<svelte:options immutable={true} />

<!--
  The step of Use a Layout for a Plan's view (chosen there; this is not a separate way in). Review what comes across:
  the timeline replaces this analysis's timeline and nothing else changes (sources, name, ownership), and the view
  itself is only read. Layers name sources in the Plan's terms, so each is translated to one of this analysis's
  sources or left out and listed here first; nothing is guessed. Back returns to the layout list.
-->
<script lang="ts">
  import { Button, Dialog } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    analysisSourceBindings,
    readViewForTimelineImport,
    replaceAnalysisTimeline,
    type ViewForTimelineImport,
  } from '../../stores/analysis';
  import { view } from '../../stores/views';
  import type { User } from '../../types/app';
  import {
    countUnboundLayers,
    getUnboundLayerOptions,
    importViewTimeline,
    type OmittedLayer,
    type ViewImportChoices,
  } from '../../utilities/analysisViewImport';
  import { showSuccessToast } from '../../utilities/toast';

  export let open: boolean = false;
  /** The Plan view chosen in Use a Layout: read at once. */
  export let viewId: number | null = null;
  /** Names of this analysis's sources, by binding id. */
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{ back: void }>();

  let choices: ViewImportChoices = { activitySourceId: null, resourceSourceId: null };
  let loaded: ViewForTimelineImport | null = null;
  let loading: boolean = false;
  let timelineIndex: number = 0;

  $: if (!open) {
    reset();
  }
  $: if (open && viewId !== null && !loaded && !loading) {
    choose(viewId);
    viewId = null;
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

  function reset() {
    loaded = null;
    loading = false;
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

  async function choose(viewId: number) {
    loading = true;
    const read = await readViewForTimelineImport(viewId, user);
    loading = false;
    if (!read) {
      open = false;
    } else {
      loaded = read;
      timelineIndex = 0;
      choices = options.defaults;
    }
  }

  function load() {
    // The analysis keeps its own time guides (they are about its data); the view's come after them.
    const own = analysisTimeline?.verticalGuides ?? [];
    const firstId = Math.max(-1, ...own.map(({ id }) => id)) + 1;
    const timeline = result && {
      ...result.timeline,
      verticalGuides: [
        ...own,
        ...result.timeline.verticalGuides.map((guide, index) => ({ ...guide, id: firstId + index })),
      ],
    };
    if (result && timeline && loaded && replaceAnalysisTimeline(timeline, user, loaded.name)) {
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
      <Dialog.Title>Use a Plan View{loaded ? ` “${loaded.name}”` : ''}</Dialog.Title>
      <Dialog.Description>
        Its layers name a plan's data; choose which of this analysis's sources they read. The view is not changed.
      </Dialog.Description>
    </Dialog.Header>

    {#if !loaded}
      <div class="text-xs text-muted-foreground">Reading the view…</div>
    {:else if result && source}
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto text-xs">
        <div>
          Timeline of <span class="font-medium">"{loaded.name}"</span>: {source.rows.length}
          {source.rows.length === 1 ? 'row' : 'rows'}, {layerTotal}
          {layerTotal === 1 ? 'layer' : 'layers'}.
        </div>

        {#if currentRows}
          <div class="rounded border border-destructive/50 p-2" role="alert">
            This replaces the rows this analysis has now ({currentRows}); you can undo it. Its sources, notes, time
            guides, name and sharing stay as they are.
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
        {#if result.kept === 0}
          <div class="rounded border border-destructive/50 p-2" role="alert">
            None of this view's layers can be shown by this analysis's sources, so loading it would only empty the
            timeline. {currentRows ? 'The timeline is left as it is.' : ''} Add the sources it needs, or choose a source
            above, first.
          </div>
        {/if}
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
        <Button
          variant="outline"
          on:click={() => {
            open = false;
            dispatch('back');
          }}>Back</Button
        >
        <Button variant={currentRows ? 'destructive' : 'default'} disabled={result.kept === 0} on:click={load}>
          {currentRows ? 'Replace Timeline' : 'Load Timeline'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
