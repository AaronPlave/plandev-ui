<svelte:options immutable={true} />

<!--
  Imported sources outside any analysis: one row per logical source, and the chosen source's revisions below it.
  Import a new source or revision (in a dialog), analyze a revision, rename or delete a source, delete a revision.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { Button, Dialog } from '@nasa-jpl/stellar-svelte';
  import type { ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
  import Nav from '../../components/app/Nav.svelte';
  import PageTitle from '../../components/app/PageTitle.svelte';
  import SourceImportForm from '../../components/sources/SourceImportForm.svelte';
  import CssGrid from '../../components/ui/CssGrid.svelte';
  import DataGrid from '../../components/ui/DataGrid/DataGrid.svelte';
  import DataGridActions from '../../components/ui/DataGrid/DataGridActions.svelte';
  import Panel from '../../components/ui/Panel.svelte';
  import SectionTitle from '../../components/ui/SectionTitle.svelte';
  import { analyzeRevision } from '../../stores/analysis';
  import { analysisSourceUsage, sources } from '../../stores/sources';
  import { getUserStore } from '../../stores/user';
  import type { SourceLibraryEntry } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { DataGridColumnDef, RowId } from '../../types/data-grid';
  import { getSourceUsage } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { queryPermissions } from '../../utilities/permissions';
  import { getRevisionRows, getSourceRows, type RevisionRow, type SourceRow } from '../../utilities/sources';

  const user = getUserStore();
  const sourcesLoading = sources.loading;

  let filter: string = '';
  /** The source whose revisions are shown. Kept across subscription updates: rows are identified by source id. */
  let selectedRowId: RowId | null = null;
  /** The source the import dialog adds a revision to; null for a new source. */
  let importInto: number | null = null;
  let importOpen: boolean = false;
  let renaming: SourceLibraryEntry | null = null;
  let renameValue: string = '';

  $: sourceRows = getSourceRows($sources ?? [], $analysisSourceUsage ?? []);
  $: selected = ($sources ?? []).find(({ id }) => id === selectedRowId);
  $: forgetDeletedSource($sources, $sourcesLoading);
  $: revisionRows = getRevisionRows(selected, $analysisSourceUsage ?? []);
  // An admin may import a revision into any source, anyone else into their own (what Hasura allows).
  $: importableSources = ($sources ?? []).filter(source => queryPermissions.CREATE_SOURCE_REVISION($user, source));

  /** A deleted source can no longer be the one shown. */
  function forgetDeletedSource(current: SourceLibraryEntry[] | null, loading: boolean) {
    if (selectedRowId !== null && !loading && current && !current.some(({ id }) => id === selectedRowId)) {
      selectedRowId = null;
    }
  }

  type ActionsParams<T> = ICellRendererParams<T> & {
    analyze: (row: T) => void;
    canAnalyze: (row: T) => boolean;
    canDelete: (row: T) => boolean;
    canEdit: (row: T) => boolean;
    deleteRow: (row: T) => void;
    editRow?: (row: T) => void;
  };

  /** The standard row actions: Analyze (the open button), Rename (edit) and Delete. */
  function renderActions<T extends SourceRow | RevisionRow>(params: ActionsParams<T>, labels: string) {
    const actions = document.createElement('div');
    actions.className = 'actions-cell';
    const row = params.data as T;
    new DataGridActions({
      props: {
        deleteCallback: params.deleteRow,
        deleteTooltip: { content: `Delete ${labels}`, placement: 'bottom' },
        ...(params.editRow
          ? {
              editCallback: params.editRow,
              editTooltip: { content: `Rename ${labels}`, placement: 'bottom' },
              hasEditPermission: row ? params.canEdit(row) : false,
            }
          : {}),
        hasDeletePermission: row ? params.canDelete(row) : false,
        rowData: row,
        ...(row && params.canAnalyze(row)
          ? {
              viewCallback: params.analyze,
              viewTooltip: {
                content: labels === 'Source' ? 'Analyze the latest revision' : 'Analyze this revision',
                placement: 'bottom',
              },
            }
          : {}),
      },
      target: actions,
    });
    return actions;
  }

  // Both grids' actions are cell renderers without a field, redrawn when their rows change.
  const sourceRefreshColumns = ['actions'] as unknown as (keyof SourceRow)[];
  const revisionRefreshColumns = ['actions'] as unknown as (keyof RevisionRow)[];

  const actionColumn = { cellClass: 'action-cell-container', headerName: '', resizable: false, sortable: false };

  // Built again only when the user changes (what they may do shows in the actions); the actions themselves read the
  // current sources when clicked, so a subscription update never rebuilds the columns.
  $: sourceColumnDefs = getSourceColumnDefs($user);
  $: revisionColumnDefs = getRevisionColumnDefs($user);

  function getSourceColumnDefs(user: User | null): DataGridColumnDef<SourceRow>[] {
    return [
      {
        field: 'name',
        filter: 'text',
        headerName: 'Source',
        minWidth: 160,
        resizable: true,
        sortable: true,
        tooltipField: 'name',
      },
      {
        field: 'latest',
        filter: 'text',
        headerName: 'Latest Revision',
        minWidth: 160,
        resizable: true,
        sortable: true,
      },
      { field: 'status', filter: 'text', headerName: 'Status', minWidth: 150, resizable: true, sortable: true },
      {
        field: 'revisions',
        filter: 'number',
        headerName: 'Revisions',
        resizable: true,
        sortable: true,
        suppressSizeToFit: true,
        width: 100,
      },
      {
        field: 'analyses',
        filter: 'number',
        headerName: 'Used By',
        headerTooltip: 'Analyses that use any revision of the source',
        resizable: true,
        sortable: true,
        suppressSizeToFit: true,
        width: 90,
      },
      { field: 'owner', filter: 'text', headerName: 'Owner', minWidth: 100, resizable: true, sortable: true },
      {
        ...actionColumn,
        cellRenderer: (params: ActionsParams<SourceRow>) => renderActions(params, 'Source'),
        cellRendererParams: {
          analyze: (row: SourceRow) => analyzeLatest(row.source),
          canAnalyze: (row: SourceRow) => row.latest !== '—',
          canDelete: (row: SourceRow) => queryPermissions.DELETE_SOURCE(user, row.source),
          canEdit: (row: SourceRow) => queryPermissions.UPDATE_SOURCE(user, row.source),
          deleteRow: (row: SourceRow) =>
            effects.deleteSource(row.source, getSourceUsage(row.source, $analysisSourceUsage ?? []), user),
          editRow: (row: SourceRow) => {
            renaming = row.source;
            renameValue = row.source.name;
          },
        },
        colId: 'actions',
        suppressAutoSize: true,
        suppressSizeToFit: true,
        width: 110,
      },
    ];
  }

  function getRevisionColumnDefs(user: User | null): DataGridColumnDef<RevisionRow>[] {
    return [
      {
        field: 'version',
        filter: 'text',
        headerName: 'Revision',
        minWidth: 180,
        resizable: true,
        sortable: true,
        valueGetter: ({ data }) => (data ? `${data.version}${data.isLatest ? ' · latest' : ''}` : ''),
      },
      { field: 'status', filter: 'text', headerName: 'Status', minWidth: 130, resizable: true, sortable: true },
      { ...numberColumn('activities', 'Activities') },
      { ...numberColumn('resources', 'Resources') },
      { field: 'coverage', filter: 'text', headerName: 'Coverage', minWidth: 170, resizable: true, sortable: true },
      { ...wrappedColumn('file', 'File', 160) },
      { field: 'adapter', filter: 'text', headerName: 'Adapter', minWidth: 110, resizable: true, sortable: true },
      {
        field: 'requestedBy',
        filter: 'text',
        headerName: 'Requested By',
        minWidth: 110,
        resizable: true,
        sortable: true,
      },
      {
        autoHeight: true,
        cellClass: 'wrap-cell',
        cellRenderer: ({ data }: ICellRendererParams<RevisionRow>) => {
          const links = document.createElement('div');
          data?.analyses.forEach(analysis => {
            const link = document.createElement('a');
            link.href = `${base}/analyses/${analysis.id}`;
            link.textContent = analysis.name;
            link.className = 'underline';
            links.append(link, document.createTextNode(' '));
          });
          return links;
        },
        filter: 'text',
        headerName: 'Used By',
        headerTooltip: 'Analyses using this revision',
        minWidth: 140,
        resizable: true,
        sortable: true,
        valueGetter: ({ data }) => data?.analyses.map(({ name }) => name).join(', ') ?? '',
        wrapText: true,
      },
      { ...wrappedColumn('error', 'Error', 200) },
      {
        ...actionColumn,
        cellRenderer: (params: ActionsParams<RevisionRow>) => renderActions(params, 'Revision'),
        cellRendererParams: {
          analyze: (row: RevisionRow) => selected && analyze(selected, row.revision),
          canAnalyze: (row: RevisionRow) => row.revision.status === 'success',
          canDelete: (_row: RevisionRow) => !!selected && queryPermissions.DELETE_SOURCE_REVISION(user, selected),
          deleteRow: (row: RevisionRow) =>
            selected && effects.deleteSourceRevision(selected, row.id, row.analyses, user),
        },
        colId: 'actions',
        suppressAutoSize: true,
        suppressSizeToFit: true,
        width: 80,
      },
    ];
  }

  function numberColumn(field: 'activities' | 'resources', headerName: string): DataGridColumnDef<RevisionRow> {
    return {
      field,
      filter: 'number',
      headerName,
      minWidth: 100,
      resizable: true,
      sortable: true,
      valueFormatter: ({ value }: ValueFormatterParams<RevisionRow, number | null>) => value?.toLocaleString() ?? '',
    };
  }

  /** Long file names and errors wrap, and show whole on hover. */
  function wrappedColumn(
    field: 'error' | 'file',
    headerName: string,
    minWidth: number,
  ): DataGridColumnDef<RevisionRow> {
    return {
      autoHeight: true,
      cellClass: 'wrap-cell',
      field,
      filter: 'text',
      headerName,
      minWidth,
      resizable: true,
      sortable: true,
      tooltipField: field,
      wrapText: true,
    };
  }

  function openImport(sourceId: number | null) {
    importInto = sourceId;
    importOpen = true;
  }

  /** Opens your latest analysis of the revision, or makes one of it; `fresh` always makes a new one. */
  async function analyze(source: SourceLibraryEntry, revision: SourceLibraryEntry['revisions'][number], fresh = false) {
    const id = await analyzeRevision(
      source,
      { activityCount: revision.activity_types_aggregate.aggregate?.sum?.count ?? 0, ...revision },
      $user,
      { fresh },
    );
    if (id !== null) {
      goto(`${base}/analyses/${id}`);
    }
  }

  function analyzeLatest(source: SourceLibraryEntry) {
    const latest = source.revisions.find(({ status }) => status === 'success');
    if (latest) {
      analyze(source, latest);
    }
  }

  async function rename() {
    const source = renaming;
    const name = renameValue.trim();
    renaming = null;
    if (source && name && name !== source.name) {
      await effects.renameSource(source, name, $user);
    }
  }
</script>

<PageTitle title="Imported Sources" />

<CssGrid rows="var(--nav-header-height) calc(100vh - var(--nav-header-height))">
  <Nav>
    <span slot="title">Imported Sources</span>
  </Nav>

  <Panel padBody={false}>
    <svelte:fragment slot="header">
      <SectionTitle>Imported Sources</SectionTitle>
      <input bind:value={filter} class="st-input w-64" placeholder="Filter" aria-label="Filter sources" />
      <Button
        size="xs"
        variant="outline"
        disabled={!queryPermissions.CREATE_SOURCE_REVISION($user)}
        on:click={() => openImport(null)}>Import Source</Button
      >
    </svelte:fragment>
    <svelte:fragment slot="body">
      <div class="flex h-full min-h-0 flex-col">
        <div class="min-h-[140px] flex-[3]">
          <DataGrid
            bind:currentSelectedRowId={selectedRowId}
            columnDefs={sourceColumnDefs}
            columnsToForceRefreshOnDataUpdate={sourceRefreshColumns}
            filterExpression={filter}
            loading={$sourcesLoading}
            noRowsOverlayText={filter.trim() ? 'No sources match' : 'No imported sources yet'}
            rowData={sourceRows}
            rowSelection="single"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2 border-y px-2 py-1">
          {#if selected}
            <SectionTitle>Revisions of "{selected.name}"</SectionTitle>
            <Button
              size="xs"
              variant="outline"
              disabled={!queryPermissions.CREATE_SOURCE_REVISION($user, selected)}
              on:click={() => openImport(selected?.id ?? null)}>Import revision</Button
            >
          {:else}
            <SectionTitle>Revisions</SectionTitle>
          {/if}
        </div>
        <div class="min-h-[120px] flex-[2]">
          {#if selected}
            <DataGrid
              columnDefs={revisionColumnDefs}
              columnsToForceRefreshOnDataUpdate={revisionRefreshColumns}
              noRowsOverlayText="This source has no revisions"
              rowData={revisionRows}
            />
          {:else}
            <div class="st-typography-label p-2 text-muted-foreground">
              Select a source to see its revisions, who uses them, and to import or delete one.
            </div>
          {/if}
        </div>
      </div>
    </svelte:fragment>
  </Panel>
</CssGrid>

<Dialog.Root bind:open={importOpen}>
  <Dialog.Content class="max-w-[520px]">
    <Dialog.Header>
      <Dialog.Title>
        {importInto === null
          ? 'Import Source'
          : `Import a revision of ${$sources?.find(s => s.id === importInto)?.name}`}
      </Dialog.Title>
    </Dialog.Header>
    {#if importOpen}
      <SourceImportForm
        {importableSources}
        sourceId={importInto}
        user={$user}
        on:imported={() => (importOpen = false)}
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={renaming !== null} onOpenChange={open => !open && (renaming = null)}>
  <Dialog.Content class="max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title>Rename Source</Dialog.Title>
    </Dialog.Header>
    <form class="flex flex-col gap-3" on:submit|preventDefault={rename}>
      <input bind:value={renameValue} class="st-input w-full" aria-label="Source name" />
      <Dialog.Footer>
        <Button type="button" variant="outline" on:click={() => (renaming = null)}>Cancel</Button>
        <Button type="submit" disabled={!renameValue.trim()}>Rename</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.wrap-cell) {
    line-height: 1.4;
    overflow-wrap: anywhere;
    padding-block: 6px;
  }
</style>
