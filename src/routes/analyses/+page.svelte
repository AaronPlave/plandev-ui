<svelte:options immutable={true} />

<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { Button, Input } from '@nasa-jpl/stellar-svelte';
  import Nav from '../../components/app/Nav.svelte';
  import PageTitle from '../../components/app/PageTitle.svelte';
  import CssGrid from '../../components/ui/CssGrid.svelte';
  import Panel from '../../components/ui/Panel.svelte';
  import SectionTitle from '../../components/ui/SectionTitle.svelte';
  import { analyses } from '../../stores/analysis';
  import { getUserStore } from '../../stores/user';
  import { createAnalysisDefinition } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { featurePermissions } from '../../utilities/permissions';

  const user = getUserStore();
  const analysesLoading = analyses.loading;

  let name: string = '';
  let creating: boolean = false;

  $: canCreate = $user !== null && featurePermissions.analysis.canCreate($user);

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
      </svelte:fragment>
      <svelte:fragment slot="body">
        {#if $analysesLoading}
          <div class="st-typography-label text-muted-foreground">Loading…</div>
        {:else if !$analyses?.length}
          <div class="st-typography-label text-muted-foreground">No analyses yet</div>
        {:else}
          <table class="analyses" aria-label="Analyses">
            <thead>
              <tr><th>Name</th><th>Owner</th><th>Updated</th><th /></tr>
            </thead>
            <tbody>
              {#each $analyses as item (item.id)}
                <tr>
                  <td><a href="{base}/analyses/{item.id}">{item.name}</a></td>
                  <td>{item.owner ?? ''}</td>
                  <td>{new Date(item.updated_at).toLocaleString()}</td>
                  <td>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={$user === null || !featurePermissions.analysis.canDelete($user, item)}
                      on:click={() => effects.deleteAnalysis(item, $user)}>Delete</Button
                    >
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </svelte:fragment>
    </Panel>
  </CssGrid>
</CssGrid>

<style>
  .analyses {
    border-collapse: collapse;
    width: 100%;
  }

  .analyses th,
  .analyses td {
    border-bottom: 1px solid var(--st-gray-20);
    font-size: 13px;
    padding: 6px 8px;
    text-align: left;
  }
</style>
