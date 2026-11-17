<svelte:options immutable={true} />

<!--
  Add Source: choose what this analysis reads, and take it away again, in one place. Sources lists each imported source
  once (its newest usable revision); selecting one lists its revisions, each added or removed on its own, so another
  revision is always an explicit choice and never silently replaces the one added. Plans lists each plan's current
  directives (live) and its simulations, each added or removed on its own. Import makes a new source (or a new revision)
  from a file and adds it when it succeeds. Removing only detaches from this analysis: the data is not deleted, and the
  usual warning says which rows read it.
-->
<script lang="ts">
  import { Button, Dialog, Input, Tabs } from '@nasa-jpl/stellar-svelte';
  import type { ICellRendererParams } from 'ag-grid-community';
  import { createEventDispatcher } from 'svelte';
  import {
    addAnalysisSourceWhenImported,
    dismissAnalysisImport,
    pendingAnalysisImports,
    removeAnalysisSource,
    retryAnalysisImport,
  } from '../../stores/analysis';
  import type { AnalysisSourceBinding, AnalysisSourceOptions, AnalysisSourceTarget } from '../../types/analysis';
  import type { User, UserId } from '../../types/app';
  import type { DataGridColumnDef, RowId } from '../../types/data-grid';
  import {
    formatRange,
    formatRequestTime,
    getRevisionSummary,
    getRevisionVersionLabel,
    isSameAnalysisSource,
    splitSourceRevisions,
  } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { queryPermissions } from '../../utilities/permissions';
  import SourceImportForm from '../sources/SourceImportForm.svelte';
  import DataGrid from '../ui/DataGrid/DataGrid.svelte';
  import DataGridButtonAction from '../ui/DataGrid/DataGridButtonAction.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let open: boolean = false;
  export let tab: 'imported' | 'plans' | 'import' = 'imported';
  export let user: User | null;

  const dispatch = createEventDispatcher<{ add: AnalysisSourceTarget }>();

  type Revision = AnalysisSourceOptions['sources'][number]['revisions'][number];
  /** What a row's button does: add its data, remove the binding that reads it, or pick a revision first. */
  type RowAction =
    | { kind: 'add'; target: AnalysisSourceTarget }
    | { bindingId: string; kind: 'remove' }
    | { kind: 'choose' }
    | { kind: 'none'; label: string };
  type SourceRow = {
    action: RowAction;
    contents: string;
    coverage: string;
    id: number;
    name: string;
    status: string;
  };
  type RevisionRow = {
    action: RowAction;
    contents: string;
    coverage: string;
    id: number;
    status: string;
    version: string;
  };
  type PlanRow = { action: RowAction; data: string; id: string; plan: string; range: string; status: string };

  let options: AnalysisSourceOptions | null = null;
  let filter: string = '';
  let selectedSourceId: RowId | null = null;

  $: if (open) {
    load();
  } else {
    selectedSourceId = null;
  }
  $: sourceRows = (options?.sources ?? [])
    .filter(source => source.revisions.length)
    .map(source => getSourceRow(source, bindings));
  $: selectedSource = (options?.sources ?? []).find(({ id }) => id === selectedSourceId) ?? null;
  $: revisionRows = selectedSource
    ? selectedSource.revisions.map(revision => getRevisionRow(selectedSource!, revision, bindings))
    : [];
  $: planRows = (options?.plans ?? []).flatMap(plan => getPlanRows(plan, bindings));
  // The sources the user may add a revision to: an admin any, anyone else their own (as Hasura allows).
  $: importableSources = (options?.sources ?? []).filter(source =>
    queryPermissions.CREATE_SOURCE_REVISION(user, source),
  );

  const actionColumn: DataGridColumnDef = {
    cellClass: 'action-cell-container',
    cellRenderer: (params: ICellRendererParams<{ action: RowAction; id: RowId }>) => {
      const div = document.createElement('div');
      const action = params.data?.action;
      if (action && action.kind !== 'none') {
        new DataGridButtonAction({
          props: {
            label: action.kind === 'add' ? 'Add' : action.kind === 'remove' ? 'Remove' : 'Revisions…',
            onClick: () => params.data && run(action, params.data),
            title:
              action.kind === 'remove'
                ? 'Remove from this analysis (the data is not deleted)'
                : action.kind === 'choose'
                  ? 'Another revision of this source is in the analysis: choose which revisions to read'
                  : undefined,
            variant: action.kind === 'remove' ? 'ghost' : 'outline',
          },
          target: div,
        });
      } else if (action) {
        div.className = 'text-muted-foreground';
        div.textContent = action.label;
      }
      return div;
    },
    field: 'action',
    headerName: '',
    resizable: false,
    sortable: false,
    suppressAutoSize: true,
    suppressSizeToFit: true,
    width: 96,
  };
  const sourceColumns: DataGridColumnDef<SourceRow>[] = [
    { field: 'name', headerName: 'Name', resizable: true, sortable: true, tooltipField: 'name', width: 200 },
    { field: 'contents', headerName: 'Contents', resizable: true, tooltipField: 'contents' },
    { field: 'coverage', headerName: 'Time coverage', resizable: true, width: 170 },
    { field: 'status', headerName: 'Revision', resizable: true, sortable: true, tooltipField: 'status', width: 170 },
    actionColumn,
  ];
  const revisionColumns: DataGridColumnDef<RevisionRow>[] = [
    { field: 'version', headerName: 'Revision', resizable: true, tooltipField: 'version', width: 220 },
    { field: 'contents', headerName: 'Contents', resizable: true, tooltipField: 'contents' },
    { field: 'coverage', headerName: 'Time coverage', resizable: true, width: 170 },
    { field: 'status', headerName: 'Status', resizable: true, width: 130 },
    actionColumn,
  ];
  const planColumns: DataGridColumnDef<PlanRow>[] = [
    { field: 'plan', headerName: 'Plan', resizable: true, tooltipField: 'plan', width: 200 },
    { field: 'data', headerName: 'Data', resizable: true },
    { field: 'range', headerName: 'Time range', resizable: true, width: 170 },
    { field: 'status', headerName: 'Status', resizable: true, width: 130 },
    actionColumn,
  ];

  async function load() {
    options = await effects.getAnalysisSourceOptions(user);
  }

  function bindingOf(current: AnalysisSourceBinding[], target: AnalysisSourceTarget) {
    return current.find(binding => isSameAnalysisSource(binding, target));
  }

  function toggleAction(current: AnalysisSourceBinding[], target: AnalysisSourceTarget): RowAction {
    const binding = bindingOf(current, target);
    return binding ? { bindingId: binding.id, kind: 'remove' } : { kind: 'add', target };
  }

  function importedTarget(source: { id: number; name: string }, revisionId: number): AnalysisSourceTarget {
    return { kind: 'imported', revisionId, sourceId: source.id, sourceName: source.name };
  }

  function getSourceRow(source: AnalysisSourceOptions['sources'][number], current: AnalysisSourceBinding[]): SourceRow {
    const { pending, usable } = splitSourceRevisions(source.revisions);
    const revisionIds = new Set(source.revisions.map(({ id }) => id));
    const attached = current.filter(b => b.kind === 'imported' && revisionIds.has(b.revisionId));
    const latestAttached = usable ? attached.some(b => b.kind === 'imported' && b.revisionId === usable.id) : false;
    const shown = usable ?? pending[0];
    let action: RowAction;
    let status: string;
    if (!usable) {
      action = { kind: 'none', label: pending[0]?.status === 'failed' ? 'Failed' : 'Importing' };
      status = pending[0] ? getRevisionSummary(pending[0]) : '';
    } else if (attached.length === 0) {
      action = { kind: 'add', target: importedTarget(source, usable.id) };
      status = `Latest · ${getRevisionVersionLabel(usable)}`;
    } else if (latestAttached && attached.length === 1) {
      action = { bindingId: attached[0].id, kind: 'remove' };
      status = 'Latest revision added';
    } else {
      action = { kind: 'choose' };
      status = latestAttached ? `${attached.length} revisions added` : `Older revision added · newer available`;
    }
    return {
      action,
      contents: usable ? getRevisionSummary(usable) : (shown?.error?.message ?? ''),
      coverage: usable ? formatRange(usable.coverage_start, usable.coverage_end) : '',
      id: source.id,
      name: source.name,
      status,
    };
  }

  function getRevisionRow(
    source: AnalysisSourceOptions['sources'][number],
    revision: Revision,
    current: AnalysisSourceBinding[],
  ): RevisionRow {
    const { usable } = splitSourceRevisions(source.revisions);
    const ready = revision.status === 'success';
    return {
      action: ready
        ? toggleAction(current, importedTarget(source, revision.id))
        : { kind: 'none', label: revision.status === 'failed' ? 'Failed' : 'Importing' },
      contents: ready ? getRevisionSummary(revision) : (revision.error?.message ?? getRevisionSummary(revision)),
      coverage: ready ? formatRange(revision.coverage_start, revision.coverage_end) : '',
      id: revision.id,
      status: !ready
        ? revision.status
        : bindingOf(current, importedTarget(source, revision.id))
          ? 'In this analysis'
          : revision.id === usable?.id
            ? 'Latest'
            : 'Older',
      version: ready ? getRevisionVersionLabel(revision) : formatRequestTime(revision),
    };
  }

  function getPlanRows(plan: AnalysisSourceOptions['plans'][number], current: AnalysisSourceBinding[]): PlanRow[] {
    const datasets = plan.simulations.flatMap(simulation => simulation.simulation_datasets).sort((a, b) => b.id - a.id);
    return [
      {
        action: toggleAction(current, { kind: 'plan', planId: plan.id }),
        data: 'Current directives',
        id: `plan:${plan.id}`,
        plan: plan.name,
        range: '',
        status: bindingOf(current, { kind: 'plan', planId: plan.id }) ? 'In this analysis' : 'Live (follows the plan)',
      },
      ...datasets.map(dataset => {
        const target: AnalysisSourceTarget = { kind: 'simulation', simulationDatasetId: dataset.id };
        return {
          action:
            dataset.status === 'success' || bindingOf(current, target)
              ? toggleAction(current, target)
              : ({ kind: 'none', label: dataset.status } as RowAction),
          data: `↳ Simulation ${dataset.id}`,
          id: `simulation:${dataset.id}`,
          plan: plan.name,
          range: formatRange(dataset.simulation_start_time, dataset.simulation_end_time),
          status: bindingOf(current, target) ? 'In this analysis' : dataset.status,
        };
      }),
    ];
  }

  async function run(action: RowAction, row: { id: RowId }) {
    if (action.kind === 'add') {
      dispatch('add', action.target);
    } else if (action.kind === 'remove') {
      await removeAnalysisSource(action.bindingId, user);
    } else if (action.kind === 'choose') {
      selectedSourceId = row.id;
    }
  }

  async function onImported({
    detail: { add: addIt, ...imported },
  }: CustomEvent<{
    adapter: string;
    add: boolean;
    file: File;
    owner: UserId | null;
    revisionId: number;
    sourceId: number;
  }>) {
    // Not added now: it can't be read until the import succeeds. The analysis adds it then.
    if (addIt) {
      addAnalysisSourceWhenImported(imported, user);
    }
    options = await effects.getAnalysisSourceOptions(user);
  }
