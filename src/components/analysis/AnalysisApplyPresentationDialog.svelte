<svelte:options immutable={true} />

<!--
  Use a Layout: the one way to bring a prepared presentation (rows, sections, layers, axes, styles, value guides) to
  this analysis's data. A layout comes from a saved view (one saved from an analysis, or a Plan's view) or from another
  analysis. Choose it, confirm which of this analysis's sources each of its sources becomes (the same data and another
  revision of the same source are filled in, and said to be what they are), and use it. Problems are summed up in a
  line and listed only on request. The layout it came from is only read; this analysis keeps its sources, notes and
  time guides, and the replacement can be undone.

  A Plan's view is handed to the Plan-view loader (`planView`), which maps the Plan's own layers instead.
-->
<script lang="ts">
  import { Button, Dialog } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    analyses,
    analysis,
    analysisSimulationDatasets,
    analysisSimulationTypeCounts,
    analysisSourceBindings,
    analysisSourceRevisions,
    readAnalysisPresentation,
    readViewPresentation,
    replaceAnalysisTimeline,
    saveAnalysisLayoutAsView,
    type AnalysisPresentation,
  } from '../../stores/analysis';
  import { initialViewsLoading, view, views } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { DataGridColumnDef, RowId } from '../../types/data-grid';
  import {
    applyPresentation,
    getInitialRoleMapping,
    getPresentationRoles,
    getResourceRenameKey,
    getRoleMatch,
    getSourceCatalog,
    type PresentationIssue,
    type RoleMapping,
  } from '../../utilities/analysisPresentation';
  import { showSuccessToast } from '../../utilities/toast';
  import DataGrid from '../ui/DataGrid/DataGrid.svelte';

  /** 'save': open on saving this analysis's layout as a view. */
  export let mode: 'save' | 'use' = 'use';
  export let open: boolean = false;
  /** Names of this analysis's sources, by binding id. */
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{ planView: number }>();

  type Choice = {
    id: number;
    kind: 'analysis' | 'layout' | 'view';
    name: string;
    owner: string | null;
    updated_at: string;
  };

  const KIND_LABELS: Record<Choice['kind'], string> = {
    analysis: 'Analysis',
    layout: 'Saved layout',
    view: 'Plan view',
  };

  const columnDefs: DataGridColumnDef<Choice>[] = [
    { field: 'name', filter: 'text', headerName: 'Name', resizable: true, sortable: true },
    {
      field: 'kind',
      headerName: 'Kind',
      resizable: true,
      sortable: true,
      valueFormatter: ({ value }: { value: Choice['kind'] }) => KIND_LABELS[value],
      width: 110,
    },
    { field: 'owner', filter: 'text', headerName: 'Owner', resizable: true, sortable: true, width: 110 },
    {
      field: 'updated_at',
      headerName: 'Last Edited',
      resizable: true,
      sort: 'desc',
      sortable: true,
      valueFormatter: ({ value }: { value: string | null }) => (value ? value.slice(0, 10) : ''),
      width: 110,
    },
  ];

  let filter: string = '';
  let includeTimeGuides: boolean = false;
  let loaded: AnalysisPresentation | null = null;
  let loading: boolean = false;
  let mapping: RoleMapping = {};
  let resourceRenames: Record<string, string> = {};
  let saveName: string = '';
  let saving: boolean | null = null;
  let selectedId: RowId | null = null;
  let showDetails: boolean = false;

  $: if (!open) {
    reset();
  } else if (mode === 'save' && saving === null && !loaded) {
    saving = false;
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
  $: replaceable = uniqueMissing(result?.issues ?? []);
  $: rowStatuses = loaded && result ? getRowStatuses(loaded, result.issues) : [];
  $: counts = {
    attention: rowStatuses.filter(row => row.status === 'attention').length,
    ready: rowStatuses.filter(row => row.status === 'ready').length,
    unavailable: rowStatuses.filter(row => row.status === 'unavailable').length,
  };
  $: choices = [
    ...$views.map(
      ({ analysis_layout, id, name, owner, updated_at }): Choice => ({
        id,
        kind: analysis_layout ? 'layout' : 'view',
        name,
        owner,
        updated_at,
      }),
    ),
    ...($analyses ?? [])
      .filter(({ id }) => id !== $analysis?.id)
      .map(({ id, name, owner, updated_at }): Choice => ({ id, kind: 'analysis', name, owner, updated_at })),
  ];
  $: timeGuideCount = loaded?.timeline.verticalGuides.length ?? 0;
  $: currentRows = current?.rows.length ?? 0;

  type RowStatus = { id: number; name: string; notes: string[]; status: 'attention' | 'ready' | 'unavailable' };

  /** Each row of the layout: ready, shown with something to look at, or not shown at all. */
  function getRowStatuses(from: AnalysisPresentation, issues: PresentationIssue[]): RowStatus[] {
    return from.timeline.rows
      .filter(row => row.layers.length)
      .map(row => {
        const own = issues.filter(issue => issue.rowId === row.id);
        const left = own.filter(issue => issue.effect === 'omitted').length;
        return {
          id: row.id,
          name: row.name,
          notes: [
            ...new Set(own.map(issue => (row.layers.length > 1 ? `${issue.layer}: ${issue.reason}` : issue.reason))),
          ],
          status: left === row.layers.length ? 'unavailable' : own.length ? 'attention' : 'ready',
        };
      });
  }

  /** The grid's row id: views and analyses share numbers, so the kind is part of it. */
  function getChoiceId(choice: Choice): RowId {
    return `${choice.kind === 'analysis' ? 'analysis' : 'view'}:${choice.id}`;
  }

  function reset() {
    filter = '';
    includeTimeGuides = false;
    loaded = null;
    loading = false;
    mapping = {};
    resourceRenames = {};
    saveName = '';
    saving = null;
    selectedId = null;
    showDetails = false;
  }

  /** Resources the person can replace: missing ones, and ones of another type, each once. */
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
      ? [...resources.entries()]
          .filter(([, r]) => type === null || r.type === type)
          .map(([name]) => name)
          .sort()
      : [];
  }

  /** What the chosen source is to the layout's: said, so another revision is never silently taken as the same data. */
  function matchNote(roleId: string): string {
    const targetId = mapping[roleId];
    const role = roles.find(({ sourceId }) => sourceId === roleId);
    const target = targets.find(({ id }) => id === targetId);
    if (!role || !target) {
      return 'not shown';
    }
    const match = getRoleMatch(role, target);
    if (match === 'same') {
      return 'same data';
    }
    if (match === 'revision' && role.binding?.kind === 'imported' && target.kind === 'imported') {
      return `another revision (${target.revisionId > role.binding.revisionId ? 'newer' : 'older'})`;
    }
    return 'your choice';
  }

  async function choose(id: RowId | null) {
    if (id === null || loading) {
      return;
    }
    const [kind, number] = `${id}`.split(':');
    loading = true;
    const read =
      kind === 'view'
        ? await readViewPresentation(Number(number), user)
        : await readAnalysisPresentation(Number(number), user);
    loading = false;
    if (read === 'plan-view') {
      open = false;
      dispatch('planView', Number(number));
    } else if (read) {
      loaded = read;
      mapping = getInitialRoleMapping(getPresentationRoles(read.timeline, read.bindings), targets);
      resourceRenames = {};
    }
  }

  async function save() {
    saving = true;
    const id = await saveAnalysisLayoutAsView(saveName.trim(), user);
    saving = null;
    if (id !== null) {
      open = false;
    }
  }

  function apply() {
    if (
      loaded &&
      result &&
      replaceAnalysisTimeline(result.timeline, user, loaded.name, { dataless: result.total === 0 })
    ) {
      const left = result.total - result.kept;
      showSuccessToast(
        `Using the layout of "${loaded.name}"${left ? `; ${left} layer${left === 1 ? '' : 's'} left out` : ''}`,
      );
      open = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[88vh] max-w-[680px] flex-col gap-3">
    {#if saving !== null}
      <Dialog.Header>
        <Dialog.Title>Save This Layout as a View</Dialog.Title>
        <Dialog.Description>
          Its rows, sections, axes, styles and guides, to use in any analysis. Notes stay with this analysis.
        </Dialog.Description>
      </Dialog.Header>
      <input
        class="st-input w-full"
        placeholder="View name, e.g. DSN contact review"
        aria-label="View name"
        bind:value={saveName}
        on:keydown={event => event.key === 'Enter' && saveName.trim() && save()}
      />
      <Dialog.Footer>
        <Button variant="outline" on:click={() => (saving = null)}>Back</Button>
        <Button disabled={!saveName.trim() || saving} on:click={save}>{saving ? 'Saving…' : 'Save View'}</Button>
      </Dialog.Footer>
    {:else if !loaded}
      <Dialog.Header>
        <Dialog.Title>Use a Layout</Dialog.Title>
        <Dialog.Description
          >Show this analysis's data with a saved view or another analysis's layout.</Dialog.Description
        >
      </Dialog.Header>
      <input
        bind:value={filter}
        class="st-input w-full"
        placeholder="Filter by name or owner"
        aria-label="Filter layouts"
      />
      <!-- Enter on the grid does what Next does (Space or a click selects a row). -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="h-[300px]" on:keydown={event => event.key === 'Enter' && choose(selectedId)}>
        <DataGrid
          bind:currentSelectedRowId={selectedId}
          {columnDefs}
          filterExpression={filter}
          loading={$initialViewsLoading}
          getRowId={getChoiceId}
          rowData={choices}
          rowSelection="single"
          noRowsOverlayText="No saved views or other analyses"
          on:rowDoubleClicked={({ detail: { data } }) => choose(getChoiceId(data))}
        />
      </div>
      <Dialog.Footer class="sm:justify-between">
        <Button variant="ghost" disabled={!currentRows} on:click={() => (saving = false)}>
          Save this layout as a view…
        </Button>
        <div class="flex gap-2">
          <Button variant="outline" on:click={() => (open = false)}>Cancel</Button>
          <Button disabled={selectedId === null || loading} on:click={() => choose(selectedId)}>
            {loading ? 'Reading…' : 'Next'}
          </Button>
        </div>
      </Dialog.Footer>
    {:else if result}
      <Dialog.Header>
        <Dialog.Title>Use “{loaded.name}”</Dialog.Title>
        <Dialog.Description>
          {loaded.kind === 'view' ? 'A saved view' : 'Another analysis'}'s layout, showing this analysis's data. It is
          not changed.
        </Dialog.Description>
      </Dialog.Header>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto text-xs">
        <section aria-label="Data to show">
          {#each roles as role (role.sourceId)}
            {@const note = matchNote(role.sourceId)}
            <label class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-0.5">
              <span class="truncate" title={loaded.names[role.sourceId]}>
                {loaded.names[role.sourceId] ?? 'A source no longer available'}
              </span>
              <span class="text-muted-foreground">→</span>
              <span class="flex min-w-0 flex-col">
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
                <span class:text-amber-700={note.startsWith('another')} class="text-muted-foreground">{note}</span>
              </span>
            </label>
          {/each}
        </section>

        <section aria-label="What will show" class="rounded border p-2">
          <div class="flex items-center gap-2">
            <span class="font-medium">
              {counts.ready} row{counts.ready === 1 ? '' : 's'} ready{' '}{#if counts.attention}
                <span class="text-amber-700">
                  · {counts.attention} need{counts.attention === 1 ? 's' : ''} attention</span
                >
              {/if}{#if counts.unavailable}
                <span class="text-muted-foreground"> · {counts.unavailable} unavailable</span>
              {/if}
            </span>
            <span class="grow" />
            {#if counts.attention || counts.unavailable}
              <button class="text-[var(--st-utility-blue)]" on:click={() => (showDetails = !showDetails)}>
                {showDetails ? 'Hide' : 'Show'} details
              </button>
            {/if}
          </div>
          {#if showDetails}
            <ul class="mt-1 flex flex-col">
              {#each rowStatuses.filter(row => row.status !== 'ready') as row (row.id)}
                <li class="border-t py-1">
                  <span class:text-muted-foreground={row.status === 'unavailable'} class="font-medium">{row.name}</span>
                  <span class="text-muted-foreground">{row.status === 'unavailable' ? ' · not shown' : ''}</span>
                  {#each row.notes as note}
                    <div class="text-muted-foreground">{note}</div>
                  {/each}
                </li>
              {/each}
            </ul>
          {/if}
          {#each replaceable as missing (missing.key)}
            {@const options = renameOptions(missing.roleId, missing.type)}
            {#if options.length}
              <label class="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <span class="truncate" title={missing.name}>{missing.name} isn't available</span>
                <span class="text-muted-foreground">→</span>
                <select
                  class="st-select w-full"
                  value={resourceRenames[missing.key] ?? ''}
                  on:change={event => {
                    const { [missing.key]: _, ...rest } = resourceRenames;
                    resourceRenames = event.currentTarget.value
                      ? { ...rest, [missing.key]: event.currentTarget.value }
                      : rest;
                  }}
                >
                  <option value="">Leave it out</option>
                  {#each options as name}
                    <option value={name}>Use {name}</option>
                  {/each}
                </select>
              </label>
            {/if}
          {/each}
        </section>

        {#if timeGuideCount}
          <label class="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" bind:checked={includeTimeGuides} />
            Also bring its {timeGuideCount} time guide{timeGuideCount === 1 ? '' : 's'}: they mark times in its data,
            without their notes
          </label>
        {/if}
      </div>
      <div class="text-xs text-muted-foreground" role="note">
        {#if currentRows}
          Replaces this analysis's {currentRows} row{currentRows === 1 ? '' : 's'}; you can undo it.
        {/if}
        This analysis keeps its sources, notes and time guides.{loaded.noteCount
          ? ` The ${loaded.noteCount} note${loaded.noteCount === 1 ? '' : 's'} of "${loaded.name}" stay there.`
          : ''}
      </div>
      <Dialog.Footer>
        <Button variant="outline" on:click={() => (loaded = null)}>Back</Button>
        <!-- A layout with no data layers (rows, sections, guides only) is used as it is. -->
        <Button disabled={result.total > 0 && result.kept === 0} on:click={apply}>
          {currentRows ? `Replace Layout (${result.timeline.rows.length} rows)` : 'Use Layout'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
