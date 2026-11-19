<svelte:options immutable={true} />

<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { LoaderCircle } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import { commandDictionaries } from '../../stores/sequencing';
  import { getUserStore } from '../../stores/user';
  import { parcel, workspaceId } from '../../stores/workspaces';
  import type { UserStore } from '../../types/app';
  import { compareSourceWithBuild } from '../../utilities/buildCompare';
  import { checkFreshness, sha256Hex, type BuildProvenance, type Freshness } from '../../utilities/buildProvenance';
  import { getShortISOForDate } from '../../utilities/time';
  import { getRevisionDisplayName, WorkspaceApi } from '../../utilities/workspaces';

  /** The artifact. */
  export let filePath: string;
  export let provenance: BuildProvenance;

  const dispatch = createEventDispatcher<{ openActionRun: number; openFile: string }>();
  const user: UserStore = getUserStore();

  let check: Freshness | null = null;
  let checkError: string | null = null;
  let checking: boolean = false;
  let comparing: boolean = false;
  let compareNote: string | null = null;

  $: parcelDictionary = $commandDictionaries.find(d => d.id === $parcel?.command_dictionary_id) ?? null;
  $: dictionaryNote =
    !parcelDictionary || !provenance.dictionary
      ? null
      : parcelDictionary.mission === provenance.dictionary.mission &&
          parcelDictionary.version === provenance.dictionary.version
        ? 'same mission and version as the parcel dictionary'
        : `the parcel now uses ${parcelDictionary.mission} ${parcelDictionary.version}`;
  $: toolchainRows = Object.entries(provenance.toolchain ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  $: runId = provenance.producer.kind === 'action' ? (provenance.producer.runId ?? null) : null;
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

  async function runCheck() {
    checking = true;
    checkError = null;
    try {
      check = await checkFreshness(provenance, filePath, hashOf);
    } catch (e) {
      checkError = (e as Error).message;
    } finally {
      checking = false;
    }
  }

  async function compareSource() {
    comparing = true;
    compareNote = null;
    try {
      compareNote = await compareSourceWithBuild(provenance, $workspaceId, $user);
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
      {#if check?.sourceChanged === null}
        {provenance.source}
        <div class="text-muted-foreground">Not in the workspace at this path now (deleted or moved).</div>
      {:else}
        <button class="text-left underline" on:click={() => dispatch('openFile', provenance.source)}
          >{provenance.source}</button
        >
      {/if}
      {#if provenance.sourceRevision}
        @ revision {getRevisionDisplayName(provenance.sourceRevision)}
      {:else if provenance.sourceCommit}
        (saved version <span class="font-mono" title={provenance.sourceCommit}
          >{provenance.sourceCommit.slice(0, 8)}</span
        >)
      {:else}
        (saved working copy)
      {/if}
    </dd>
    <dt class="text-muted-foreground">Built by</dt>
    <dd>
      {provenance.producer.kind === 'action'
        ? `Action “${provenance.producer.name}”`
        : `${provenance.producer.name} output, saved from the editor`}
      {#if runId !== null}
        <button class="underline" on:click={() => runId !== null && dispatch('openActionRun', runId)}
          >run {runId}</button
        >
      {/if}
    </dd>
    <dt class="text-muted-foreground">Built</dt>
    <dd>{getShortISOForDate(new Date(provenance.builtAt))}</dd>
    <dt class="text-muted-foreground">Result</dt>
    <dd>
      {provenance.producer.kind === 'action' ? 'Compiled' : 'Generated'}{#if provenance.verify}; {provenance.verify.ok
          ? 'verified (loads within sequencer limits)'
          : 'verify failed'}{:else if provenance.source.endsWith('.rs')}; verify result not recorded{/if}
    </dd>
    {#if provenance.bytes != null}
      <dt class="text-muted-foreground">Size</dt>
      <dd>{provenance.bytes.toLocaleString()} bytes</dd>
    {/if}
    <dt class="text-muted-foreground">Artifact</dt>
    <dd class="break-all font-mono" title={provenance.sha256}>sha256 {provenance.sha256.slice(0, 16)}…</dd>
    {#if provenance.dictionary}
      <dt class="text-muted-foreground">Dictionary</dt>
      <dd class="break-words">
        {provenance.dictionary.mission}
        {provenance.dictionary.version}
        {#if provenance.dictionary.sha256}
          <span class="font-mono" title={provenance.dictionary.sha256}
            >({provenance.dictionary.sha256.slice(0, 12)}…)</span
          >
        {/if}
        {#if dictionaryNote}<div class="text-muted-foreground">{dictionaryNote}</div>{/if}
      </dd>
    {/if}
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
      {#if check.sourceChanged === false && !check.changed.length}
        <div>Source and all recorded inputs are unchanged since this build.</div>
      {:else}
        <div>
          {check.sourceChanged === null
            ? 'The source is not at its recorded path; it is not looked for elsewhere.'
            : check.sourceChanged
              ? 'The source has changed since this build.'
              : 'The source is unchanged.'}
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
      <Button size="sm" variant="outline" disabled={comparing || check?.sourceChanged === null} on:click={compareSource}
        >Compare source with build</Button
      >
    </div>
    {#if compareNote}
      <div class="text-muted-foreground">{compareNote}</div>
    {/if}
  </div>
</section>
