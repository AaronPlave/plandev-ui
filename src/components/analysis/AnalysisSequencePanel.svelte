<svelte:options immutable={true} />

<!--
  The authored sequences of an analysis (seqJSON sources), as written: every step in the file's order (top-level
  steps, requests, immediate commands), each with its kind, arguments and time tag, and what it means for placing it
  in time. Only steps with an ABSOLUTE time are on the timeline; the rest are never given a made-up one, so this is
  where a sequence with no absolute times is investigated. It also says where the snapshot came from (a SeqDev file,
  which may have changed since) and, for a generated sequence, what PlanDev confirms of its claimed origin: the plan,
  the simulation, and the simulated activity each step says it was expanded from. Read only.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { ExternalLink } from 'lucide-svelte';
  import { createEventDispatcher, tick } from 'svelte';
  import { addAnalysisSource, analysisSequenceFocus } from '../../stores/analysis';
  import { getSimulationDatasetSpans } from '../../stores/analysisActivities';
  import type {
    AnalysisActivityRef,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
    SourceActivityLink,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { getRevisionVersionLabel } from '../../utilities/analysis';
  import {
    checkGeneratedFrom,
    describeStepTime,
    formatStepArgs,
    getAuthoredSections,
    getAuthoredSequenceSources,
    getWorkspaceFileSnapshot,
    sha256,
    stepMatches,
    type AuthoredEntry,
  } from '../../utilities/analysisSequence';
  import effects from '../../utilities/effects';
  import { getWorkspacesUrl } from '../../utilities/routes';

  export let bindings: AnalysisSourceBinding[] = [];
  export let datasets: AnalysisSimulationDataset[] = [];
  export let readOnly: boolean = false;
  export let revisions: AnalysisSourceRevision[] = [];
  export let selected: AnalysisActivityRef | null = null;
  export let user: User | null;

  /** Entries listed per section at once; the rest on request. */
  const ENTRY_LIMIT = 300;

  const dispatch = createEventDispatcher<{
    select: { endMs: number; ref: AnalysisActivityRef; startMs: number };
  }>();

  type Checks = {
    /** The SeqDev file now, against the snapshot's input. */
    file: 'unchanged' | 'changed' | 'unreadable' | 'unknown';
    /** The latest expansion output for the sequence, against the snapshot's input. */
    generated: { at: string; id: number; same: boolean } | null;
    provenance: ReturnType<typeof checkGeneratedFrom> | null;
  };

  let sourceId: string | null = null;
  let query: string = '';
  let openEntry: string | null = null;
  let showAll: Record<string, boolean> = {};
  let records: Map<string, SourceActivityLink> = new Map();
  let checks: Checks | null = null;
  let loadedRevision: number | null = null;
  let list: HTMLElement;

  $: sources = getAuthoredSequenceSources(bindings, revisions);
  $: current = sources.find(({ binding }) => binding.id === sourceId) ?? sources[0];
  $: sections = current ? getAuthoredSections(current.mission) : [];
  $: file = getWorkspaceFileSnapshot(current?.revision);
  $: generatedFrom = current?.mission.generatedFrom ?? null;
  $: seqId = generatedFrom?.seqId ?? current?.mission.sequenceId;
  $: stepActivityIds = sections.flatMap(section => section.entries.flatMap(e => e.simulatedActivityId ?? []));
  $: simulationBinding =
    generatedFrom?.simulationDatasetId !== undefined
      ? bindings.find(b => b.kind === 'simulation' && b.simulationDatasetId === generatedFrom?.simulationDatasetId)
      : undefined;
  $: stepCount = sections.reduce((n, section) => n + section.entries.length, 0);
  $: timedCount = sections.reduce((n, section) => n + section.entries.filter(e => e.recordKey).length, 0);
  $: if (current && current.revision.id !== loadedRevision) {
    load(current.revision.id);
  }
  $: selectedKey =
    selected && current && selected.sourceId === current.binding.id
      ? [...records.values()].find(record => record.id === selected?.activityId)?.source_key
      : undefined;
  $: if (selectedKey) {
    reveal(sections.flatMap(s => s.entries).find(e => e.recordKey === selectedKey)?.id ?? null, false);
  }
  $: if ($analysisSequenceFocus) {
    const focus = $analysisSequenceFocus;
    $analysisSequenceFocus = null;
    sourceId = focus.sourceId;
    query = '';
    tick().then(() => reveal(focus.entryId ?? null, true));
  }

  async function load(revisionId: number) {
    loadedRevision = revisionId;
    records = new Map();
    checks = null;
    const of = current;
    if (!of) {
      return;
    }
    const keys = getAuthoredSections(of.mission).flatMap(s => s.entries.flatMap(e => e.recordKey ?? []));
    const snapshot = getWorkspaceFileSnapshot(of.revision);
    const claimed = of.mission.generatedFrom;
    const [found, now, recorded] = await Promise.all([
      keys.length ? effects.getSourceActivityLinks(revisionId, { keys }, keys.length, user) : [],
      snapshot ? effects.readWorkspaceFileQuietly(snapshot.workspaceId, snapshot.path, user) : null,
      // A generator names the sequence by its id (expansion writes no seqId of its own into the metadata).
      claimed?.simulationDatasetId !== undefined
        ? effects.getSequenceProvenance(claimed.simulationDatasetId, claimed.seqId ?? of.mission.sequenceId, user)
        : null,
    ]);
    const inputHash = snapshot?.inputHash;
    const nowHash = now === null ? null : await sha256(now);
    const generatedHash = recorded?.generated ? await sha256(recorded.generated.expanded_template) : null;
    if (loadedRevision !== revisionId) {
      return;
    }
    records = new Map(found.map(record => [record.source_key, record]));
    checks = {
      file: !snapshot
        ? 'unknown'
        : nowHash === null
          ? 'unreadable'
          : !inputHash
            ? 'unknown'
            : nowHash === inputHash
              ? 'unchanged'
              : 'changed',
      generated:
        recorded?.generated && inputHash
          ? { at: recorded.generated.created_at, id: recorded.generated.id, same: generatedHash === inputHash }
          : null,
      provenance: claimed
        ? checkGeneratedFrom(
            claimed,
            recorded,
            getAuthoredSections(of.mission).flatMap(s => s.entries.flatMap(e => e.simulatedActivityId ?? [])),
          )
        : null,
    };
  }

  async function reveal(entryId: string | null, open: boolean) {
    if (!entryId) {
      return;
    }
    if (open) {
      openEntry = entryId;
    }
    const [section] = entryId.split(':');
    showAll = { ...showAll, [section]: true };
    await tick();
    list?.querySelector(`[data-entry="${CSS.escape(entryId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function selectRecord(entry: AuthoredEntry) {
    const record = entry.recordKey ? records.get(entry.recordKey) : undefined;
    if (record && current) {
      const startMs = Date.parse(record.start_time);
      dispatch('select', {
        endMs: record.end_time ? Date.parse(record.end_time) : startMs,
        ref: { activityId: record.id, sourceId: current.binding.id },
        startMs,
      });
    }
  }

  async function selectActivity(id: number) {
    const dataset = datasets.find(d => d.id === generatedFrom?.simulationDatasetId);
    if (!simulationBinding || !dataset) {
      return;
    }
    const span = (await getSimulationDatasetSpans(dataset, user)).find(s => s.span_id === id);
    if (span) {
      dispatch('select', {
        endMs: span.endMs,
        ref: { activityId: id, sourceId: simulationBinding.id },
        startMs: span.startMs,
      });
    }
  }

  function formatValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  function otherMetadata(entry: AuthoredEntry): [string, unknown][] {
    return Object.entries(entry.step.metadata ?? {}).filter(([key]) => key !== 'simulatedActivityId');
  }
</script>

<div class="flex h-full w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden p-2 text-xs">
  {#if !current}
    <div class="p-4 text-muted-foreground">
      This analysis has no authored sequence. Add a seqJSON source, or use Analyze sequence in SeqDev.
    </div>
  {:else}
    {#if sources.length > 1}
      <select class="st-select w-full" aria-label="Sequence" bind:value={sourceId}>
        {#each sources as { binding, mission } (binding.id)}
          <option value={binding.id}>{mission.sequenceId} · {binding.label ?? binding.id}</option>
        {/each}
      </select>
    {/if}

    <section class="flex flex-col gap-1" aria-label="About this sequence">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span class="text-sm font-medium">{current.mission.sequenceId}</span>
        <span class="text-muted-foreground">authored sequence · {stepCount} step{stepCount === 1 ? '' : 's'}</span>
        <span class="text-muted-foreground" title="The imported snapshot this analysis reads; it never changes"
          >{getRevisionVersionLabel(current.revision)}</span
        >
      </div>
      <p class="m-0 text-muted-foreground">
        {#if timedCount === 0}
          None of its steps has an absolute time, so nothing of it is on the timeline. Its steps are listed below in the
          file's order, with their time tags as written; no time is made up for them. Add other sources to investigate
          it alongside.
        {:else if timedCount === stepCount}
          Every step has an absolute time and is on the timeline.
        {:else}
          {timedCount} of {stepCount} steps have an absolute time and are on the timeline; the others are timed relative
          to something that happens when the sequence runs, so they are listed here only.
        {/if}
      </p>
      {#if file}
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="text-muted-foreground">Snapshot of</span>
          <span class="truncate">{file.workspaceName}/{file.path}</span>
          <span class="text-muted-foreground">(workspace {file.workspaceId})</span>
          {#if file.conversion || file.convertedFrom}
            <span class="text-muted-foreground"
              >converted from {file.conversion?.from ?? file.convertedFrom}{file.conversion
                ? file.conversion.adaptationId === null
                  ? ' by the built-in conversion'
                  : ` by adaptation ${file.conversion.adaptationId}`
                : ''}</span
            >
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-x-2">
          {#if checks?.file === 'unchanged'}
            <span>The file is unchanged since this snapshot.</span>
          {:else if checks?.file === 'changed'}
            <span class="text-amber-700"
              >The file has changed since this snapshot; this analysis still reads the snapshot.</span
            >
          {:else if checks?.file === 'unreadable'}
            <span class="text-muted-foreground"
              >The file can't be read now (deleted, moved, or not shared with you). The snapshot is unaffected.</span
            >
          {:else if checks?.file === 'unknown'}
            <span class="text-muted-foreground">Whether the file changed since is not known for this snapshot.</span>
          {/if}
          {#if checks && checks.file !== 'unreadable'}
            <a
              class="inline-flex items-center gap-1"
              href={getWorkspacesUrl(base, file.workspaceId, file.path)}
              title="Open the file as it is now in SeqDev (not necessarily this snapshot)"
              >Open in SeqDev<ExternalLink size={11} /></a
            >
          {/if}
        </div>
      {/if}
      {#if generatedFrom}
        {@const p = checks?.provenance}
        <div class="flex flex-col gap-0.5 rounded border border-border p-1.5" aria-label="Generated from">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-medium">Generated from</span>
            {#if generatedFrom.planId !== undefined}
              <a href="{base}/plans/{generatedFrom.planId}">plan {generatedFrom.planId}</a>
            {/if}
            {#if generatedFrom.simulationDatasetId !== undefined}
              <span>simulation dataset {generatedFrom.simulationDatasetId}</span>
            {/if}
            <span>as {seqId}</span>
          </div>
          <div class="text-muted-foreground">
            {#if !p || p.sequence === 'unchecked'}
              As the sequence's metadata says; not checked against PlanDev's records.
            {:else if p.sequence === 'missing'}
              As the sequence's metadata says. PlanDev has no sequence {seqId} in simulation dataset
              {generatedFrom.simulationDatasetId}: the claim can't be confirmed.
            {:else}
              PlanDev confirms sequence {seqId} in simulation dataset
              {generatedFrom.simulationDatasetId}{p.plan === 'verified'
                ? `, of plan ${generatedFrom.planId}`
                : p.plan === 'mismatch'
                  ? `, but of another plan than ${generatedFrom.planId}`
                  : ''}.
            {/if}
            {#if checks?.generated}
              {checks.generated.same
                ? 'This snapshot is its latest generated output, unedited.'
                : 'This snapshot differs from its latest generated output (edited since, or generated again).'}
            {/if}
          </div>
          {#if stepActivityIds.length}
            <div>
              {new Set(stepActivityIds).size} simulated activit{new Set(stepActivityIds).size === 1 ? 'y' : 'ies'} contributed
              steps, as each step says{p && p.sequence === 'verified'
                ? `: ${p.stepActivities.verified.length} confirmed as assigned to the sequence${p.stepActivities.unassigned.length ? `, ${p.stepActivities.unassigned.length} not` : ''}`
                : ''}.
              {#if !simulationBinding && generatedFrom.simulationDatasetId !== undefined && !readOnly}
                {@const datasetId = generatedFrom.simulationDatasetId}
                <button
                  class="text-primary underline"
                  on:click={() => addAnalysisSource({ kind: 'simulation', simulationDatasetId: datasetId }, user)}
                  >Add the simulation to go to them</button
                >
              {/if}
            </div>
          {:else}
            <div class="text-muted-foreground">
              Its steps don't say which activity each came from: only the sequence as a whole is attributed.
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <input
      class="st-input w-full"
      type="search"
      placeholder="Find a step: name, argument, time tag"
      bind:value={query}
    />

    <div class="flex-1 overflow-auto" bind:this={list}>
      {#each sections as section (section.label)}
        {@const key = section.entries[0]?.id.split(':')[0] ?? section.label}
        {@const matching = section.entries.filter(e => stepMatches(e.step, query))}
        {@const shown = showAll[key] ? matching : matching.slice(0, ENTRY_LIMIT)}
        <div class="sticky top-0 z-10 bg-background py-1 font-medium">
          {section.label} ({query ? `${matching.length} of ` : ''}{section.entries.length})
          {#if section.note}<span class="font-normal text-muted-foreground">· {section.note}</span>{/if}
        </div>
        <ol class="m-0 list-none p-0">
          {#each shown as entry (entry.id)}
            {@const time = describeStepTime(entry.step.time)}
            {@const record = entry.recordKey ? records.get(entry.recordKey) : undefined}
            <li
              data-entry={entry.id}
              class="rounded"
              class:bg-accent={record !== undefined && record.source_key === selectedKey}
            >
              <button
                class="flex w-full min-w-0 items-baseline gap-1.5 whitespace-nowrap px-1 py-0.5 text-left hover:bg-muted"
                aria-expanded={openEntry === entry.id}
                on:click={() => (openEntry = openEntry === entry.id ? null : entry.id)}
              >
                <span class="w-7 shrink-0 text-right text-muted-foreground">{entry.step.position}</span>
                <span class="shrink-0 font-medium" title={entry.step.description ?? ''}
                  >{entry.step.name ?? entry.step.type}</span
                >
                {#if entry.step.type !== 'command'}<span class="text-[10px] text-muted-foreground"
                    >{entry.step.type}</span
                  >{/if}
                <span class="min-w-0 truncate text-muted-foreground">{formatStepArgs(entry.step.args)}</span>
                <span
                  class="ml-auto shrink-0"
                  class:text-muted-foreground={!record}
                  title="{time.meaning}{record ? ' · on the timeline' : ''}">{time.label}</span
                >
              </button>
              {#if openEntry === entry.id}
                <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 pb-2 pl-9">
                  <dt class="text-muted-foreground">Kind</dt>
                  <dd class="m-0">{entry.step.type}</dd>
                  <dt class="text-muted-foreground">Time</dt>
                  <dd class="m-0">
                    {time.label} · {time.meaning}
                    {#if entry.step.dataQuality}<div class="text-amber-700">{entry.step.dataQuality}</div>{/if}
                  </dd>
                  {#if entry.step.args && !Array.isArray(entry.step.args)}
                    {#each Object.entries(entry.step.args) as [name, value]}
                      <dt class="text-muted-foreground">{name}</dt>
                      <dd class="m-0 break-all">{formatValue(value)}</dd>
                    {/each}
                  {:else if entry.step.args}
                    <dt class="text-muted-foreground">Arguments</dt>
                    <dd class="m-0 break-all">{formatStepArgs(entry.step.args)}</dd>
                  {/if}
                  {#if entry.step.description}
                    <dt class="text-muted-foreground">Description</dt>
                    <dd class="m-0">{entry.step.description}</dd>
                  {/if}
                  {#each otherMetadata(entry) as [name, value]}
                    <dt class="text-muted-foreground">{name}</dt>
                    <dd class="m-0 break-all">{formatValue(value)}</dd>
                  {/each}
                  {#if entry.simulatedActivityId !== null}
                    {@const id = entry.simulatedActivityId}
                    {@const p = checks?.provenance}
                    <dt class="text-muted-foreground">From activity</dt>
                    <dd class="m-0">
                      {#if simulationBinding}
                        <button class="text-primary underline" on:click={() => selectActivity(id)}
                          >simulated activity {id}</button
                        >
                      {:else}
                        simulated activity {id}{generatedFrom?.simulationDatasetId !== undefined
                          ? ` of simulation dataset ${generatedFrom.simulationDatasetId}`
                          : ''}
                      {/if}
                      <span class="text-muted-foreground"
                        >{p?.stepActivities.verified.includes(id)
                          ? '(as the step says; assigned to this sequence)'
                          : p?.stepActivities.unassigned.includes(id)
                            ? '(as the step says; not assigned to this sequence in PlanDev)'
                            : '(as the step says)'}</span
                      >
                    </dd>
                  {/if}
                  <dt class="text-muted-foreground">Timeline</dt>
                  <dd class="m-0">
                    {#if record}
                      <button class="text-primary underline" on:click={() => selectRecord(entry)}
                        >Select on the timeline</button
                      >
                    {:else}
                      <span class="text-muted-foreground"
                        >Not on it: {entry.recordKey ? 'its record was not found' : 'it has no absolute time'}</span
                      >
                    {/if}
                  </dd>
                </dl>
              {/if}
            </li>
          {/each}
        </ol>
        {#if matching.length > shown.length}
          <Button size="xs" variant="ghost" on:click={() => (showAll = { ...showAll, [key]: true })}
            >Show all {matching.length}</Button
          >
        {/if}
      {/each}
    </div>
  {/if}
</div>