</script>

<!-- Not closed by an outside click: Remove's confirmation is one, and the dialog stays for the next choice. -->
<Dialog.Root bind:open closeOnOutsideClick={false}>
  <Dialog.Content class="flex h-[80vh] max-h-[720px] max-w-[920px] flex-col gap-3">
    <Dialog.Header>
      <Dialog.Title>Add Source</Dialog.Title>
      <Dialog.Description>Choose data to add to this analysis, or import a new file.</Dialog.Description>
    </Dialog.Header>

    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex items-center gap-3">
        <Tabs.List class="h-8">
          <Tabs.Trigger value="imported" class="h-6 px-3 text-xs">Sources</Tabs.Trigger>
          <Tabs.Trigger value="plans" class="h-6 px-3 text-xs">Plans</Tabs.Trigger>
          <Tabs.Trigger value="import" class="h-6 px-3 text-xs">Import</Tabs.Trigger>
        </Tabs.List>
        {#if tab !== 'import'}
          <Input
            bind:value={filter}
            class="ml-auto w-64"
            sizeVariant="xs"
            placeholder={tab === 'plans' ? 'Filter plans' : 'Filter sources'}
            aria-label="Filter"
          />
        {/if}
      </div>

      {#if !options && tab !== 'import'}
        <div class="text-xs text-muted-foreground">Loading…</div>
      {:else if tab === 'imported'}
        <div class="flex min-h-0 flex-1 flex-col gap-2">
          <div class="min-h-[160px] flex-1">
            <DataGrid
              bind:currentSelectedRowId={selectedSourceId}
              columnDefs={sourceColumns}
              columnsToForceRefreshOnDataUpdate={['action', 'status']}
              filterExpression={filter}
              getRowId={row => row.id}
              rowData={sourceRows}
              rowHeight={30}
              rowSelection="single"
              noRowsOverlayText="No imported sources yet: use Import"
            />
          </div>
          {#if selectedSource}
            <div class="text-xs font-medium">Revisions of {selectedSource.name}</div>
            <div class="h-[160px]">
              <DataGrid
                columnDefs={revisionColumns}
                columnsToForceRefreshOnDataUpdate={['action', 'status']}
                getRowId={row => row.id}
                rowData={revisionRows}
                rowHeight={30}
                highlightOnSelection={false}
              />
            </div>
          {:else}
            <div class="text-xs text-muted-foreground">Select a source to see and choose among its revisions.</div>
          {/if}
        </div>
      {:else if tab === 'plans'}
        <div class="min-h-0 flex-1">
          <DataGrid
            columnDefs={planColumns}
            columnsToForceRefreshOnDataUpdate={['action', 'status']}
            filterExpression={filter}
            getRowId={row => row.id}
            rowData={planRows}
            rowHeight={30}
            highlightOnSelection={false}
            noRowsOverlayText="No plans"
          />
        </div>
      {:else}
        <div class="min-h-0 flex-1 overflow-auto text-xs">
          <SourceImportForm offerAdd {importableSources} {user} on:imported={onImported} />
          {#each $pendingAnalysisImports as imported (imported.revisionId)}
            <div class="import-status" role="status">
              {#if imported.status === 'importing'}
                <span class="min-w-0 break-words"
                  >Importing {imported.file.name}. It is added to this analysis when it succeeds, even if you close this
                  dialog.</span
                >
                <Button size="xs" variant="outline" on:click={() => dismissAnalysisImport(imported.revisionId)}
                  >Don't add</Button
                >
              {:else}
                <span class="min-w-0 break-words text-red-700"
                  >Importing {imported.file.name} failed: {imported.error}</span
                >
                <span class="flex shrink-0 gap-1">
                  <Button size="xs" variant="outline" on:click={() => retryAnalysisImport(imported, user)}
                    >Try again</Button
                  >
                  <Button size="xs" variant="outline" on:click={() => dismissAnalysisImport(imported.revisionId)}
                    >Dismiss</Button
                  >
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </Tabs.Root>
    <Dialog.Footer>
      <Button variant="outline" on:click={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .import-status {
    align-items: center;
    border-top: 1px solid var(--st-gray-20);
    display: flex;
    gap: 8px;
    justify-content: space-between;
    margin-top: 12px;
    padding-top: 8px;
  }
</style>
