<svelte:options immutable={true} />

<script lang="ts">
  import { env } from '$env/dynamic/public';
  import type { CosmolabeViewer } from '@cosmolabe/viewer';
  import { onDestroy } from 'svelte';
  import { activityDirectivesMap, selectActivity, selectedActivityDirectiveId } from '../../stores/activities';
  import { plan, planEndTimeMs, planStartTimeMs, timeCursorMs, viewTimeRange } from '../../stores/plan';
  import { latestSchedulingRequest, schedulingGoalSpecifications } from '../../stores/scheduling';
  import { selectedSpanId, simulationDatasetId, spanUtilityMaps, spans, spansMap } from '../../stores/simulation';
  import type { User } from '../../types/app';
  import type { ViewGridSection } from '../../types/view';
  import {
    activityId,
    planetocentric,
    resolveMission,
    spanIdOf,
    spansToActivities,
    type CosmolabeAdapter,
    type CosmolabeMission,
    type CosmolabeProposal,
  } from '../../utilities/cosmolabe';
  import effects from '../../utilities/effects';
  import GridMenu from '../menus/GridMenu.svelte';
  import Panel from '../ui/Panel.svelte';

  export let gridSection: ViewGridSection;
  export let user: User | null = null;

  type CosmolabeModule = typeof import('@cosmolabe/viewer');
  type ScriptProbePoint = NonNullable<ReturnType<CosmolabeViewer['control']['getProbePoint']>>;
  const OWNER = 'plandev';
  const TARGET_LAYER = 'PlanDev targets (goal arguments)';

  let container: HTMLDivElement;
  let lib: CosmolabeModule | null = null;
  let viewer: CosmolabeViewer | null = null;
  let mission: CosmolabeMission | null = null;
  let adapter: CosmolabeAdapter | null = null;
  let status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error' = 'idle';
  let message = '';
  let offs: (() => void)[] = [];
  let loadedModel: string | undefined = undefined;
  let loading: Promise<void> = Promise.resolve();

  /** The last cursor time the viewer itself set, so its echo through PlanDev's store is not sent back. */
  let cursorFromViewerMs: number | null = null;
  let probe: ScriptProbePoint | null = null;
  let eventWindow: { detail: string; endMs: number; startMs: number } | null = null;
  let halfWindowMin = 30;
  let staging = false;
  let targetLayer: string | null = null;
  let targetFeatures: (string | number)[] = [];
  let vehicleState = '';

  $: modelName = $plan?.model?.name;
  $: if (container && modelName !== loadedModel) {
    loadedModel = modelName;
    loading = loading.then(() => open(modelName));
  }

  // ── PlanDev → Cosmolabe ────────────────────────────────────────────────────────────────
  $: ready = status === 'ready' && viewer !== null;
  $: if (ready) {
    pushTime($timeCursorMs ?? $planStartTimeMs);
  }
  $: if (ready) {
    pushActivities($spans, $simulationDatasetId);
  }
  $: selectedSpan =
    $selectedSpanId ??
    ($selectedActivityDirectiveId !== null
      ? ($spanUtilityMaps.directiveIdToSpanIdMap[$selectedActivityDirectiveId] ?? null)
      : null);
  $: if (ready) {
    pushSelection(selectedSpan);
  }
  $: goalSpec = adapter
    ? ($schedulingGoalSpecifications.find(spec => spec.goal_metadata?.name === adapter?.targets.goal) ?? null)
    : null;
  $: staged = adapter && goalSpec ? safeRead(adapter, goalSpec.arguments) : [];
  $: if (ready) {
    pushTargets(staged);
  }

  // ── Cosmolabe → PlanDev: a proposal ──────────────────────────────────────────────────────
  $: location =
    probe && adapter ? { ...planetocentric(probe.point.bodyFixedPositionKm), body: probe.point.bodyName } : null;
  $: cursorMs = $timeCursorMs ?? $planStartTimeMs;
  $: proposedWindow = eventWindow ?? {
    detail: `cursor ± ${halfWindowMin} min`,
    endMs: cursorMs + halfWindowMin * 60_000,
    startMs: cursorMs - halfWindowMin * 60_000,
  };
  $: windowProblem =
    proposedWindow.startMs < $planStartTimeMs || proposedWindow.endMs > $planEndTimeMs
      ? 'extends outside the plan; PlanDev will reject it'
      : '';
  $: proposal =
    location && $plan && adapter
      ? ({
          body: location.body,
          frame: probe?.point.frame ?? `IAU_${location.body.toUpperCase()}`,
          id: `cosmo-${Date.now().toString(36)}`,
          latDeg: location.latDeg,
          lonDeg: location.lonDeg,
          name: `${location.body} ${location.latDeg.toFixed(2)}°, ${location.lonDeg.toFixed(2)}°`,
          source: {
            app: 'cosmolabe',
            location: 'probe',
            planId: $plan.id,
            simulationDatasetId: $simulationDatasetId >= 0 ? $simulationDatasetId : null,
            window: eventWindow ? 'event-result' : 'viewer-time',
            windowDetail: proposedWindow.detail,
          },
          window: {
            end: new Date(proposedWindow.endMs).toISOString(),
            start: new Date(proposedWindow.startMs).toISOString(),
          },
        } satisfies CosmolabeProposal)
      : null;
  $: problems = proposal && adapter ? adapter.targets.check(proposal) : [];
  $: request = $latestSchedulingRequest;

  async function open(model: string | undefined) {
    await close();
    const indexUrl = env.PUBLIC_COSMOLABE_MISSIONS_URL;
    if (!indexUrl) {
      return fail('unavailable', 'PUBLIC_COSMOLABE_MISSIONS_URL is not set: no 3D mission scenes are configured.');
    }
    status = 'loading';
    message = 'Loading mission scene…';
    try {
      const found = resolveMission(await (await fetch(indexUrl)).json(), indexUrl, model);
      if (!found) {
        return fail('unavailable', `No 3D mission scene for model “${model ?? '—'}”.`);
      }
      mission = found;
      adapter = (await import(/* @vite-ignore */ found.adapterUrl)) as CosmolabeAdapter;
      lib ??= await import('@cosmolabe/viewer');
      viewer = await lib.mountCosmolabe(container, {
        // PlanDev's own timeline, plans and activity tables stay in PlanDev.
        ui: { catalogBrowser: false, homeScreen: false, timeline: false },
      });
      viewer.control.setPlaying(false);
      listen(viewer, lib);
      await viewer.loadCatalog(found.catalogUrl);
      // The scene follows PlanDev's clock; it does not start playing on its own.
      viewer.control.setPlaying(false);
      if (import.meta.env.DEV) {
        // ponytail: dev-only handle for browser tests; no production code reads it.
        (window as unknown as { plandevCosmolabe: CosmolabeViewer }).plandevCosmolabe = viewer;
      }
      status = 'ready';
      message = '';
    } catch (e) {
      const text = (e as Error).message ?? String(e);
      await close();
      fail('error', /already mounted/.test(text) ? 'The 3D view is already open in another panel.' : text);
    }
  }

  function fail(s: typeof status, m: string) {
    status = s;
    message = m;
  }

  async function close() {
    offs.forEach(off => off());
    offs = [];
    const v = viewer;
    viewer = null;
    status = 'idle';
    probe = null;
    eventWindow = null;
    targetLayer = null;
    targetFeatures = [];
    await v?.dispose();
  }

  function listen(v: CosmolabeViewer, cl: CosmolabeModule) {
    const c = v.control;
    offs.push(
      c.on('time', ({ cause, et }) => {
        // Loading a scene is not the operator moving time; PlanDev keeps its cursor.
        if (cause === 'host' || status !== 'ready') {
          return;
        }
        readVehicle();
        const ms = Math.round(cl.etToDate(et).getTime());
        cursorFromViewerMs = ms;
        timeCursorMs.set(ms);
        reveal(ms);
      }),
      c.on('activitySelect', ({ id }) => {
        const spanId = $plan ? spanIdOf(id, $plan.id, $simulationDatasetId) : null;
        // Only PlanDev's own activities select in PlanDev; anything else in the scene stays a scene selection.
        if (spanId !== null && spanId !== $selectedSpanId && $spansMap?.[spanId]) {
          selectActivity(null, spanId, false);
        }
      }),
      c.on('probe', () => {
        probe = c.getProbePoint?.() ?? null;
      }),
      c.on('events', () => (eventWindow = selectedEventWindow(v, cl))),
    );
  }

  /** The Event Finder result selected in the viewer, as a window: exploratory, from the viewer's own kernels. */
  function selectedEventWindow(v: CosmolabeViewer, cl: CosmolabeModule) {
    const ref = v.control.getEventVisualization?.().selected;
    let event = null;
    try {
      // Result pages are bounded; walk them for the selected id.
      for (let offset = 0; ref && !event; offset += 100) {
        const page = v.control.listEventResults?.(ref.query, { limit: 100, offset });
        if (!page?.items.length) {
          break;
        }
        event = page.items.find(e => e.id === ref.id) ?? null;
      }
    } catch {
      return null;
    }
    if (!event) {
      return null;
    }
    const ms = (et: number) => cl.etToDate(et).getTime();
    const [s, e] = event.temporality === 'interval' ? [ms(event.start), ms(event.end)] : [ms(event.et), ms(event.et)];
    const pad = e - s < 60_000 ? halfWindowMin * 60_000 : 0;
    return {
      detail: `Event Finder: ${event.label}${pad ? ` ± ${halfWindowMin} min` : ''}`,
      endMs: e + pad,
      startMs: s - pad,
    };
  }

  /** Whether the scene has the vehicle's position at its current time (the viewer's kernels; exploratory). */
  function readVehicle() {
    const a = adapter && viewer?.control.getObjectState?.(adapter.vehicle)?.positionAvailability;
    vehicleState = !a
      ? ''
      : a.available
        ? 'position available'
        : `no position (${a.message ?? a.reason ?? 'unavailable'})`;
  }

  function pushTime(ms: number) {
    if (!viewer || !lib || !Number.isFinite(ms) || ms === cursorFromViewerMs) {
      return;
    }
    cursorFromViewerMs = null;
    viewer.control.setTime({ et: lib.etFromCalendarString(new Date(ms).toISOString()), kind: 'et' });
    readVehicle();
  }

  function pushActivities(list: typeof $spans, datasetId: number) {
    if (!viewer || !adapter || !$plan) {
      return;
    }
    if (!list || datasetId < 0) {
      viewer.activities.remove(OWNER);
      return;
    }
    viewer.activities.replace(
      OWNER,
      spansToActivities(list, {
        body: adapter.body,
        datasetId,
        planId: $plan.id,
        planName: $plan.name,
        vehicle: adapter.vehicle,
      }),
    );
  }

  let lastSelected: number | null = null;
  function pushSelection(spanId: number | null) {
    if (!viewer || !$plan || spanId === lastSelected) {
      return;
    }
    lastSelected = spanId;
    const id = spanId !== null ? activityId($plan.id, $simulationDatasetId, spanId) : null;
    if (id === null || viewer.control.getSelectedActivity?.()?.id === id) {
      return;
    }
    viewer.control.selectActivity?.(id);
    // The vehicle is selected (highlighted) too; the camera stays where the operator left it.
    if (adapter) {
      viewer.control.select(adapter.vehicle);
    }
    // PlanDev's cursor goes to the activity, and the scene with it.
    const span = $spansMap?.[spanId as number];
    if (span) {
      timeCursorMs.set(span.startMs);
      // Set from inside a reactive statement, the store change does not re-run `pushTime`'s statement.
      pushTime(span.startMs);
      reveal(span.startMs);
    }
  }

  /** Targets in the goal's arguments, drawn in the scene as read-only context. */
  function pushTargets(list: typeof staged) {
    const c = viewer?.control;
    if (!c || !adapter) {
      return;
    }
    targetLayer ??=
      c.createAnnotationLayer?.(adapter.targets.body, TARGET_LAYER, adapter.targets.coordinates as never) || null;
    if (!targetLayer) {
      return;
    }
    targetFeatures.forEach(featureId => c.editAnnotation?.(targetLayer as string, { featureId, type: 'delete' }));
    targetFeatures = list
      .map(
        t =>
          c.editAnnotation?.(targetLayer as string, {
            geometry: { coordinates: [t.lonDeg, t.latDeg], type: 'Point' },
            properties: { name: t.name, target: t.id },
            type: 'add',
          }) || null,
      )
      .filter(r => r !== null)
      .map(r => r.featureId);
  }

  function safeRead(a: CosmolabeAdapter, args: unknown) {
    try {
      return a.targets.read(args);
    } catch {
      return [];
    }
  }

  /** Scrolls the timeline, keeping its zoom, so that `ms` is visible. */
  function reveal(ms: number) {
    const { end, start } = $viewTimeRange;
    if (ms < start || ms > end) {
      const half = (end - start) / 2;
      viewTimeRange.set({ end: ms + half, start: ms - half });
    }
  }

  async function stage() {
    if (!adapter || !goalSpec || !proposal || !$plan || !goalSpec.goal_metadata) {
      return;
    }
    staging = true;
    try {
      const schema = goalSpec.goal_metadata.versions[0]?.parameter_schema;
      await effects.updateSchedulingGoalPlanSpecification(
        $plan,
        { ...goalSpec, arguments: adapter.targets.stage(goalSpec.arguments, proposal) },
        schema as never,
        [],
        user,
      );
      probe = null;
      viewer?.control.clearProbePoint?.();
    } finally {
      staging = false;
    }
  }

  async function unstage(id: string) {
    if (adapter && goalSpec && $plan && goalSpec.goal_metadata) {
      await effects.updateSchedulingGoalPlanSpecification(
        $plan,
        { ...goalSpec, arguments: adapter.targets.remove(goalSpec.arguments, id) },
        goalSpec.goal_metadata.versions[0]?.parameter_schema as never,
        [],
        user,
      );
    }
  }

  /** What PlanDev decided about a staged target, from the plan and the latest scheduling run only. */
  function outcome(id: string, directives: typeof $activityDirectivesMap, req: typeof request) {
    const name = adapter?.targets.directiveName(id);
    const created = Object.values(directives ?? {}).find(d => d.name === name) ?? null;
    if (created) {
      return { created, rejected: false, text: `planned: ${created.type}` };
    }
    const reason = (req?.reason as { message?: string } | null)?.message ?? '';
    if (req?.status === 'failed' && reason.includes(`target ${id} `)) {
      return { created: null, rejected: true, text: `rejected: ${reason.replace(`target ${id} `, '')}` };
    }
    return { created: null, rejected: false, text: 'staged: run scheduling to evaluate' };
  }

  function fmt(ms: number) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }

  onDestroy(() => {
    loading = loading.then(close);
  });
