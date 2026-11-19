<svelte:options immutable={true} />

<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { LoaderCircle } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import { commandDictionaries } from '../../stores/sequencing';
  import { getUserStore } from '../../stores/user';
  import { parcel, workspaceId } from '../../stores/workspaces';
  import type { UserStore } from '../../types/app';
  import { projectFolder, sha256Hex, type BuildProvenance } from '../../utilities/buildProvenance';
  import { showWorkspaceFileComparisonModal } from '../../utilities/modal';
  import { getShortISOForDate } from '../../utilities/time';
  import { getRevisionDisplayName, WorkspaceApi } from '../../utilities/workspaces';

  /** The artifact. */
  export let filePath: string;
  export let provenance: BuildProvenance;

  const dispatch = createEventDispatcher<{ openFile: string }>();
  const user: UserStore = getUserStore();
  const HISTORY_SCAN_LIMIT = 30;

  type Check = {
    artifactMatches: boolean | null;
    changed: string[];
    missing: string[];
    sourceChanged: boolean;
  };

  let check: Check | null = null;
  let checkError: string | null = null;
  let checking: boolean = false;
  let comparing: boolean = false;
  let compareNote: string | null = null;

  $: folder = projectFolder(provenance);
  $: parcelDictionary = $commandDictionaries.find(d => d.id === $parcel?.command_dictionary_id) ?? null;
  $: dictionaryNote = !parcelDictionary
    ? null
    : parcelDictionary.mission === provenance.dictionary.mission &&
        parcelDictionary.version === provenance.dictionary.version
      ? 'same mission and version as the parcel dictionary'
      : `the parcel now uses ${parcelDictionary.mission} ${parcelDictionary.version}`;
  $: toolchainRows = Object.entries(provenance.toolchain ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  $: if (filePath || provenance) {
    runCheck();
  }

  async function hashOf(path: string): Promise<string | null> {
    try {
      const blob = await WorkspaceApi.getFileContentBlob($workspaceId, path, $user);
      return blob ? sha256Hex(await blob.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  /** Compares the recorded content hashes with the files as saved now. */
  async function runCheck() {
    checking = true;
    checkError = null;
    try {
      const inputs = folder === null ? [] : provenance.inputs;
      const [artifactHash, sourceHash, ...inputHashes] = await Promise.all([
        hashOf(filePath),
        hashOf(provenance.source),
        ...inputs.map(input => hashOf(`${folder}${input.path}`)),
      ]);
      check = {
        artifactMatches: artifactHash === null ? null : artifactHash === provenance.sha256,
        // Other inputs (helpers, Cargo.toml, the project's dictionary copy); the source is reported on its own.
        changed: inputs
          .filter((input, i) => inputHashes[i] !== null && inputHashes[i] !== input.sha256)
          .map(input => input.path)
          .filter(path => `${folder}${path}` !== provenance.source),
        missing: inputs.filter((_, i) => inputHashes[i] === null).map(i => i.path),
        sourceChanged: sourceHash !== provenance.sourceSha256,
      };
    } catch (e) {
      checkError = (e as Error).message;
    } finally {
      checking = false;
    }
  }

  /**
   * The source as built against the source now. Built from a revision: that revision. Built from the
   * working copy: the saved version in the source's history whose content hash is the recorded one.
   */
  async function compareSource() {
    comparing = true;
    compareNote = null;
    try {
      const history = await WorkspaceApi.getFileHistory($workspaceId, provenance.source, $user);
      let leftCommit: string | null = null;
      if (!provenance.sourceRevision) {
        for (const entry of history.filter(e => e.contentChanged).slice(0, HISTORY_SCAN_LIMIT)) {
          const content = await WorkspaceApi.getFileAtCommit($workspaceId, provenance.source, entry.commit, $user);
          if ((await sha256Hex(content)) === provenance.sourceSha256) {
            leftCommit = entry.commit;
            break;
          }
        }
        if (!leftCommit) {
          compareNote = `The built source is not among the last ${HISTORY_SCAN_LIMIT} saved versions of ${provenance.source}.`;
          return;
        }
      }
      showWorkspaceFileComparisonModal({
        history,
        leftCommit,
        leftFilePath: provenance.source,
        leftRevisionName: provenance.sourceRevision,
        rightFilePath: provenance.source,
        type: null,
        user: $user,
        workspaceId: $workspaceId,
      });
    } catch (e) {
      compareNote = (e as Error).message;
    } finally {
      comparing = false;
    }
  }
</script>

<section class="flex min-w-0 flex-col gap-2 rounded border border-border p-2" aria-label="Build provenance">
  <div class="font-medium">Build</div>
  <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
    <dt class="text-muted-foreground">Source</dt>
    <dd class="break-all">
      <button class="text-left underline" on:click={() => dispatch('openFile', provenance.source)}
        >{provenance.source}</button
      >
      {#if provenance.sourceRevision}
        @ revision {getRevisionDisplayName(provenance.sourceRevision)}
      {:else}
        (saved working copy)
      {/if}
    </dd>
    <dt class="text-muted-foreground">Built</dt>
    <dd>{getShortISOForDate(new Date(provenance.builtAt))}</dd>
    <dt class="text-muted-foreground">Result</dt>
    <dd>
      Compiled{#if provenance.verify}; {provenance.verify.ok
          ? 'verified (loads within sequencer limits)'
          : 'verify failed'}{:else if provenance.source.endsWith('.rs')}; verify result not recorded{/if}
    </dd>
    {#if provenance.bytes != null}
      <dt class="text-muted-foreground">Size</dt>
      <dd>{provenance.bytes.toLocaleString()} bytes</dd>
    {/if}
    <dt class="text-muted-foreground">Artifact</dt>
    <dd class="break-all font-mono" title={provenance.sha256}>sha256 {provenance.sha256.slice(0, 16)}…</dd>
    <dt class="text-muted-foreground">Dictionary</dt>
    <dd class="break-words">
      {provenance.dictionary.mission}
      {provenance.dictionary.version}
      <span class="font-mono" title={provenance.dictionary.sha256}>({provenance.dictionary.sha256.slice(0, 12)}…)</span>
      {#if dictionaryNote}<div class="text-muted-foreground">{dictionaryNote}</div>{/if}
    </dd>
    {#each toolchainRows as [tool, version]}
      <dt class="text-muted-foreground">{tool}</dt>
      <dd class="break-words">{version}</dd>
    {/each}
    {#if provenance.toolchain?.patches?.length}
      <dt class="text-muted-foreground">Patches</dt>
      <dd class="break-words">{provenance.toolchain.patches.map(p => p.name).join(', ')}</dd>
    {/if}
  </dl>

  <div class="flex flex-col gap-1 border-t border-border pt-2" aria-live="polite">
    <div class="font-medium">Compared with the saved files now</div>
    {#if checking}
      <div class="flex items-center gap-2 text-muted-foreground">
        <LoaderCircle class="animate-spin" size={14} /> Hashing…
      </div>
    {:else if checkError}
      <div class="text-destructive">{checkError}</div>
    {:else if check}
      {#if check.artifactMatches === false}
        <div class="text-destructive">This file's content differs from what the build wrote.</div>
      {/if}
      {#if !check.sourceChanged && !check.changed.length}
        <div>Source and all recorded inputs are unchanged since this build.</div>
      {:else}
        <div>
          {check.sourceChanged ? 'The source has changed since this build.' : 'The source is unchanged.'}
          {#if check.changed.length}
            Other changed inputs: {check.changed.join(', ')}.
          {/if}
        </div>
        <div class="text-muted-foreground">
          A changed input means this artifact was not built from the current files; it does not by itself make the
          artifact wrong. Rebuild to produce one from them.
        </div>
      {/if}
      {#if check.missing.length}
        <div class="text-muted-foreground">
          Not in the workspace (generated by the build or since removed): {check.missing.join(', ')}.
        </div>
      {/if}
    {/if}
    <div class="flex gap-2">
      <Button size="sm" variant="outline" disabled={checking} on:click={runCheck}>Check again</Button>
      <Button size="sm" variant="outline" disabled={comparing} on:click={compareSource}
        >Compare source with build</Button
      >
    </div>
    {#if compareNote}
      <div class="text-muted-foreground">{compareNote}</div>
    {/if}
  </div>
</section>
