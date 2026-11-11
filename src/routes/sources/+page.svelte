<svelte:options immutable={true} />

<!--
  Imported sources outside any analysis: find one, see its revisions and where they are used, import a new
  source or revision (in a dialog), rename or delete it.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Badge, Button, Dialog } from '@nasa-jpl/stellar-svelte';
  import Nav from '../../components/app/Nav.svelte';
  import PageTitle from '../../components/app/PageTitle.svelte';
  import SourceImportForm from '../../components/sources/SourceImportForm.svelte';
  import CssGrid from '../../components/ui/CssGrid.svelte';
  import Panel from '../../components/ui/Panel.svelte';
  import SectionTitle from '../../components/ui/SectionTitle.svelte';
  import { analysisSourceUsage, sources } from '../../stores/sources';
  import { getUserStore } from '../../stores/user';
  import type { SourceLibraryEntry } from '../../types/analysis';
  import {
    formatRequestTime,
    getRevisionSummary,
    getRevisionUsage,
    getRevisionVersionLabel,
    getSourceUsage,
    splitSourceRevisions,
  } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { queryPermissions } from '../../utilities/permissions';

  const user = getUserStore();
  const sourcesLoading = sources.loading;

  let filter: string = '';
  let expanded: Record<number, boolean> = {};
  let renaming: number | null = null;
  /** The source the import dialog adds a revision to; null for a new source. */
  let importInto: number | null = null;
  let importOpen: boolean = false;

  $: needle = filter.trim().toLowerCase();
  $: shown = ($sources ?? []).filter(source => !needle || source.name.toLowerCase().includes(needle));
  // An admin may import a revision into any source, anyone else into their own (what Hasura allows).
  $: importableSources = ($sources ?? []).filter(source => queryPermissions.CREATE_SOURCE_REVISION($user, source));
  $: usage = getRevisionUsage($analysisSourceUsage ?? []);

  function openImport(sourceId: number | null) {
    importInto = sourceId;
    importOpen = true;
  }

  async function onRename(source: SourceLibraryEntry, event: Event) {
    const name = (event.currentTarget as HTMLInputElement).value.trim();
    renaming = null;
    if (name && name !== source.name) {
      await effects.renameSource(source, name, $user);
    }
  }
</script>

<PageTitle title="Imported Sources" />

<CssGrid rows="var(--nav-header-height) calc(100vh - var(--nav-header-height))">
  <Nav>
    <span slot="title">Imported Sources</span>
  </Nav>

  <Panel>
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
      {#if $sourcesLoading}
        <div class="st-typography-label text-muted-foreground">Loading…</div>
      {:else if !shown.length}
        <div class="st-typography-label text-muted-foreground">No imported sources{needle ? ' match' : ' yet'}</div>
      {:else}
        <ul class="sources" aria-label="Imported sources">
          {#each shown as source (source.id)}
            {@const { usable, pending } = splitSourceRevisions(source.revisions)}
            {@const usedBy = getSourceUsage(source, $analysisSourceUsage ?? [])}
            {@const canEdit = queryPermissions.UPDATE_SOURCE($user, source)}
            {@const canDelete = queryPermissions.DELETE_SOURCE($user, source)}
            <li class="source">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  {#if renaming === source.id}
                    <input
                      class="st-input"
                      aria-label="Source name"
                      value={source.name}
                      on:change={event => onRename(source, event)}
                      on:blur={() => (renaming = null)}
                    />
                  {:else}
                    <button
                      class="name"
                      aria-expanded={!!expanded[source.id]}
                      on:click={() => (expanded = { ...expanded, [source.id]: !expanded[source.id] })}
                    >
                      {expanded[source.id] ? '▾' : '▸'}
                      {source.name}
                    </button>
                  {/if}
                  <div class="text-muted-foreground">
                    {usable
                      ? `Latest: ${getRevisionVersionLabel(usable)} · ${getRevisionSummary(usable)}`
                      : 'No successful import'}
                  </div>
                  <div class="text-muted-foreground">
                    {source.revisions.length} revision{source.revisions.length === 1 ? '' : 's'}
                    {#if pending.length}
                      · <Badge variant="secondary" class="px-1 py-0 text-[10px]"
                        >{pending.some(r => r.status === 'failed') ? 'newer import failed' : 'importing'}</Badge
                      >
                    {/if}
                    · {usedBy.length
                      ? `used by ${usedBy.length} analys${usedBy.length === 1 ? 'is' : 'es'}`
                      : 'not used'}
                    · owner {source.owner ?? 'none'}
                  </div>
                </div>
                <div class="flex shrink-0 flex-wrap gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!queryPermissions.CREATE_SOURCE_REVISION($user, source)}
                    on:click={() => openImport(source.id)}>Import revision</Button
                  >
                  <Button size="xs" variant="outline" disabled={!canEdit} on:click={() => (renaming = source.id)}
                    >Rename</Button
                  >
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canDelete}
                    on:click={() => effects.deleteSource(source, usedBy, $user)}>Delete</Button
                  >
                </div>
              </div>

              {#if expanded[source.id]}
                <div class="revisions-scroll">
                  <table class="revisions" aria-label="Revisions of {source.name}">
                    <thead>
                      <tr><th>Revision</th><th>Contents</th><th>File · format</th><th>Used by</th><th /></tr>
                    </thead>
                    <tbody>
                      {#each source.revisions as revision (revision.id)}
                        {@const revisionUsedBy = usage[revision.id] ?? []}
                        <tr>
                          <td>
                            {revision.status === 'success'
                              ? getRevisionVersionLabel(revision)
                              : `Requested ${formatRequestTime(revision)}`}
                            {#if revision.id === usable?.id}<span class="text-muted-foreground"> · latest</span>{/if}
                            <div class="text-muted-foreground">by {revision.requested_by ?? 'unknown'}</div>
                          </td>
                          <td>
                            {getRevisionSummary(revision)}
                            {#if revision.error?.message}
                              <div class="text-red-700">{revision.error.message}</div>
                            {/if}
                          </td>
                          <td>
                            {revision.metadata?.originalFileName ??
                              revision.original_file?.name ??
                              'Read from the server'}
                            <div class="text-muted-foreground">
                              {revision.adapter}{revision.adapter_version ? ` ${revision.adapter_version}` : ''}
                            </div>
                          </td>
                          <td>
                            {#each revisionUsedBy as analysis (analysis.id)}
                              <div><a href="{base}/analyses/{analysis.id}">{analysis.name}</a></div>
                            {:else}
                              <span class="text-muted-foreground">—</span>
                            {/each}
                          </td>
                          <td>
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={!queryPermissions.DELETE_SOURCE_REVISION($user, source)}
                              on:click={() => effects.deleteSourceRevision(source, revision.id, revisionUsedBy, $user)}
                              >Delete</Button
                            >
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
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

<style>
  .sources {
    display: flex;
    flex-direction: column;
    font-size: 13px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .source {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 4px;
  }

  .name {
    background: none;
    border: none;
    cursor: pointer;
    font-weight: 500;
    padding: 0;
    text-align: left;
  }

  /* Long file names and errors wrap; below the table's minimum width it scrolls instead of squeezing. */
  .revisions-scroll {
    margin-left: 16px;
    overflow-x: auto;
  }

  .revisions {
    border-collapse: collapse;
    min-width: 560px;
    width: 100%;
  }

  .revisions th,
  .revisions td {
    border-top: 1px solid var(--st-gray-15);
    overflow-wrap: anywhere;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }

  .revisions th {
    color: var(--st-gray-60);
    font-weight: 400;
  }
</style>
