<svelte:options immutable={true} />

<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { Button, ContextMenu, Input } from '@nasa-jpl/stellar-svelte';
  import type { ICellRendererParams } from 'ag-grid-community';
  import AnalysisDuplicateDialog from '../../components/analysis/AnalysisDuplicateDialog.svelte';
  import Nav from '../../components/app/Nav.svelte';
  import PageTitle from '../../components/app/PageTitle.svelte';
  import CssGrid from '../../components/ui/CssGrid.svelte';
  import DataGridActions from '../../components/ui/DataGrid/DataGridActions.svelte';
  import SingleActionDataGrid from '../../components/ui/DataGrid/SingleActionDataGrid.svelte';
  import Panel from '../../components/ui/Panel.svelte';
  import SectionTitle from '../../components/ui/SectionTitle.svelte';
  import { analyses } from '../../stores/analysis';
  import { getUserStore } from '../../stores/user';
  import type { AnalysisSlim } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { DataGridColumnDef, RowId } from '../../types/data-grid';
  import { createAnalysisDefinition } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { featurePermissions } from '../../utilities/permissions';

  type CellRendererParams = ICellRendererParams<AnalysisSlim>;

  const user = getUserStore();
  const analysesLoading = analyses.loading;

  let name: string = '';
  let creating: boolean = false;
  let filterText: string = '';
  let duplicating: AnalysisSlim | null = null;

  $: canCreate = $user !== null && featurePermissions.analysis.canCreate($user);
  $: filtered = ($analyses ?? []).filter(item => {
    const needle = filterText.trim().toLowerCase();
    return !needle || item.name.toLowerCase().includes(needle) || (item.owner ?? '').toLowerCase().includes(needle);
  });
  $: columnDefs = [
    { field: 'id', headerName: 'ID', resizable: true, sortable: true, suppressAutoSize: true, width: 70 },
    { field: 'name', filter: 'text', headerName: 'Name', resizable: true, sortable: true },
    { field: 'owner', filter: 'text', headerName: 'Owner', resizable: true, sortable: true, width: 120 },
    {
      field: 'updated_at',
      headerName: 'Updated',
      resizable: true,
      sort: 'desc',
      sortable: true,
      valueFormatter: ({ value }: { value: string }) => new Date(value).toLocaleString(),
      width: 180,
    },
    {
      cellClass: 'action-cell-container',
      cellRenderer: (params: CellRendererParams) => {
        const div = document.createElement('div');
        div.className = 'actions-cell';
        new DataGridActions<AnalysisSlim>({
          props: {
            deleteCallback: item => effects.deleteAnalysis(item, $user),
            deleteTooltip: { content: 'Delete Analysis', placement: 'bottom' },
            duplicateCallback: item => (duplicating = item),
            duplicateTooltip: { content: 'Duplicate Analysis', placement: 'bottom' },
            hasDeletePermission: params.data ? canDelete($user, params.data) : false,
            hasDuplicatePermission: canCreate,
            rowData: params.data,
            viewCallback: item => goto(`${base}/analyses/${item.id}`),
            viewTooltip: { content: 'Open Analysis', placement: 'bottom' },
          },
          target: div,
        });
        return div;
      },
      field: 'actions',
      headerName: '',
      resizable: false,
      sortable: false,
      suppressAutoSize: true,
      suppressSizeToFit: true,
      width: 115,
    },
  ] as DataGridColumnDef<AnalysisSlim>[];

  function canDelete(of: User | null, item: AnalysisSlim): boolean {
    return of !== null && featurePermissions.analysis.canDelete(of, item);
  }

  function find(ids: RowId[]): AnalysisSlim | undefined {
    return ($analyses ?? []).find(({ id }) => id === ids[0]);
  }

  async function onCreate() {
    creating = true;
    const id = await effects.createAnalysis(name.trim(), createAnalysisDefinition(), $user);
    creating = false;
    if (id !== null) {
      goto(`${base}/analyses/${id}`);
    }
  }
</script>

<PageTitle title="Analyses" />

<CssGrid rows="var(--nav-header-height) calc(100vh - var(--nav-header-height))">
  <Nav>
    <span slot="title">Analyses</span>
  </Nav>

  <CssGrid columns="20% auto">
    <Panel borderRight>
      <svelte:fragment slot="header">
        <SectionTitle>New Analysis</SectionTitle>
      </svelte:fragment>
      <svelte:fragment slot="body">
        <form class="flex flex-col gap-2" on:submit|preventDefault={onCreate}>
          <label class="st-typography-label" for="analysis-name">Name</label>
          <Input id="analysis-name" bind:value={name} placeholder="Tour Comparison" sizeVariant="xs" />
          <p class="st-typography-body text-muted-foreground">
            An analysis brings together imported sources, plans and their simulations. To analyze one plan, use Analyze
            in its plan menu.
          </p>
          <Button type="submit" size="sm" disabled={!canCreate || !name.trim() || creating}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </form>
      </svelte:fragment>
    </Panel>

    <Panel>
      <svelte:fragment slot="header">
        <SectionTitle>Analyses</SectionTitle>
        <Input
          bind:value={filterText}
          class="w-64"
          sizeVariant="xs"
          placeholder="Filter analyses"
          aria-label="Filter analyses"
        />
      </svelte:fragment>
      <svelte:fragment slot="body">
        <SingleActionDataGrid
          showLoadingSkeleton
          loading={$analysesLoading}
          {columnDefs}
          hasDeletePermission={canDelete}
          itemDisplayText="Analysis"
          items={filtered}
          noRowsOverlayText="No analyses yet"
          user={$user}
          on:deleteItem={({ detail }) => {
            const item = find(detail);
            if (item) {
              effects.deleteAnalysis(item, $user);
            }
          }}
          on:rowDoubleClicked={({ detail }) => goto(`${base}/analyses/${detail.data.id}`)}
        >
          <svelte:fragment slot="context-menu" let:selectedItemId>
            <ContextMenu.Item size="sm" on:click={() => goto(`${base}/analyses/${selectedItemId}`)}
              >Open</ContextMenu.Item
            >
            <ContextMenu.Item
              size="sm"
              disabled={!canCreate}
              on:click={() => (duplicating = find(selectedItemId === null ? [] : [selectedItemId]) ?? null)}
              >Duplicate…</ContextMenu.Item
            >
          </svelte:fragment>
        </SingleActionDataGrid>
      </svelte:fragment>
    </Panel>
  </CssGrid>
</CssGrid>

<AnalysisDuplicateDialog bind:analysis={duplicating} user={$user} />
