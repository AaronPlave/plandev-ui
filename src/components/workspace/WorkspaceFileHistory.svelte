<svelte:options immutable={true} />

<script lang="ts">
  import { FileDiff, LoaderCircle } from 'lucide-svelte';
  import { activeDocument } from '../../stores/activeDocument';
  import { getUserStore } from '../../stores/user';
  import { workspaceId } from '../../stores/workspaces';
  import type { UserStore } from '../../types/app';
  import type { WorkspaceFileHistoryEntry } from '../../types/workspace';
  import { showWorkspaceFileComparisonModal } from '../../utilities/modal';
  import { getRevisionDisplayName, WorkspaceApi } from '../../utilities/workspaces';
  import Tooltip from '../ui/Tooltip.svelte';

  export let filePath: string;
  /** Changes when the file is saved, restored or revised, so an open history reloads. */
  export let reloadKey: unknown = null;

  const user: UserStore = getUserStore();

  let error: string | null = null;
  let history: WorkspaceFileHistoryEntry[] | null = null;
  let loading: boolean = false;
  let open: boolean = false;

  $: if (open) {
    load(filePath, reloadKey);
  }

  async function load(path: string, _key: unknown) {
    loading = true;
    error = null;
    try {
      history = await WorkspaceApi.getFileHistory($workspaceId, path, $user);
    } catch (e) {
      error = (e as Error).message;
      history = null;
    } finally {
      loading = false;
    }
  }

  /** This change against the file's previous saved content. */
  function onDiff(index: number) {
    if (!history) {
      return;
    }
    const previous = history.slice(index + 1).find(e => e.contentChanged) ?? null;
    showWorkspaceFileComparisonModal({
      history,
      leftCommit: previous?.commit ?? null,
      leftFilePath: filePath,
      rightCommit: history[index].commit,
      rightFilePath: filePath,
      type: $activeDocument.type,
      user: $user,
      workspaceId: $workspaceId,
    });
  }

  /** Git messages name the file ("Update <path>"); shown on that file, the path is noise. */
  function describe(message: string): string {
    const rest = message.split(filePath).join('').replace(/\s+/g, ' ').trim();
    return (
      {
        Delete: 'Deleted',
        'Delete metadata for': 'Metadata deleted',
        Update: 'Saved',
        'Update metadata for': 'Metadata changed',
      }[rest] ?? message
    );
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    });
  }
</script>

<details class="flex flex-col gap-1" bind:open>
  <summary class="cursor-pointer font-medium">Change history</summary>
  <div class="pb-1 pt-1 text-muted-foreground">
    Every save, metadata change and restore, recorded automatically. Named revisions above are the deliberate
    checkpoints.
  </div>
  {#if loading && !history}
    <div class="flex items-center gap-2 text-muted-foreground">
      <LoaderCircle class="animate-spin" size={14} /> Loading…
    </div>
  {:else if error}
    <div class="text-destructive">{error}</div>
  {:else if history}
    <ul class="flex flex-col overflow-hidden rounded border border-border" aria-label="Change history">
      {#each history as entry, i (entry.commit)}
        <li class="flex items-start gap-2 px-2 py-1 {i > 0 ? 'border-t border-border' : ''}">
          <div class="min-w-0 flex-1">
            <div class="break-words" title={entry.message}>{describe(entry.message)}</div>
            <div class="text-muted-foreground">
              {entry.author} · {formatDate(entry.at)}
              {#if !entry.contentChanged}· metadata only{/if}
            </div>
            {#each entry.revisions as name}
              <span class="mr-1 rounded bg-muted px-1">Revision {getRevisionDisplayName(name)}</span>
            {/each}
          </div>
          {#if entry.contentChanged}
            <Tooltip content="Show this change">
              <button
                aria-label={`Show change: ${entry.message}, ${formatDate(entry.at)}`}
                class="text-muted-foreground hover:text-foreground"
                on:click={() => onDiff(i)}><FileDiff size={14} /></button
              >
            </Tooltip>
          {/if}
        </li>
      {:else}
        <li class="px-2 py-1 text-muted-foreground">No recorded changes.</li>
      {/each}
    </ul>
    {#if history.length >= 100}
      <div class="text-muted-foreground">Showing the latest 100 changes.</div>
    {/if}
    <div class="text-muted-foreground">History before the file was last renamed or moved is not shown.</div>
  {/if}
</details>
