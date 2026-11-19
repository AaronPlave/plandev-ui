<svelte:options immutable={true} />

<script lang="ts">
  import { Checkbox, Label } from '@nasa-jpl/stellar-svelte';
  import type { WorkspaceRevisionName } from '../../types/workspace';
  import type { WorkspaceFileMetadata } from '../../types/workspace-tree-view';
  import { getGeneratedFromPlanUrl, getGeneratedFrom } from '../../utilities/generatedProvenance';
  import { getBuildProvenance } from '../../utilities/buildProvenance';
  import { permissionHandler } from '../../utilities/permissionHandler';
  import { getShortISOForDate } from '../../utilities/time';
  import { getRevisionDisplayName, getUserDisplayNameFromIdentity } from '../../utilities/workspaces';
  import Tooltip from '../ui/Tooltip.svelte';

  /** Artifacts whose provenance names this file as their source. */
  export let buildCount: number = 0;
  export let doesWorkingCopyMatchLatestRevision: boolean = false;
  export let isDirty: boolean = false;
  export let fileMetadata: WorkspaceFileMetadata;
  export let hasEditPermission: boolean = false;
  export let hasRevisions: boolean = false;
  export let matchingRevisionName: WorkspaceRevisionName | null = null;
  export let onReadOnlyChange: ((readOnly: boolean) => void) | null = null;
  export let onShowBuilds: (() => void) | null = null;

  $: generatedFrom = getGeneratedFrom(fileMetadata.user);
  $: builtFrom = getBuildProvenance(fileMetadata.user)?.source ?? null;
  $: managedBy = typeof fileMetadata.user?.managedBy === 'string' ? fileMetadata.user.managedBy : null;
</script>

<div class="flex min-h-8 items-center gap-4 border-b bg-[var(--sidebar)] px-3 py-1.5 text-xs text-muted-foreground">
  <div>
    {#if fileMetadata.lastEditedBy}
      <span class="font-medium">Last Edited By:</span>
      {getUserDisplayNameFromIdentity(fileMetadata.lastEditedBy)}
    {/if}
    {#if fileMetadata.lastEditedAt}
      at {getShortISOForDate(new Date(fileMetadata.lastEditedAt))}
    {/if}
  </div>
  <div>
    {#if isDirty}
      <span class="font-medium">Unsaved Changes</span>
    {:else if matchingRevisionName !== null && matchingRevisionName !== ''}
      {#if doesWorkingCopyMatchLatestRevision}
        Matches Revision <span class="font-medium">{getRevisionDisplayName(matchingRevisionName)}</span> (Latest)
      {:else}
        Matches Revision <span class="font-medium">{getRevisionDisplayName(matchingRevisionName)}</span>
      {/if}
    {:else if !hasRevisions}
      <span class="font-medium">Unrevisioned</span>
    {:else}
      <span class="font-medium">Working Copy</span>
    {/if}
  </div>
  {#if generatedFrom}
    <a
      class="font-medium underline"
      href={getGeneratedFromPlanUrl(
        generatedFrom,
        generatedFrom.spanIds.length === 1 ? generatedFrom.spanIds[0] : null,
      )}
      title="Open the plan and simulation this sequence was generated from"
      >Generated from plan {generatedFrom.planName}</a
    >
  {/if}
  {#if builtFrom}
    <span class="font-medium" title="Build output; see Metadata for its provenance">Built from {builtFrom}</span>
  {/if}
  {#if buildCount && onShowBuilds}
    <button class="font-medium underline" title="Show the artifacts built from this file" on:click={onShowBuilds}
      >{buildCount} build{buildCount === 1 ? '' : 's'}</button
    >
  {/if}
  {#if managedBy}
    <Tooltip
      content="Maintained by {managedBy}, which may rewrite it. Hidden from the file list unless managed files are shown."
    >
      <span class="font-medium">Managed by {managedBy}</span>
    </Tooltip>
  {/if}
  <div
    class="ml-auto flex items-center gap-1.5"
    use:permissionHandler={{
      hasPermission: hasEditPermission,
      permissionError: 'You do not have permission to change the read-only status of this file',
    }}
  >
    <Checkbox
      checked={fileMetadata.readOnly ?? false}
      on:click={() => onReadOnlyChange?.(!(fileMetadata?.readOnly ?? false))}
      size="sm"
      id="read-only"
    />
    <Label size="sm" for="read-only">Read only</Label>
  </div>
</div>
