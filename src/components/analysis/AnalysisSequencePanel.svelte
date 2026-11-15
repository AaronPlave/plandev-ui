<svelte:options immutable={true} />

<!--
  An authored sequence (a seqJSON source), inspected: what it is and where it came from in a line or two, then its
  steps in the file's order, each opening to its timing, arguments and the activity it was generated from. This is
  where a step is inspected, whether it was selected here or on the timeline: there is no second view of it.

  Only steps with an ABSOLUTE time are on the timeline; the rest are never given a made-up time. Provenance is said as
  strongly as it is known: "verified" only when this snapshot is exactly the sequence's latest saved expansion output;
  otherwise as the sequence claims it, with what PlanDev records now (current sequence assignments, which can change
  after an expansion) in the details, and any disagreement said plainly.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { ExternalLink } from 'lucide-svelte';
  import { createEventDispatcher, tick } from 'svelte';
  import { addAnalysisSource, analysisPlans } from '../../stores/analysis';
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
  /** The step to open (an AuthoredEntry id). */
  export let entryId: string | undefined = undefined;
  export let readOnly: boolean = false;
  export let revisions: AnalysisSourceRevision[] = [];
  export let selected: AnalysisActivityRef | null = null;
  /** The sequence's source; the first authored sequence of the analysis when absent. */
  export let sourceId: string | undefined = undefined;
  export let user: User | null;

  /** Entries listed per section at once; the rest on request. */
  const ENTRY_LIMIT = 300;

  const dispatch = createEventDispatcher<{
    /** `inspect`: show the selected activity's details (an activity elsewhere); else stay on the sequence. */
    select: { endMs: number; inspect: boolean; ref: AnalysisActivityRef; startMs: number };
  }>();

  type Checks = {
    /** The SeqDev file now, against the snapshot's input. */
    file: 'unchanged' | 'changed' | 'unreadable' | 'unknown';
    /** The latest expansion output for the sequence, against the snapshot's input. */
    generated: { at: string; id: number; same: boolean } | null;
    provenance: ReturnType<typeof checkGeneratedFrom> | null;
  };

  let query: string = '';
  let openEntry: string | null = null;
  let showAll: Record<string, boolean> = {};
  let records: Map<string, SourceActivityLink> = new Map();
  let activityNames: Map<number, string> = new Map();
  let checks: Checks | null = null;
  let loadedRevision: number | null = null;
  let list: HTMLElement;

  $: sources = getAuthoredSequenceSources(bindings, revisions);
  $: current = sources.find(({ binding }) => binding.id === sourceId) ?? sources[0];
  $: sections = current ? getAuthoredSections(current.mission) : [];
  $: file = getWorkspaceFileSnapshot(current?.revision);
  $: generatedFrom = current?.mission.generatedFrom ?? null;
  $: seqId = generatedFrom?.seqId ?? current?.mission.sequenceId;
  $: stepActivityIds = [
    ...new Set(sections.flatMap(section => section.entries.flatMap(e => e.simulatedActivityId ?? []))),
  ];
  $: simulationBinding =
    generatedFrom?.simulationDatasetId !== undefined
      ? bindings.find(b => b.kind === 'simulation' && b.simulationDatasetId === generatedFrom?.simulationDatasetId)
      : undefined;
  $: simulationDataset = datasets.find(d => d.id === generatedFrom?.simulationDatasetId);
  $: planName =
    simulationDataset?.simulation?.plan?.name ??
    ($analysisPlans ?? []).find(({ id }) => id === generatedFrom?.planId)?.name ??
    (generatedFrom?.planId !== undefined ? `plan ${generatedFrom.planId}` : null);
  $: stepCount = sections.reduce((n, section) => n + section.entries.length, 0);
  $: timedCount = sections.reduce((n, section) => n + section.entries.filter(e => e.recordKey).length, 0);
  $: if (current && current.revision.id !== loadedRevision) {
    load(current.revision.id);
  }
  $: loadActivityNames(generatedFrom?.simulationDatasetId, stepActivityIds);
  $: selectedKey =
    selected && current && selected.sourceId === current.binding.id
      ? [...records.values()].find(record => record.id === selected?.activityId)?.source_key
      : undefined;
  $: if (selectedKey) {
    reveal(sections.flatMap(s => s.entries).find(e => e.recordKey === selectedKey)?.id ?? null, true);
  }
  $: reveal(entryId ?? null, true);
  $: provenance = checks?.provenance;
  $: verification = !checks
    ? null
    : checks.generated?.same
      ? 'Verified: this is its latest generated output, unedited'
      : checks.generated
        ? 'Differs from its latest generated output (edited, or generated again since)'
        : 'As the sequence says';
  // What disagrees with what the sequence claims: said, not hidden in the details.
  $: discrepancies = [
    ...(provenance?.sequence === 'missing'
      ? [`PlanDev has no sequence ${seqId} in simulation ${generatedFrom?.simulationDatasetId}.`]
      : []),
    ...(provenance?.plan === 'mismatch' ? [`Its simulation is of another plan than ${planName}.`] : []),
    ...(provenance?.stepActivities.unassigned.length
      ? [
          `${provenance.stepActivities.unassigned.length} of the activities its steps name ${provenance.stepActivities.unassigned.length === 1 ? 'is' : 'are'} not assigned to ${seqId} now.`,
        ]
      : []),
    ...(checks?.file === 'changed' ? ['The SeqDev file has changed since this snapshot.'] : []),
  ];

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

  /** The names of the simulated activities steps came from (e.g. "Lunch bite 1"), read by id from the simulation. */
  let namesKey = '';
  async function loadActivityNames(datasetId: number | undefined, ids: number[]) {
    // Asked again with the same ids whenever the sections are recomputed: only a new set is read, and only the
    // latest read is kept.
    const key = `${datasetId}:${ids.join()}`;
    if (key === namesKey) {
      return;
    }
    namesKey = key;
    activityNames = new Map();
    if (datasetId === undefined || !ids.length) {
      return;
    }
    const rows = await effects
      .getAnalysisActivities(
        { activity_id: { _in: ids }, source_kind: { _eq: 'simulation' }, source_ref: { _eq: datasetId } },
        [{ activity_id: 'asc' }],
        0,
        ids.length,
        user,
      )
      .catch(() => []);
    if (key === namesKey) {
      activityNames = new Map(rows.map(row => [row.activity_id, row.name]));
    }
  }

  async function reveal(id: string | null, open: boolean) {
    if (!id) {
      return;
    }
    if (open) {
      openEntry = id;
    }
    const [section] = id.split(':');
    showAll = { ...showAll, [section]: true };
    await tick();
    list?.querySelector(`[data-entry="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function selectRecord(entry: AuthoredEntry) {
    const record = entry.recordKey ? records.get(entry.recordKey) : undefined;
    if (record && current) {
      const startMs = Date.parse(record.start_time);
      dispatch('select', {
        endMs: record.end_time ? Date.parse(record.end_time) : startMs,
        inspect: false,
        ref: { activityId: record.id, sourceId: current.binding.id },
        startMs,
      });
    }
  }

  async function selectActivity(id: number) {
    if (!simulationBinding || !simulationDataset) {
      return;
    }
    const span = (await getSimulationDatasetSpans(simulationDataset, user)).find(s => s.span_id === id);
    if (span) {
      dispatch('select', {
        endMs: span.endMs,
        inspect: true,
        ref: { activityId: id, sourceId: simulationBinding.id },
        startMs: span.startMs,
      });
    }
  }

  function addSimulation() {
    if (generatedFrom?.simulationDatasetId !== undefined) {
      addAnalysisSource({ kind: 'simulation', simulationDatasetId: generatedFrom.simulationDatasetId }, user);
    }
  }

  function formatValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  function otherMetadata(entry: AuthoredEntry): [string, unknown][] {
    return Object.entries(entry.step.metadata ?? {}).filter(([key]) => key !== 'simulatedActivityId');
  }

  function activityName(id: number): string {
    return activityNames.get(id) ?? `simulated activity ${id}`;
  }
</script>

<div class="flex h-full w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden p-2 text-xs">
  {#if !current}
    <div class="p-4 text-muted-foreground">
      This analysis has no authored sequence. Add a seqJSON source, or use Analyze sequence in SeqDev.
    </div>
  {:else}
    <section class="flex flex-col gap-1" aria-label="About this sequence">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span class="text-sm font-medium">{current.mission.sequenceId}</span>
        <span class="text-muted-foreground">{stepCount} step{stepCount === 1 ? '' : 's'}</span>
        {#if timedCount === 0}
          <span class="text-muted-foreground" title="No time is made up for steps timed relative to others"
            >· none on the timeline (no absolute times)</span
          >
        {:else if timedCount < stepCount}
          <span class="text-muted-foreground">· {timedCount} on the timeline</span>
        {/if}
      </div>
      {#if generatedFrom}
        <div aria-label="Generated from">
          Generated from {planName ?? 'a plan'}{generatedFrom.simulationDatasetId !== undefined
            ? ` · Simulation ${generatedFrom.simulationDatasetId}`
            : ''}
          {#if !simulationBinding && generatedFrom.simulationDatasetId !== undefined && !readOnly}
            <Button size="xs" variant="ghost" class="h-5 px-1.5" on:click={addSimulation}
              >Add Simulation {generatedFrom.simulationDatasetId}</Button
            >
          {/if}
        </div>
        <div class="text-muted-foreground">
          {stepActivityIds.length
            ? `${stepActivityIds.length} activit${stepActivityIds.length === 1 ? 'y' : 'ies'} contributed`
            : 'Steps not attributed to activities'}{verification ? ` · ${verification}` : ''}
        </div>
      {/if}
      {#each discrepancies as discrepancy}
        <div class="text-amber-700" role="note">{discrepancy}</div>
      {/each}
      <details class="text-muted-foreground">
        <summary class="cursor-pointer">Details</summary>
        <div class="flex flex-col gap-0.5 pt-1">
          <div>{getRevisionVersionLabel(current.revision)} (the snapshot this analysis reads; it never changes)</div>
          {#if file}
            <div>
              Snapshot of {file.workspaceName}/{file.path} (workspace {file.workspaceId}){file.conversion ||
              file.convertedFrom
                ? `, converted from ${file.conversion?.from ?? file.convertedFrom}${
                    file.conversion
                      ? file.conversion.adaptationId === null
                        ? ' by the built-in conversion'
                        : ` by adaptation ${file.conversion.adaptationId}`
                      : ''
                  }`
                : ''}.
              {checks?.file === 'unchanged'
                ? 'The file is unchanged since.'
                : checks?.file === 'unreadable'
                  ? "The file can't be read now (deleted, moved, or not shared with you)."
                  : checks?.file === 'unknown'
                    ? 'Whether the file changed since is not known.'
                    : ''}
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
            <div>
              {#if !provenance || provenance.sequence === 'unchecked'}
                Its origin is as its metadata says; not checked against PlanDev's records.
              {:else if provenance.sequence === 'verified'}
                PlanDev has sequence {seqId} in simulation {generatedFrom.simulationDatasetId}{provenance.plan ===
                'verified'
                  ? `, of plan ${generatedFrom.planId}`
                  : ''}.
              {/if}
              {#if provenance && provenance.sequence === 'verified' && stepActivityIds.length}
                Of the {stepActivityIds.length} activities its steps name, {provenance.stepActivities.verified.length}
                {provenance.stepActivities.verified.length === 1 ? 'is' : 'are'} assigned to it now (assignments can change
                after an expansion).
              {/if}
              {#if checks?.generated}
                Latest generated output: {checks.generated.at.slice(0, 16).replace('T', ' ')}.
              {/if}
            </div>
          {/if}
        </div>
      </details>
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
        {#if sections.length > 1 || query}
          <div class="sticky top-0 z-10 bg-background py-1 font-medium">
            {section.label} ({query ? `${matching.length} of ` : ''}{section.entries.length})
            {#if section.note}<span class="font-normal text-muted-foreground">· {section.note}</span>{/if}
          </div>
        {/if}
        <ol class="m-0 list-none p-0">
          {#each shown as entry (entry.id)}
            {@const time = describeStepTime(entry.step.time)}
            {@const record = entry.recordKey ? records.get(entry.recordKey) : undefined}
            <li
              data-entry={entry.id}
              class="rounded"
              class:bg-accent={openEntry === entry.id || (record !== undefined && record.source_key === selectedKey)}
            >
              <button
                class="flex w-full min-w-0 items-baseline gap-1.5 whitespace-nowrap px-1 py-0.5 text-left hover:bg-muted"
                aria-expanded={openEntry === entry.id}
                on:click={() => (openEntry = openEntry === entry.id ? null : entry.id)}
              >
                <span class="w-6 shrink-0 text-right text-muted-foreground">{entry.step.position}</span>
                <span class="shrink-0 font-medium" title={entry.step.description ?? ''}
                  >{entry.step.name ?? entry.step.type}</span
                >
                {#if entry.step.type !== 'command'}<span class="text-[10px] text-muted-foreground"
                    >{entry.step.type}</span
                  >{/if}
                <span class="min-w-0 truncate text-muted-foreground">{formatStepArgs(entry.step.args)}</span>
                <span class="ml-auto shrink-0" class:text-muted-foreground={!record} title={time.meaning}
                  >{time.label}</span
                >
              </button>
              {#if openEntry === entry.id}
                <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 pb-2 pl-8">
                  <dt class="text-muted-foreground">Time</dt>
                  <dd class="m-0">
                    {time.meaning}
                    {#if entry.step.dataQuality}<div class="text-amber-700">{entry.step.dataQuality}</div>{/if}
                  </dd>
                  {#if entry.step.args && !Array.isArray(entry.step.args)}
                    {#each Object.entries(entry.step.args) as [name, value]}
                      <dt class="text-muted-foreground">{name}</dt>
                      <dd class="m-0 break-all">{formatValue(value)}</dd>
                    {/each}
                  {:else if entry.step.args?.length}
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
                    <dt class="text-muted-foreground">From</dt>
                    <dd class="m-0">
                      {#if simulationBinding}
                        <button class="text-primary underline" on:click={() => selectActivity(id)}
                          >{activityName(id)}</button
                        >
                      {:else}
                        {activityName(id)}
                      {/if}
                      {#if provenance?.stepActivities.unassigned.includes(id)}
                        <span
                          class="text-amber-700"
                          title="As the step says; PlanDev doesn't assign it to this sequence now"
                          >not assigned now</span
                        >
                      {/if}
                    </dd>
                  {/if}
                  <dt class="text-muted-foreground">Timeline</dt>
                  <dd class="m-0">
                    {#if record}
                      <button class="text-primary underline" on:click={() => selectRecord(entry)}
                        >Show on timeline</button
                      >
                    {:else}
                      <span class="text-muted-foreground"
                        >{entry.recordKey ? 'Its record was not found' : 'Not on it: no absolute time'}</span
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
