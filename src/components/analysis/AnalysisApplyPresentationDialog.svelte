<svelte:options immutable={true} />

<!--
  Using another analysis's layout (its rows, sections, layers, axes, styles, value guides) on this analysis's data.
  Applying another analysis's presentation (its timeline: rows, sections, layers, axes, styles, value guides) to this
  analysis's data. Each source the presentation's layers read is a role, mapped here to one of this analysis's
  sources; only the very same data is mapped for the person. Then review: what is kept, what is left out and why, what
  to check. The other analysis is only read; this analysis's sources are not changed. Its notes never come across:
  they are findings about its own data.
-->
<script lang="ts">
  import { Button, Dialog } from '@nasa-jpl/stellar-svelte';
  import {
    analyses,
    analysis,
    analysisSimulationDatasets,
    analysisSimulationTypeCounts,
    analysisSourceBindings,
    analysisSourceRevisions,
    readAnalysisPresentation,
    replaceAnalysisTimeline,
    type AnalysisPresentation,
  } from '../../stores/analysis';
  import { view } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { DataGridColumnDef, RowId } from '../../types/data-grid';
  import type { AnalysisSlim } from '../../types/analysis';
  import {
    applyPresentation,
    getInitialRoleMapping,
    getPresentationRoles,
    getResourceRenameKey,
    getSourceCatalog,
    type PresentationIssue,
    type RoleMapping,
  } from '../../utilities/analysisPresentation';
  import { showSuccessToast } from '../../utilities/toast';
  import DataGrid from '../ui/DataGrid/DataGrid.svelte';

  export let open: boolean = false;
  /** Names of this analysis's sources, by binding id. */
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const columnDefs: DataGridColumnDef<AnalysisSlim>[] = [
    { field: 'name', filter: 'text', headerName: 'Analysis', resizable: true, sortable: true },
    { field: 'owner', filter: 'text', headerName: 'Owner', resizable: true, sortable: true, width: 110 },
    {
      field: 'updated_at',
      headerName: 'Last Edited',
      resizable: true,
      sortable: true,
      valueFormatter: ({ value }: { value: string | null }) => (value ? value.slice(0, 16).replace('T', ' ') : ''),
      width: 140,
    },
  ];

  let filter: string = '';
  let includeTimeGuides: boolean = false;
  let loaded: AnalysisPresentation | null = null;
  let loading: boolean = false;
  let mapping: RoleMapping = {};
  let resourceRenames: Record<string, string> = {};
  let selectedId: RowId | null = null;

  $: if (!open) {
    reset();
  }
  $: targets = $analysisSourceBindings;
  $: targetCatalogs = Object.fromEntries(
    targets.map(binding => [
      binding.id,
      getSourceCatalog(binding, $analysisSourceRevisions, $analysisSimulationDatasets, $analysisSimulationTypeCounts),
    ]),
  );
  $: current = $view?.definition.plan.timelines[0];
  $: roles = loaded ? getPresentationRoles(loaded.timeline, loaded.bindings) : [];
  $: result =
    loaded && current
      ? applyPresentation(loaded.timeline, current, loaded.catalogs, targetCatalogs, sourceLabels, {
          includeTimeGuides,
          mapping,
          resourceRenames,
        })
      : null;
  $: omitted = result?.issues.filter(issue => issue.effect === 'omitted') ?? [];
  $: missingResources = uniqueMissing(omitted);
  $: rowStatuses = loaded && result ? getRowStatuses(loaded, result.issues) : [];
  $: rows = ($analyses ?? []).filter(({ id }) => id !== $analysis?.id);
  $: timeGuideCount = loaded?.timeline.verticalGuides.length ?? 0;

  type RowStatus = { id: number; name: string; notes: string[]; status: 'check' | 'hidden' | 'partial' | 'shown' };

  /** Each row of the layout, and whether it will show here: fully, in part, with something to check, or not at all. */
  function getRowStatuses(from: AnalysisPresentation, issues: PresentationIssue[]): RowStatus[] {
    return from.timeline.rows.map(row => {
      const own = issues.filter(issue => issue.rowId === row.id);
      const left = own.filter(issue => issue.effect === 'omitted').length;
      const status =
        row.layers.length && left === row.layers.length
          ? 'hidden'
          : left
            ? 'partial'
            : own.length
              ? 'check'
              : 'shown';
      return {
        id: row.id,
        name: row.name,
        notes: [...new Set(own.map(issue => (row.layers.length > 1 ? `${issue.layer}: ${issue.reason}` : issue.reason)))],
        status,
      };
    });
  }

  const statusLabels: Record<RowStatus['status'], string> = {
    check: 'Shown, check',
    hidden: 'Not shown',
    partial: 'Partly shown',
    shown: 'Shown',
  };

  function reset() {    filter = '';
    includeTimeGuides = false;
    loaded = null;
    loading = false;
    mapping = {};
    resourceRenames = {};
    selectedId = null;
  }

  function uniqueMissing(issues: PresentationIssue[]) {
    const seen = new Map<string, NonNullable<PresentationIssue['missingResource']>>();
    issues.forEach(({ missingResource }) => {
      if (missingResource) {
        seen.set(getResourceRenameKey(missingResource.roleId, missingResource.name), missingResource);
      }
    });
    return [...seen.entries()].map(([key, resource]) => ({ key, ...resource }));
  }

  /** Resources of the mapped target that could stand in for a missing one: the same value type only. */
  function renameOptions(roleId: string, type: string | null): string[] {
    const target = mapping[roleId];
    const resources = target ? targetCatalogs[target]?.resources : null;
    return resources
      ? [...resources.entries()].filter(([, r]) => type === null || r.type === type).map(([name]) => name).sort()
      : [];
  }

  async function choose(id: RowId | null) {
    if (id === null || loading) {
      return;
    }
    loading = true;
    const read = await readAnalysisPresentation(Number(id), user);
    loading = false;
    if (read) {
      loaded = read;
      mapping = getInitialRoleMapping(getPresentationRoles(read.timeline, read.bindings), targets);
      resourceRenames = {};
    }
  }

  function apply() {
    if (loaded && result && replaceAnalysisTimeline(result.timeline, user)) {
      showSuccessToast(
        `Used the layout of "${loaded.name}": ${result.kept} of ${result.total} layers` +
          (omitted.length ? `, ${omitted.length} left out` : ''),
      );
      open = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[88vh] max-w-[760px] flex-col gap-3">
    <Dialog.Header>
      <Dialog.Title>Use Another Analysis's Layout</Dialog.Title>
      <Dialog.Description>
        Copy another analysis's rows, sections, axes and styles here, showing this analysis's data. The other
        analysis is not changed.
      </Dialog.Description>
    </Dialog.Header>

    {#if !loaded}
      <input bind:value={filter} class="st-input w-full" placeholder="Filter analyses" aria-label="Filter analyses" />
      <div class="h-[320px]">
        <DataGrid
          bind:currentSelectedRowId={selectedId}
          {columnDefs}
          filterExpression={filter}
          rowData={rows}
          rowSelection="single"
          noRowsOverlayText="No other analyses"
          on:rowDoubleClicked={({ detail: { data } }) => choose(data.id)}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" on:click={() => (open = false)}>Cancel</Button>
        <Button disabled={selectedId === null || loading} on:click={() => choose(selectedId)}>
          {loading ? 'Reading…' : 'Next'}
        </Button>
      </Dialog.Footer>
    {:else if result}
      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto text-xs">
        <section>
          <div class="mb-1 font-medium">1. Which data to show</div>
          <div class="mb-2 text-muted-foreground">
            "{loaded.name}" shows data from the sources on the left. Pick what to show from this analysis instead.
          </div>
          {#each roles as role (role.sourceId)}
            <label class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-0.5">
              <span class="truncate" title={loaded.names[role.sourceId]}>
                {loaded.names[role.sourceId] ?? (role.binding ? role.sourceId : 'a source it no longer has')}
              </span>
              <span class="text-muted-foreground">→</span>
              <select
                class="st-select w-full"
                value={mapping[role.sourceId] ?? ''}
                on:change={event => (mapping = { ...mapping, [role.sourceId]: event.currentTarget.value || null })}
              >
                <option value="">Don't show</option>
                {#each targets as target (target.id)}
                  <option value={target.id}>{sourceLabels[target.id] ?? target.id}</option>
                {/each}
              </select>
            </label>
          {/each}
          {#each missingResources as missing (missing.key)}
            <label class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-0.5">
              <span class="truncate text-muted-foreground" title={missing.name}>Resource {missing.name} is not there</span>
              <span class="text-muted-foreground">→</span>
              <select
                class="st-select w-full"
                value={resourceRenames[missing.key] ?? ''}
                on:change={event => {
                  const { [missing.key]: _, ...rest } = resourceRenames;
                  resourceRenames = event.currentTarget.value ? { ...rest, [missing.key]: event.currentTarget.value } : rest;
                }}
              >
                <option value="">Don't show</option>
                {#each renameOptions(missing.roleId, missing.type) as name}
                  <option value={name}>Use {name}</option>
                {/each}
              </select>
            </label>
          {/each}
        </section>

        <section>
          <div class="mb-1 font-medium">2. What you will get ({result.kept} of {result.total} layers)</div>
          <ul class="flex flex-col">
            {#each rowStatuses as row (row.id)}
              <li class="border-t py-1">
                <div class="flex justify-between gap-2">
                  <span class:text-muted-foreground={row.status === 'hidden'}>{row.name}</span>
                  <span
                    class:text-muted-foreground={row.status === 'hidden'}
                    class:text-amber-700={row.status === 'check' || row.status === 'partial'}
                  >
                    {statusLabels[row.status]}
                  </span>
                </div>
                {#each row.notes as note}
                  <div class="text-muted-foreground">{note}</div>
                {/each}
              </li>
            {/each}
          </ul>
        </section>

        <section class="flex flex-col gap-1 text-muted-foreground">
          {#if timeGuideCount}
            <label class="flex items-center gap-2">
              <input type="checkbox" bind:checked={includeTimeGuides} />
              Also bring its {timeGuideCount} time guide{timeGuideCount === 1 ? '' : 's'} (they mark times in its data)
            </label>
          {/if}
          <div>
            Notes{loaded.noteCount ? ` (${loaded.noteCount})` : ''} stay with "{loaded.name}". This analysis keeps its
            sources and notes{current?.rows.length ? `; its ${current.rows.length} current rows are replaced` : ''}.
          </div>
        </section>
      </div>
      <Dialog.Footer>
        <Button variant="outline" on:click={() => (loaded = null)}>Back</Button>
        <Button disabled={result.kept === 0} on:click={apply}>
          {current?.rows.length ? 'Replace Rows' : 'Use Layout'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