</script>

<Panel padBody={false}>
  <svelte:fragment slot="header">
    <GridMenu {gridSection} title="3D Mission View" />
    <span class="truncate text-xs text-muted-foreground" title={mission?.catalogUrl}>
      {mission?.label ?? ''}
    </span>
  </svelte:fragment>

  <svelte:fragment slot="body">
    <div class="cosmolabe-panel">
      <div class="cosmolabe-viewer" bind:this={container} />
      {#if status !== 'ready'}
        <div class="cosmolabe-overlay" class:error={status === 'error'}>{message}</div>
      {/if}
      {#if ready && adapter}
        <div class="cosmolabe-proposal">
          <div class="muted">
            {adapter.vehicle} in the 3D view at the cursor:
            <span class:warn={!vehicleState.startsWith('position')}>{vehicleState}</span> (scene kernels; exploratory, not
            PlanDev's evaluation)
          </div>
          {#if location}
            <div>
              <b>Location</b>
              {location.body}
              lat {location.latDeg.toFixed(4)}°, lon {location.lonDeg.toFixed(4)}°
              <span class="muted">(planetocentric, east-positive, {proposal?.frame}; pinned in the 3D view)</span>
            </div>
            <div>
              <b>Window</b>
              {fmt(proposedWindow.startMs)} – {fmt(proposedWindow.endMs)} UTC
              <span class="muted">({proposedWindow.detail})</span>
              {#if !eventWindow}
                ±<input class="st-input w-12" type="number" min="1" max="720" bind:value={halfWindowMin} /> min
              {/if}
              {#if windowProblem}<span class="warn">{windowProblem}</span>{/if}
            </div>
            {#each problems as problem}<div class="warn">{problem}</div>{/each}
            <button
              class="st-button"
              disabled={!goalSpec || problems.length > 0 || staging}
              title={goalSpec ? '' : `This plan has no ${adapter.targets.goal} goal`}
              on:click={stage}
            >
              Stage as {adapter.targets.goal} target
            </button>
            <span class="muted">A proposal only: PlanDev evaluates it when scheduling runs.</span>
          {:else}
            <span class="muted">
              Pin a point on {adapter.targets.body} in the 3D view (point probe) to propose an observation target{eventWindow
                ? ` for ${eventWindow.detail}`
                : ''}.
            </span>
          {/if}

          {#if staged.length}
            <div class="cosmolabe-staged">
              <b>{adapter.targets.goal} targets</b>
              <button class="st-button secondary" on:click={() => effects.schedule(false, $plan, user)}>
                Run scheduling
              </button>
              {#if request}
                <span class="muted">latest run #{request.analysis_id}: {request.status}</span>
              {/if}
              {#each staged as target (target.id)}
                {@const result = outcome(target.id, $activityDirectivesMap, request)}
                <div class="row" class:rejected={result.rejected}>
                  <span>{target.name}</span>
                  {#if target.window}
                    <span class="muted">{target.window.start.slice(0, 16)} – {target.window.end.slice(11, 16)}</span>
                  {/if}
                  {#if result.created}
                    <button class="link" on:click={() => selectActivity(result.created.id, null, false)}>
                      {result.text} at {fmt(result.created.start_time_ms)} UTC
                    </button>
                  {:else}
                    <span>{result.text}</span>
                  {/if}
                  <button class="link" title="Remove from the goal's arguments" on:click={() => unstage(target.id)}>
                    ×
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </svelte:fragment>
</Panel>

<style>
  .cosmolabe-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
  }
  .cosmolabe-viewer {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .cosmolabe-overlay {
    align-items: center;
    color: var(--st-gray-60, #666);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: 16px;
    position: absolute;
    text-align: center;
  }
  .cosmolabe-overlay.error {
    color: var(--st-error-red, #b00020);
  }
  .cosmolabe-proposal {
    border-top: 1px solid var(--st-gray-20, #ddd);
    display: flex;
    flex-direction: column;
    font-size: 12px;
    gap: 4px;
    max-height: 40%;
    overflow: auto;
    padding: 6px 8px;
  }
  .cosmolabe-staged .row {
    display: flex;
    gap: 8px;
  }
  .muted {
    color: var(--st-gray-60, #666);
  }
  .warn,
  .rejected {
    color: var(--st-error-red, #b00020);
  }
  .link {
    background: none;
    border: 0;
    color: var(--st-primary-60, #2f6fde);
    cursor: pointer;
    padding: 0;
  }
</style>
