<svelte:options immutable={true} />

<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import { getUserStore } from '../../stores/user';
  import { workspaceId } from '../../stores/workspaces';
  import type { UserStore } from '../../types/app';
  import { compareSourceWithBuild } from '../../utilities/buildCompare';
  import {
    checkFreshness,
    isFresh,
    sha256Hex,
    type BuildArtifact,
    type Freshness,
  } from '../../utilities/buildProvenance';
  import { getShortISOForDate } from '../../utilities/time';
  import { getRevisionDisplayName, WorkspaceApi } from '../../utilities/workspaces';

  /** The source file. */
  export let filePath: string;
  /** Artifacts whose provenance names this source (see findBuildArtifacts). */
  export let artifacts: BuildArtifact[] = [];
  /** Changes when the source is saved (its ETag), so the saved files are compared again. */
  export let refreshKey: string | null = null;
  /** The editor's text when it has unsaved edits, else null. */
  export let unsavedText: string | null = null;

  const dispatch = createEventDispatcher<{
    openActionRun: number;
    openActionRuns: void;
    openArtifactHistory: string;
    openFile: string;
  }>();
  const user: UserStore = getUserStore();

  let freshness: Record<string, Freshness | 'checking' | 'error'> = {};
  let notes: Record<string, string | null> = {};
  let unsavedHash: string | null = null;
  let unsavedTimer: ReturnType<typeof setTimeout> | null = null;

  $: if (artifacts || filePath || refreshKey) {
    checkAll(artifacts);
  }
  $: hashUnsaved(unsavedText);

  async function hashOf(path: string): Promise<string | null> {
    try {
      const blob = await WorkspaceApi.getFileContentBlob($workspaceId, path, $user);
      return blob ? sha256Hex(await blob.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  async function checkAll(list: BuildArtifact[]) {
    freshness = Object.fromEntries(list.map(a => [a.path, 'checking']));
    await Promise.all(
      list.map(async ({ path, provenance }) => {
        try {
          const result = await checkFreshness(provenance, path, hashOf);
          freshness = { ...freshness, [path]: result };
        } catch {
          freshness = { ...freshness, [path]: 'error' };
        }
      }),
    );
  }

  function hashUnsaved(text: string | null) {
    if (unsavedTimer) {
      clearTimeout(unsavedTimer);
    }
    if (text === null) {
      unsavedHash = null;
      return;
    }
    unsavedTimer = setTimeout(async () => (unsavedHash = await sha256Hex(text)), 250);
  }

  async function compare(artifact: BuildArtifact) {
    notes = { ...notes, [artifact.path]: null };
    try {
      notes = { ...notes, [artifact.path]: await compareSourceWithBuild(artifact.provenance, $workspaceId, $user) };
    } catch (e) {
      notes = { ...notes, [artifact.path]: (e as Error).message };
    }
  }

  function savedSummary(state: Freshness): string {
    if (state.artifactMatches === false) {
      return "The artifact's content differs from what the build wrote.";
    }
    if (isFresh(state)) {
      return 'Up to date: the saved source and every recorded input are unchanged since this build.';
    }
    const parts = [state.sourceChanged ? 'The saved source has changed since this build.' : 'Saved source unchanged.'];
    if (state.changed.length) {
      parts.push(`Changed inputs: ${state.changed.join(', ')}.`);
    }
    return parts.join(' ');
  }
</script>

<section class="flex min-w-0 flex-col gap-2 rounded border border-border p-2" aria-label="Builds">
  <div class="font-medium">Builds</div>
  {#if !artifacts.length}
    <div class="text-muted-foreground">No artifact in this workspace records {filePath} as its source.</div>
  {/if}
  <ul class="flex flex-col gap-2">
    {#each artifacts as artifact (artifact.path)}
      {@const provenance = artifact.provenance}
      {@const state = freshness[artifact.path]}
      {@const runId = provenance.producer.kind === 'action' ? (provenance.producer.runId ?? null) : null}
      <li class="flex min-w-0 flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
        <button
          class="break-all text-left font-mono underline"
          title="Open the artifact"
          on:click={() => dispatch('openFile', artifact.path)}>{artifact.path}</button
        >
        <div class="text-muted-foreground">
          {getShortISOForDate(new Date(provenance.builtAt))}
          · {provenance.producer.kind === 'action' ? provenance.producer.name : `${provenance.producer.name} output`}
          {#if provenance.sourceRevision}· from revision {getRevisionDisplayName(provenance.sourceRevision)}{/if}
          {#if provenance.verify}· {provenance.verify.ok ? 'verified' : 'verify failed'}{/if}
        </div>
        <div aria-live="polite">
          {#if state === 'checking' || state === undefined}
            <span class="text-muted-foreground">Checking saved files…</span>
          {:else if state === 'error'}
            <span class="text-destructive">Could not read the files to compare.</span>
          {:else}
            <span class:text-muted-foreground={isFresh(state)}>{savedSummary(state)}</span>
          {/if}
        </div>
        {#if unsavedText !== null}
          <div>
            Unsaved edits:
            {unsavedHash === null
              ? '…'
              : unsavedHash === provenance.sourceSha256
                ? 'the editor text matches the built source.'
                : 'the editor text differs from the built source; save and rebuild to include them.'}
          </div>
        {/if}
        <div class="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" on:click={() => dispatch('openFile', artifact.path)}>Open</Button>
          <Button size="sm" variant="outline" on:click={() => dispatch('openArtifactHistory', artifact.path)}
            >Build history</Button
          >
          <Button size="sm" variant="outline" on:click={() => compare(artifact)}>Compare with build</Button>
          {#if runId !== null}
            <Button size="sm" variant="ghost" on:click={() => runId !== null && dispatch('openActionRun', runId)}
              >Run {runId}</Button
            >
          {/if}
        </div>
        {#if notes[artifact.path]}
          <div class="text-muted-foreground">{notes[artifact.path]}</div>
        {/if}
      </li>
    {/each}
  </ul>
  <div class="text-muted-foreground">
    Failed builds write no artifact; their diagnostics stay in
    <button class="underline" on:click={() => dispatch('openActionRuns')}>Action runs</button>.
  </div>
</section>
