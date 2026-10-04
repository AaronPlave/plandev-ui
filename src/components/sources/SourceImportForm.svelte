<svelte:options immutable={true} />

<!--
  Importing a file as a new source, or as a new revision of one the user owns. The upload makes an ordinary source
  revision; the ingest worker reads it. Used by an analysis's Add Source and by the Sources page.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher, onMount } from 'svelte';
  import type { SourceAdapterDescriptor } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { getAvailableAdapters } from '../../utilities/analysis';
  import effects from '../../utilities/effects';

  /** The sources a new revision can go into: those the user owns. */
  export let ownSources: { id: number; name: string }[] = [];
  /** Preselects a source to import a new revision of. */
  export let sourceId: number | null = null;
  /** Shows "Add it to this analysis" (on by default). */
  export let offerAdd: boolean = false;
  export let user: User | null;

  const dispatch = createEventDispatcher<{ imported: { add: boolean; revisionId: number } }>();

  let adapters: SourceAdapterDescriptor[] = [];
  let adaptersLoaded: boolean = false;
  let file: File | null = null;
  let fileInput: HTMLInputElement;
  let importInto: 'new' | number = sourceId ?? 'new';
  let newSourceName: string = '';
  let adapter: string = 'auto';
  let addWhenImported: boolean = true;
  let importing: boolean = false;
  let imported: string = '';

  onMount(async () => {
    adapters = getAvailableAdapters(await effects.getSourceAdapters(user));
    adaptersLoaded = true;
  });

  function onFile(event: Event) {
    file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    imported = '';
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
      dispatch('imported', { add: offerAdd && addWhenImported, revisionId });
      file = null;
      fileInput.value = '';
      newSourceName = '';
    }
  }
</script>

<form class="flex flex-col gap-3" on:submit|preventDefault={importFile}>
  <label class="field">
    <span>File</span>
    <input bind:this={fileInput} type="file" class="st-input" aria-label="File to import" on:change={onFile} />
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
  {#if adaptersLoaded && !adapters.length}
    <div class="text-red-700" role="status">No ingest worker is running: an import waits until one starts.</div>
  {/if}
  {#if offerAdd}
    <label class="flex items-center gap-2">
      <input type="checkbox" bind:checked={addWhenImported} />
      Add it to this analysis
    </label>
  {/if}
  <div class="text-muted-foreground">
    Uploads go through the browser. For very large products, import from the server with the source-ingest CLI.
  </div>
  <div class="flex items-center gap-2">
    <Button type="submit" size="sm" disabled={!file || importing}>{importing ? 'Uploading…' : 'Import'}</Button>
    {#if imported}<span role="status">{imported}</span>{/if}
  </div>
</form>

<style>
  .field {
    display: grid;
    gap: 4px;
  }
</style>
