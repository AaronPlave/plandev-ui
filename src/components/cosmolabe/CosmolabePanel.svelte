<svelte:options immutable={true} />

<script lang="ts">
  import { env } from '$env/dynamic/public';
  import type { CosmolabeViewer, HostObservationPick, MissionActivitySpec } from '@cosmolabe/viewer';
  import { onDestroy } from 'svelte';
  import { activityDirectivesMap, selectActivity, selectedActivityDirectiveId } from '../../stores/activities';
  import { plan, planEndTimeMs, planRevision, planStartTimeMs, timeCursorMs, viewTimeRange } from '../../stores/plan';
  import { expandedGridSection } from '../../stores/views';
  import {
    latestSchedulingRequest,
    schedulingGoalSpecifications,
    schedulingPlanSpecification,
  } from '../../stores/scheduling';
  import {
    selectedSpanId,
    simulationDataset,
    simulationDatasetId,
    spanUtilityMaps,
    spans,
    spansMap,
  } from '../../stores/simulation';
  import type { SimulationDataset, Span } from '../../types/simulation';
  import { getIntervalInMs } from '../../utilities/time';
  import type { User } from '../../types/app';
  import type { ViewGridSection } from '../../types/view';
  import {
    activityId,
    destinationOf,
    destinationProblems,
    findPasses,
    fitToPlan,
    formatLatLon,
    planetocentric,
    resolveMission,
    selectionAction,
    sensorIntervals,
    simulatedStateSource,
    spanIdOf,
    stateSamples,
    spansToActivities,
    targetOutcome,
    windowProblems,
    withDestination,
    type CosmolabeAdapter,
    type CosmolabeMission,
    type CosmolabeObservation,
    type CosmolabeProposal,
    type Interval,
    type PassSearch,
  } from '../../utilities/cosmolabe';
  import effects from '../../utilities/effects';
  import GridMenu from '../menus/GridMenu.svelte';
  import Panel from '../ui/Panel.svelte';

  export let gridSection: ViewGridSection;
  export let user: User | null = null;

  type CosmolabeModule = typeof import('@cosmolabe/viewer');
  type ScriptProbePoint = NonNullable<ReturnType<CosmolabeViewer['control']['getProbePoint']>>;
  /** Where the proposed window comes from: the cursor, a found pass, or an Event Finder result. */
  type WindowBase =
    | { kind: 'cursor' }
    | { kind: 'pass'; ms: number }
    | { detail: string; endMs: number; kind: 'event' | 'staged'; startMs: number };
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
  /** The host activities last given to the viewer. */
  let pushedActivities: MissionActivitySpec[] = [];
  /** The viewer's selected activity, as its last `activitySelect` said. */
  let viewerActivity: string | null = null;
  let probe: ScriptProbePoint | null = null;
  /** A staged target loaded back into the form; proposing then replaces it under the same id. */
  let editing: (typeof staged)[number] | null = null;
  let base: WindowBase = { kind: 'cursor' };
  let lastEvent = '';
  /** An explicit "fit to plan" of the window; any new window choice drops it. */
  let fitted: (Interval & { from: string }) | null = null;
  let halfWindowMin = 15;
  let staging = false;
  let targetLayer: string | null = null;
  let targetFeatures: (string | number)[] = [];
  /** The selected activity's mission-evaluated observations, as given to the scene (with their pick details). */
  let shownObservations: CosmolabeObservation[] = [];
  /** What the operator last picked among them in the scene. */
  let observationPick: HostObservationPick | null = null;
  let vehicleState = '';
  /** The operator's Timeline toggle; null follows the panel (shown while expanded). */
  let timelineChoice: boolean | null = null;
  /** "Show FOV": instrument FOVs drawn even while their sensor is not acquiring. */
  let showIdleFov = false;
  let destinationBusy = false;
  let destinationNote = '';

  let searchFrom = '';
  let searchTo = '';
  let rangeForPlan: number | null = null;
  let searching = false;
  let searchError = '';
  let search: (PassSearch & { at: string; range: Interval; unavailable: string }) | null = null;

  $: modelName = $plan?.model?.name;
  $: if (container && modelName !== loadedModel) {
    loadedModel = modelName;
    loading = loading.then(() => open(modelName));
  }
  $: if ($plan && $plan.id !== rangeForPlan) {
    rangeForPlan = $plan.id;
    searchFrom = isoInput($planStartTimeMs);
    searchTo = isoInput($planEndTimeMs);
  }

  // ── PlanDev → Cosmolabe ────────────────────────────────────────────────────────────────
  $: ready = status === 'ready' && viewer !== null;
  // Cosmolabe's own timeline: hidden in the compact panel (PlanDev's timeline is beside it), shown when expanded,
  // or as the operator toggles it. Its window follows PlanDev's view window; the cursor is shared both ways.
  $: expanded = $expandedGridSection === gridSection;
  $: showTimeline = timelineChoice ?? expanded;
  $: if (ready) {
    viewer?.setUi({ timeline: showTimeline });
  }
  $: if (ready && showTimeline) {
    pushTimeWindow($viewTimeRange);
  }
  $: if (ready) {
    viewer?.sensors.showIdle(showIdleFov);
  }
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
  /** PlanDev's selection as the viewer names it: plan + simulation dataset + span. */
  $: wantedActivity =
    $plan && selectedSpan !== null && $simulationDatasetId >= 0
      ? activityId($plan.id, $simulationDatasetId, selectedSpan)
      : null;
  $: if (ready) {
    pushSelection(wantedActivity);
  }
  $: if (ready && adapter?.observations) {
    pushObservations(selectedSpan !== null ? ($spansMap?.[selectedSpan] ?? null) : null, $simulationDatasetId);
  }
  $: picked = pickDetails(observationPick, shownObservations);
  $: goalSpec = adapter?.targets
    ? ($schedulingGoalSpecifications.find(spec => spec.goal_metadata?.name === adapter?.targets?.goal) ?? null)
    : null;
  // Vehicles whose state is the simulation's: follow the selected simulation dataset.
  // The selected dataset's record arrives after its id: until it does, nothing from the previous one is shown.
  $: if (ready && adapter?.missionState) {
    pushMissionState($simulationDataset?.id === $simulationDatasetId ? $simulationDataset : null, $simulationDatasetId);
  }
  /** The selected simulation was run on an earlier revision of the plan: what the scene shows is out of date. */
  $: stateStale =
    adapter?.missionState && $simulationDataset && $simulationDataset.plan_revision !== $planRevision
      ? `Showing simulation ${$simulationDataset.id} of plan revision ${$simulationDataset.plan_revision}; the plan has changed since (revision ${$planRevision}). Simulate to see the current flights.`
      : '';
  $: staged = adapter && goalSpec ? safeRead(adapter, goalSpec.arguments) : [];
  // A goal that takes one surface destination: its current value, drawn in the scene like staged targets.
  $: destinationGoal = adapter?.destination
    ? ($schedulingGoalSpecifications.find(spec => spec.goal_metadata?.name === adapter?.destination?.goal) ?? null)
    : null;
  $: destination =
    adapter?.destination && destinationGoal ? destinationOf(adapter.destination, destinationGoal.arguments) : null;
  $: if (ready) {
    pushTargets(
      adapter?.destination
        ? destination
          ? [
              {
                id: 'destination',
                name: `${adapter.destination.label} (${adapter.destination.goal} goal)`,
                ...destination,
                window: null,
              },
            ]
          : []
        : staged,
    );
  }
  /** The probed point as a destination candidate: planetocentric, from the probe's body-fixed point. */
  $: pickedPoint = probe
    ? {
        ...planetocentric(probe.point.bodyFixedPositionKm),
        body: probe.point.bodyName,
        frame: probe.point.frame ?? 'unknown frame',
      }
    : null;
  $: pickedProblems =
    adapter?.destination && pickedPoint
      ? [
          ...destinationProblems(adapter.destination, pickedPoint),
          ...(destinationGoal ? [] : [`This plan has no ${adapter.destination.goal} goal. Add it in Scheduling.`]),
        ]
      : [];

  // ── Cosmolabe → PlanDev: a proposal ──────────────────────────────────────────────────────
  $: planBounds = { endMs: $planEndTimeMs, startMs: $planStartTimeMs };
  $: location = editing
    ? { body: adapter?.targets?.body ?? '', latDeg: editing.latDeg, lonDeg: editing.lonDeg }
    : probe && adapter
      ? { ...planetocentric(probe.point.bodyFixedPositionKm), body: probe.point.bodyName }
      : null;
  $: locationKey = location ? `${location.body}/${location.latDeg}/${location.lonDeg}` : '';
  // Pass results belong to the location they were searched for.
  $: if (search && search.at !== locationKey) {
    search = null;
  }
  $: cursorMs = $timeCursorMs ?? $planStartTimeMs;
  $: raw = rawWindow(base, cursorMs, halfWindowMin);
  // A fit applies only to the window it was made from: any change to that window (cursor, pass, ±) drops it.
  $: rawKey = `${raw.startMs}/${raw.endMs}`;
  $: proposedWindow = fitted?.from === rawKey ? { ...fitted, detail: `${raw.detail}, fitted to the plan` } : raw;
  $: windowIssues = windowProblems(proposedWindow, planBounds);
  $: canFit = windowIssues.length > 0 && fitToPlan(proposedWindow, planBounds) !== null;
  $: proposal =
    location && $plan && adapter
      ? ({
          body: location.body,
          frame: probe?.point.frame ?? `IAU_${location.body.toUpperCase()}`,
          id: editing?.id ?? `cosmo-${Date.now().toString(36)}`,
          latDeg: location.latDeg,
          lonDeg: location.lonDeg,
          name: editing?.name ?? `${location.body} ${location.latDeg.toFixed(2)}°, ${location.lonDeg.toFixed(2)}°`,
          source: {
            app: 'cosmolabe',
            location: editing ? 'staged-target' : 'probe',
            planId: $plan.id,
            simulationDatasetId: $simulationDatasetId >= 0 ? $simulationDatasetId : null,
            window: base.kind === 'event' ? 'event-result' : base.kind === 'pass' ? 'pass-search' : 'viewer-time',
            windowDetail: proposedWindow.detail,
          },
          window: {
            // Empty when the window is invalid; `problems` then blocks staging.
            end: Number.isFinite(proposedWindow.endMs) ? new Date(proposedWindow.endMs).toISOString() : '',
            start: Number.isFinite(proposedWindow.startMs) ? new Date(proposedWindow.startMs).toISOString() : '',
          },
        } satisfies CosmolabeProposal)
      : null;
  $: halfValid = typeof halfWindowMin === 'number' && halfWindowMin > 0;
  $: problems = [
    // The window is checked here (against the plan) unless it is already invalid; the adapter checks the rest.
    ...(proposal && adapter
      ? (adapter.targets?.check({ ...proposal, window: windowIssues.length ? null : proposal.window }) ?? [])
      : []),
    ...(halfValid || (base.kind !== 'cursor' && base.kind !== 'pass' && raw === base)
      ? windowIssues
      : ['Enter the window’s ± minutes (more than 0).']),
    ...(adapter?.targets && !goalSpec ? [`This plan has no ${adapter.targets.goal} goal. Add it in Scheduling.`] : []),
  ];
  $: request = $latestSchedulingRequest;
  $: specRevision = $schedulingPlanSpecification?.revision;

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
    editing = null;
    base = { kind: 'cursor' };
    fitted = null;
    lastEvent = '';
    search = null;
    viewerActivity = null;
    pushedActivities = [];
    stateFor = '';
    stateRequest++;
    targetLayer = null;
    targetFeatures = [];
    shownObservations = [];
    observationPick = null;
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
        const was = viewerActivity;
        viewerActivity = id;
        if (id === null) {
          // The viewer let go of PlanDev's selected activity (the operator cleared it, or its record went).
          if (was !== null && was === wantedActivity) {
            selectActivity(null, null, false);
          }
          return;
        }
        const spanId = $plan ? spanIdOf(id, $plan.id, $simulationDatasetId) : null;
        // Only PlanDev's own activities select in PlanDev; anything else in the scene stays a scene selection.
        if (spanId !== null && spanId !== selectedSpan && $spansMap?.[spanId]) {
          selectActivity(null, spanId, false);
        }
      }),
      v.observations.onSelect(pick => {
        observationPick = pick;
        // A footprint that is one exposure's span selects that span in PlanDev (its parent stays its context).
        const o = shownObservations.find(x => x.spec.name === pick.name);
        const spanId = pick.footprint !== null ? o?.footprintSpans?.[pick.footprint] : null;
        if (spanId != null && spanId !== selectedSpan && $spansMap?.[spanId]) {
          selectActivity(null, spanId, false);
        }
      }),
      c.on('probe', () => {
        probe = c.getProbePoint?.() ?? null;
        if (probe) {
          editing = null; // a new pin starts a new proposal
        }
      }),
      c.on('events', () => {
        const event = selectedEventWindow(v, cl);
        const key = event ? `${event.detail}/${event.startMs}/${event.endMs}` : '';
        // A newly selected Event Finder result becomes the window; one that stays selected does not override a
        // later choice (a pass, the cursor).
        if (key !== lastEvent) {
          lastEvent = key;
          if (event) {
            chooseWindow({ ...event, kind: 'event' });
          } else if (base.kind === 'event') {
            chooseWindow({ kind: 'cursor' });
          }
        }
      }),
    );
  }

  /** The Event Finder result selected in the viewer, as a window: exploratory, from the viewer's own kernels. */
  function selectedEventWindow(v: CosmolabeViewer, cl: CosmolabeModule) {
    const ref = v.control.getEventVisualization?.().selected;
    if (!ref || ref.query.startsWith('activity:')) {
      return null; // a selected activity is not an event search result
    }
    let event = null;
    try {
      // Result pages are bounded; walk them for the selected id.
      for (let offset = 0; !event; offset += 100) {
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
    return { detail: `Event Finder result “${event.label}”`, endMs: e, startMs: s };
  }

  function rawWindow(b: WindowBase, cursor: number, half: number) {
    // An emptied input binds null: no window rather than a zero-length one.
    const ok = typeof half === 'number' && half > 0;
    const pad = (ok ? half : NaN) * 60_000;
    const pm = `± ${ok ? half : '?'} min`;
    if (b.kind === 'event' || b.kind === 'staged') {
      // An instant event gets the ± padding; an interval is used as found.
      return b.endMs - b.startMs < 60_000
        ? { detail: `${b.detail} ${pm}`, endMs: b.endMs + pad, startMs: b.startMs - pad }
        : b;
    }
    const at = b.kind === 'pass' ? b.ms : cursor;
    const what = b.kind === 'pass' ? `sampled pass at ${fmt(at).slice(11)}` : 'time cursor';
    return { detail: `${what} ${pm}`, endMs: at + pad, startMs: at - pad };
  }

  function fit() {
    const f = fitToPlan(proposedWindow, planBounds);
    fitted = f && { ...f, from: rawKey };
  }

  function chooseWindow(b: WindowBase) {
    base = b;
    fitted = null;
  }

  /** Whether the scene has the vehicle's position at its current time (the viewer's kernels; exploratory). */
  function readVehicle() {
    const a = adapter && viewer?.control.getObjectState?.(adapter.vehicle)?.positionAvailability;
    vehicleState = !a
      ? ''
      : a.available
        ? ''
        : `${adapter?.vehicle} position unavailable here: ${a.message ?? a.reason}`;
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
    pushedActivities =
      list && datasetId >= 0
        ? spansToActivities(list, {
            body: adapter.body,
            datasetId,
            planId: $plan.id,
            planName: $plan.name,
            vehicle: adapter.vehicle,
            vehicleOf: adapter.vehicleOf,
          })
        : [];
    viewer.activities.replace(OWNER, pushedActivities);
  }

  function pushSelection(want: string | null) {
    if (!viewer) {
      return;
    }
    const action = selectionAction(want, viewer.control.getSelectedActivity?.()?.id);
    if (action?.kind === 'clear') {
      // ponytail: the host API has no "deselect activity"; Cosmolabe drops the selection of an activity whose
      // record goes away, so the record is removed and restored. Scene object selection is untouched.
      const id = viewer.control.getSelectedActivity?.()?.id;
      viewer.activities.replace(
        OWNER,
        pushedActivities.filter(a => a.id !== id),
      );
      viewer.activities.replace(OWNER, pushedActivities);
    } else if (action?.kind === 'select' && viewer.control.selectActivity?.(action.id)) {
      // PlanDev's cursor goes to the activity, and the scene with it; the camera stays where the operator left it.
      const span = selectedSpan !== null ? $spansMap?.[selectedSpan] : null;
      if (span) {
        moveTime(span.startMs);
      }
    }
  }

  function moveTime(ms: number) {
    timeCursorMs.set(ms);
    // Set from inside a reactive statement, the store change does not re-run `pushTime`'s statement.
    pushTime(ms);
    reveal(ms);
  }

  /** Targets in the goal's arguments, drawn in the scene as read-only context. */
  function pushTargets(list: typeof staged) {
    const c = viewer?.control;
    const where = adapter?.targets ?? adapter?.destination;
    if (!c || !where) {
      return;
    }
    targetLayer ??= c.createAnnotationLayer?.(where.body, TARGET_LAYER, where.coordinates as never) || null;
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

  /**
   * The selected activity's mission evaluation (survey footprints and the target they were asked to cover) as
   * read-only scene observations, replacing the previous ones. Attributed to this plan and simulation dataset.
   */
  function pushObservations(span: Span | null, datasetId: number) {
    const obs = adapter?.observations;
    if (!viewer || !obs || !$plan) {
      return;
    }
    try {
      const parentOf = (x: Span) => (x.parent_id != null ? ($spansMap?.[x.parent_id] ?? null) : null);
      const childrenOf = (x: Span) =>
        ($spanUtilityMaps.spanIdToChildIdsMap[x.span_id] ?? [])
          .map(id => $spansMap?.[id])
          .filter((c): c is Span => !!c);
      const next = span && datasetId >= 0 ? obs.of(span, { childrenOf, datasetId, parentOf, planId: $plan.id }) : [];
      // Selecting another exposure of the same survey keeps the scene's observation (no rebuild), only the focus moves.
      const key = (list: CosmolabeObservation[]) =>
        list.map(o => `${o.spec.name}|${o.spec.provenance?.id ?? ''}`).join(',');
      const same = key(next) === key(shownObservations);
      shownObservations = next;
      if (!same) {
        viewer.observations.replace(
          OWNER,
          shownObservations.map(o => o.spec),
        );
      }
      const focused = shownObservations.find(o => o.focus != null);
      if (focused) {
        const pick = {
          et: null,
          footprint: focused.focus ?? null,
          name: focused.spec.name,
          owner: OWNER,
          region: false,
        };
        viewer.observations.select(pick);
        observationPick = pick;
        return;
      }
      if (same && observationPick) {
        viewer.observations.select(null);
      }
    } catch (e) {
      // Context only: the scene keeps working without it, and says nothing it cannot show.
      shownObservations = [];
      viewer.observations.remove(OWNER);
      console.warn('[3D Mission View] mission evaluation could not be drawn:', e);
    }
    observationPick = null;
  }

  /** The picked footprint or target, with the mission's numbers for it. */
  function pickDetails(pick: HostObservationPick | null, list: CosmolabeObservation[]) {
    const o = pick && list.find(x => x.spec.name === pick.name);
    if (!pick || !o) {
      return null;
    }
    if (pick.region) {
      return o.region ? { ...o.region, timeMs: null } : null;
    }
    const f = pick.footprint !== null ? o.footprints[pick.footprint] : undefined;
    return f ? { note: '', rows: f.rows, timeMs: Date.parse(f.time), title: f.title } : null;
  }

  function clearPick() {
    observationPick = null;
    viewer?.observations.select(null);
  }

  /** Loaded mission-state datasets; a newer request supersedes an older one still loading. */
  let stateRequest = 0;
  let stateFor = '';
  let stateMessage = '';

  async function pushMissionState(ds: SimulationDataset | null, wantedId: number) {
    const ms = adapter?.missionState;
    const v = viewer;
    if (!ms || !v || !lib || !$plan) {
      return;
    }
    const key = ds && ds.status === 'success' ? `${ds.id}` : `none:${ds?.id ?? wantedId}:${ds?.status ?? ''}`;
    if (key === stateFor) {
      return;
    }
    stateFor = key;
    const request = ++stateRequest;
    // Whatever is shown belongs to the previous selection: it goes before anything is fetched, so a vehicle is
    // never drawn from one simulation while another is selected (nor kept when this one's fetch fails).
    ms.vehicles.forEach(id => v.missionState.removeSource(id));
    v.sensors.remove(OWNER);
    if (!ds || ds.status !== 'success' || !ds.simulation_start_time || !ds.simulation_end_time) {
      // No finished simulation: no vehicle is anywhere (an unsimulated flight is not animated).
      stateMessage = ds
        ? `Simulation ${ds.id} is ${ds.status}: no drone states.`
        : wantedId >= 0
          ? `Loading simulation ${wantedId}…`
          : 'No simulation: no drone states.';
      return;
    }
    stateMessage = `Loading drone states from simulation ${ds.id}…`;
    const startMs = Date.parse(ds.simulation_start_time);
    const span = { datasetId: ds.dataset_id, endMs: Date.parse(ds.simulation_end_time), planId: $plan.id, startMs };
    const host = new lib.HostDataAdapter(`plandev-simulation-${ds.id}`);
    const results = await Promise.allSettled(
      ms.vehicles.map(id => effects.getProfileSince(ds.dataset_id, ms.resource(id), '-00:00:01', user)),
    );
    if (request !== stateRequest || viewer !== v) {
      return; // superseded: a newer selection (or panel) owns the scene now
    }
    const problems: string[] = [];
    ms.vehicles.forEach((id, i) => {
      const r = results[i];
      if (r.status === 'rejected') {
        problems.push(`${id}: ${(r.reason as Error)?.message ?? r.reason}`);
        return;
      }
      const segments = (r.value?.profile_segments ?? []).map(seg => ({
        startMs: startMs + getIntervalInMs(seg.start_offset),
        value: seg.is_gap ? null : seg.dynamics,
      }));
      if (!segments.length) {
        return; // this simulation has no state for the vehicle: it stays absent
      }
      try {
        v.missionState.addSource(simulatedStateSource(id, stateSamples(segments, span.endMs, ms), ms, span, host));
      } catch (e) {
        problems.push(`${id}: ${(e as Error).message}`);
      }
    });
    stateMessage = problems.length
      ? `Not shown — drone states from simulation ${ds.id} could not be loaded (${problems.join('; ')}).`
      : '';
    pushSensors(ds, startMs, span.endMs, request, v);
  }

  /** Instrument activity from the same simulation (e.g. camera on/off): the scene draws a FOV while acquiring. */
  async function pushSensors(
    ds: SimulationDataset,
    startMs: number,
    endMs: number,
    request: number,
    v: CosmolabeViewer,
  ) {
    const s = adapter?.sensors;
    const vehicles = adapter?.missionState?.vehicles ?? [];
    if (!s || !vehicles.length) {
      return;
    }
    const results = await Promise.allSettled(
      vehicles.map(id => effects.getProfileSince(ds.dataset_id, s.resource(id), '-00:00:01', user)),
    );
    if (request !== stateRequest || viewer !== v) {
      return;
    }
    // A vehicle whose resource could not be read gets no state: the viewer says "unknown", never "acquiring".
    const specs = vehicles.flatMap((id, i) => {
      const r = results[i];
      const segments =
        r.status === 'fulfilled'
          ? (r.value?.profile_segments ?? []).map(seg => ({
              startMs: startMs + getIntervalInMs(seg.start_offset),
              value: seg.is_gap ? null : seg.dynamics,
            }))
          : [];
      const intervals = sensorIntervals(segments, endMs, s.state);
      return intervals.length ? [{ intervals, sensor: s.sensor(id) }] : [];
    });
    try {
      v.sensors.replace(OWNER, specs);
    } catch (e) {
      console.warn('[3D Mission View] sensor states could not be shown:', e);
    }
  }

  function safeRead(a: CosmolabeAdapter, args: unknown) {
    try {
      return a.targets?.read(args) ?? [];
    } catch {
      return [];
    }
  }

  /** PlanDev's view window onto Cosmolabe's timeline (no clock change). */
  function pushTimeWindow(range: { end: number; start: number }) {
    if (viewer && Number.isFinite(range.start) && range.end > range.start) {
      viewer.setTimeWindow({ end: new Date(range.end).toISOString(), start: new Date(range.start).toISOString() });
    }
  }

  async function copyPoint() {
    if (pickedPoint) {
      await navigator.clipboard?.writeText(formatLatLon(pickedPoint)).catch(() => {});
      destinationNote = `Copied “${formatLatLon(pickedPoint)}” (planetocentric lat, east lon, ${pickedPoint.frame}).`;
    }
  }

  /** Fill the goal's destination arguments with the picked point. Nothing is scheduled: the operator runs Schedule. */
  async function useAsDestination() {
    const d = adapter?.destination;
    if (!d || !destinationGoal?.goal_metadata || !pickedPoint || !$plan || pickedProblems.length) {
      return;
    }
    destinationBusy = true;
    try {
      await effects.updateSchedulingGoalPlanSpecification(
        $plan,
        { ...destinationGoal, arguments: withDestination(d, destinationGoal.arguments, pickedPoint) },
        destinationGoal.goal_metadata.versions[0]?.parameter_schema as never,
        [],
        user,
      );
      destinationNote = `${d.goal} ${d.arguments.latitude}/${d.arguments.longitude} set to ${formatLatLon(pickedPoint)}. Run Schedule to evaluate it.`;
    } finally {
      destinationBusy = false;
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

  /** Sampled closest passes of the vehicle's sub-point over the pinned location, from the scene's own geometry. */
  async function findPassesHere() {
    const c = viewer?.control;
    if (!c || !lib || !adapter || !location || !proposal) {
      return;
    }
    const range = { endMs: Date.parse(`${searchTo}Z`), startMs: Date.parse(`${searchFrom}Z`) };
    if (!(range.endMs > range.startMs)) {
      searchError = 'The search range is empty or not a valid time range.';
      return;
    }
    const [cl, a, at, frame] = [lib, adapter, locationKey, proposal.frame];
    let unavailable = '';
    searching = true;
    searchError = '';
    try {
      const result = await findPasses(
        ms => {
          const state = c.getObjectState?.(a.vehicle, {
            center: a.body,
            frame,
            time: { et: cl.etFromCalendarString(new Date(ms).toISOString()), kind: 'et' },
          });
          if (!state?.position) {
            const why = state?.positionAvailability;
            unavailable ||= why?.message ?? why?.reason ?? 'no position';
            return null;
          }
          return state.position;
        },
        location,
        a.targets!.meanRadiusKm,
        range,
      );
      search = { ...result, at, range, unavailable };
    } catch (e) {
      searchError = `Search failed: ${(e as Error).message ?? e}`;
    } finally {
      searching = false;
    }
  }

  function choosePass(ms: number) {
    chooseWindow({ kind: 'pass', ms });
    moveTime(ms);
  }

  function lookAtPin() {
    if (location) {
      viewer?.control.gotoCoordinates(location.body, location.latDeg, location.lonDeg, {
        animate: true,
        latitude: 'planetocentric',
        longitude: 'east',
      });
    }
  }

  async function stage() {
    if (!adapter || !goalSpec || !proposal || !$plan || !goalSpec.goal_metadata || problems.length) {
      return;
    }
    staging = true;
    try {
      const schema = goalSpec.goal_metadata.versions[0]?.parameter_schema;
      await effects.updateSchedulingGoalPlanSpecification(
        $plan,
        {
          ...goalSpec,
          arguments: adapter.targets!.stage(
            editing ? adapter.targets!.remove(goalSpec.arguments, editing.id) : goalSpec.arguments,
            proposal,
          ),
        },
        schema as never,
        [],
        user,
      );
      probe = null;
      editing = null;
      search = null;
      chooseWindow({ kind: 'cursor' });
      viewer?.control.clearProbePoint?.();
    } finally {
      staging = false;
    }
  }

  function edit(target: (typeof staged)[number]) {
    editing = target;
    search = null;
    chooseWindow(
      target.window
        ? {
            detail: 'its staged window',
            endMs: Date.parse(target.window.end),
            kind: 'staged',
            startMs: Date.parse(target.window.start),
          }
        : { kind: 'cursor' },
    );
  }

  async function unstage(id: string) {
    if (editing?.id === id) {
      editing = null;
    }
    if (adapter && goalSpec && $plan && goalSpec.goal_metadata) {
      await effects.updateSchedulingGoalPlanSpecification(
        $plan,
        { ...goalSpec, arguments: adapter.targets!.remove(goalSpec.arguments, id) },
        goalSpec.goal_metadata.versions[0]?.parameter_schema as never,
        [],
        user,
      );
    }
  }

  /** A staged target's standing in PlanDev; see `targetOutcome` for what that can and cannot say. */
  // Everything it reads is a parameter, so the template re-runs it when any of them changes.
  function outcome(
    target: (typeof staged)[number],
    directives: typeof $activityDirectivesMap,
    run: typeof request,
    revision: typeof specRevision,
    bounds: Interval,
    invocation: number | undefined,
  ) {
    const name = adapter?.targets?.directiveName(target.id);
    const observation =
      Object.values(directives ?? {}).find(
        d => d.name === name && d.source_scheduling_goal_invocation_id === invocation,
      ) ?? null;
    const invalid = target.window
      ? windowProblems({ endMs: Date.parse(target.window.end), startMs: Date.parse(target.window.start) }, bounds)
      : [];
    return {
      invalid,
      observation,
      ...targetOutcome(target.id, { hasObservation: observation !== null, request: run, specRevision: revision }),
    };
  }

  function fmt(ms: number) {
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : '—';
  }

  function isoInput(ms: number) {
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19) : '';
  }

  function latLon(l: { latDeg: number; lonDeg: number }) {
    return `${Math.abs(l.latDeg).toFixed(2)}°${l.latDeg >= 0 ? 'N' : 'S'} ${Math.abs(l.lonDeg).toFixed(2)}°${l.lonDeg >= 0 ? 'E' : 'W'}`;
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
    {#if ready}
      <span class="cosmolabe-toggles">
        <label
          title="Cosmolabe's own timeline (activities, events, profiles). Its window follows PlanDev's; the time cursor is shared."
        >
          <input type="checkbox" checked={showTimeline} on:change={e => (timelineChoice = e.currentTarget.checked)} />
          Timeline
        </label>
        {#if adapter?.sensors}
          <label title="Draw instrument fields of view even while the simulation says the instrument is not acquiring.">
            <input type="checkbox" bind:checked={showIdleFov} />
            Show FOV
          </label>
        {/if}
      </span>
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="body">
    <div class="cosmolabe-panel">
      <div class="cosmolabe-viewer" bind:this={container} />
      {#if status !== 'ready'}
        <div class="cosmolabe-overlay" class:error={status === 'error'}>{message}</div>
      {/if}
      {#if ready && (stateStale || stateMessage)}
        <div class="cosmolabe-state">{stateStale || stateMessage}</div>
      {/if}
      {#if ready && shownObservations.length}
        <div class="cosmolabe-observations" data-testid="cosmolabe-observations">
          {#if picked}
            <div class="step">
              <b>{picked.title}</b>
              {#if picked.timeMs !== null}
                <button class="link" on:click={() => picked?.timeMs != null && moveTime(picked.timeMs)}>
                  Move time cursor to this exposure
                </button>
              {/if}
              <button class="link" on:click={clearPick}>Close</button>
            </div>
            <table class="rows">
              {#each picked.rows as [label, value]}
                <tr><td class="muted">{label}</td><td>{value}</td></tr>
              {/each}
            </table>
            {#if picked.note}<div class="warn-note">{picked.note}</div>{/if}
          {:else}
            <div class="step">
              {#each adapter?.observations?.legend ?? [] as item}
                <span class="legend"><i style:background={item.color} />{item.text}</span>
              {/each}
              <span class="muted"
                >Mission evaluation (read-only). Click a footprint or the target in 3D for details.</span
              >
            </div>
            {#each shownObservations as o}
              {#if o.region}<div class="muted">{o.region.title}</div>{/if}
            {/each}
          {/if}
        </div>
      {/if}
      {#if ready && adapter?.destination}
        <div class="cosmolabe-proposal" data-testid="cosmolabe-destination">
          <div class="step">
            <b>{adapter.destination.label}</b>
            {#if destination}
              <span>{formatLatLon(destination)}</span>
              <span class="muted">in the {adapter.destination.goal} goal</span>
            {:else}
              <span class="muted"
                >{destinationGoal ? 'not set in the goal' : `no ${adapter.destination.goal} goal in this plan`}</span
              >
            {/if}
          </div>
          <div class="step">
            <b>Picked point</b>
            {#if pickedPoint}
              <span data-testid="cosmolabe-picked-point">{formatLatLon(pickedPoint)}</span>
              <span class="muted">planetocentric lat, east lon (°), {pickedPoint.frame}</span>
              <button class="link" on:click={copyPoint}>Copy</button>
              <button
                class="st-button secondary"
                disabled={destinationBusy || pickedProblems.length > 0}
                on:click={useAsDestination}
              >
                Use as {adapter.destination.label.toLowerCase()}
              </button>
            {:else}
              <span class="muted">Pick a point on {adapter.destination.body} with the point probe in the 3D view.</span>
            {/if}
          </div>
          {#each pickedProblems as p}<div class="warn">{p}</div>{/each}
          {#if destinationNote}<div class="muted">{destinationNote}</div>{/if}
          <div class="muted">{adapter.destination.conventions}. Nothing is scheduled until you run Schedule.</div>
        </div>
      {/if}
      {#if ready && adapter?.targets}
        <div class="cosmolabe-proposal">
          {#if vehicleState}<div class="warn">{vehicleState}</div>{/if}
          <div class="step">
            <b>Location</b>
            {#if location}
              <span>{editing ? `Editing ${editing.name}: ` : ''}{location.body} {latLon(location)}</span>
              <span class="muted">planetocentric</span>
              <button class="link" on:click={lookAtPin}>Show</button>
              {#if editing}<button class="link" on:click={() => (editing = null)}>Cancel edit</button>{/if}
            {:else}
              <span class="muted">Pin a point on {adapter.targets.body} with the point probe in the 3D view.</span>
            {/if}
          </div>

          {#if location}
            <div class="step cosmolabe-search">
              <b>Find a pass</b>
              <input
                class="st-input"
                type="datetime-local"
                step="1"
                bind:value={searchFrom}
                aria-label="Search from (UTC)"
              />
              –
              <input
                class="st-input"
                type="datetime-local"
                step="1"
                bind:value={searchTo}
                aria-label="Search to (UTC)"
              />
              <span class="muted">UTC</span>
              <button class="st-button secondary" disabled={searching} on:click={findPassesHere}>
                {searching ? 'Searching…' : `Find ${adapter.vehicle} passes`}
              </button>
            </div>
            {#if searchError}<div class="warn">{searchError}</div>{/if}
            {#if search}
              <div class="cosmolabe-passes">
                {#each search.passes as pass (pass.ms)}
                  <button
                    class="st-button secondary"
                    class:chosen={base.kind === 'pass' && base.ms === pass.ms}
                    on:click={() => choosePass(pass.ms)}
                  >
                    {fmt(pass.ms)} · ≈{pass.km.toFixed(0)} km
                  </button>
                {:else}
                  <span class="warn">
                    {search.missing === search.samples
                      ? `No ${adapter.vehicle} position in the 3D scene for this range (${search.unavailable}).`
                      : `No ${adapter.vehicle} pass found in this range.`}
                  </span>
                {/each}
              </div>
              <div class="muted">
                Exploratory: closest {adapter.vehicle} ground-track distance, sampled every {search.stepMs / 1000} s from
                the 3D scene's kernels. Not instrument coverage; PlanDev re-checks when scheduling.
                {#if search.missing && search.missing < search.samples}
                  <span class="warn">
                    No position for {Math.round((100 * search.missing) / search.samples)}% of the range ({search.unavailable}).
                  </span>
                {/if}
              </div>
            {/if}

            <div class="step">
              <b>Window</b>
              <span>{fmt(proposedWindow.startMs)} – {fmt(proposedWindow.endMs).slice(11)} UTC</span>
              <span class="muted">{proposedWindow.detail}</span>
              {#if base.kind !== 'event' || base.endMs - base.startMs < 60_000}
                ±<input
                  class="st-input w-12"
                  type="number"
                  min="1"
                  max="720"
                  bind:value={halfWindowMin}
                  aria-label="Half window (minutes)"
                />
                min
              {/if}
              {#if base.kind !== 'cursor'}
                <button class="link" on:click={() => chooseWindow({ kind: 'cursor' })}>Use cursor</button>
              {/if}
            </div>
            {#if base.kind === 'event'}
              <div class="muted">An Event Finder result is not specific to this location.</div>
            {/if}
            {#each problems as problem}<div class="warn">{problem}</div>{/each}
            <div class="step">
              {#if canFit}
                <button class="st-button secondary" on:click={fit}> Fit window to plan </button>
              {/if}
              <button class="st-button" disabled={problems.length > 0 || staging} on:click={stage}>
                {editing ? 'Update in PlanDev' : 'Propose to PlanDev'}
              </button>
              <span class="muted">Not yet validated: PlanDev evaluates it when scheduling runs.</span>
            </div>
          {/if}

          {#if staged.length}
            <div class="cosmolabe-staged">
              <div class="step">
                <b>In PlanDev</b>
                <button class="st-button secondary" on:click={() => effects.schedule(false, $plan, user)}>
                  Run scheduling
                </button>
                {#if request}
                  <span class="muted">latest run #{request.analysis_id}: {request.status}</span>
                {/if}
              </div>
              {#each staged as target (target.id)}
                {@const result = outcome(
                  target,
                  $activityDirectivesMap,
                  request,
                  specRevision,
                  planBounds,
                  goalSpec?.goal_invocation_id,
                )}
                <div class="target" data-state={result.state}>
                  <div class="step">
                    <span>{target.name}</span>
                    {#if target.window}
                      <span class="muted">{target.window.start.slice(0, 16)} – {target.window.end.slice(11, 16)}</span>
                    {/if}
                    <button class="link" on:click={() => edit(target)}>Edit</button>
                    <button
                      class="link"
                      title="Remove from PlanDev's scheduling goal"
                      on:click={() => unstage(target.id)}
                    >
                      Remove
                    </button>
                  </div>
                  {#each result.invalid as problem}
                    <div class="warn">{problem} PlanDev will reject it; remove it to continue.</div>
                  {/each}
                  <div class="state">
                    {result.text}
                    {#if result.observation}
                      <button class="link" on:click={() => selectActivity(result.observation?.id ?? null, null, false)}>
                        {result.state === 'planned' ? 'observation' : 'existing observation'} at {fmt(
                          result.observation.start_time_ms ?? NaN,
                        ).slice(11)} UTC
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <details class="muted">
            <summary>Details</summary>
            {#if location}
              <div>
                Location: planetocentric lat {location.latDeg.toFixed(4)}°, east lon {location.lonDeg.toFixed(4)}° in {proposal?.frame},
                from the probe's body-fixed point.
              </div>
            {/if}
            <div>Proposals are staged as targets of the plan's {adapter.targets.goal} scheduling goal.</div>
            <div>{adapter.targets.conventions}.</div>
            <div>Scene: {mission?.catalogUrl}</div>
          </details>
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
  .cosmolabe-state {
    background: var(--st-yellow-10, #fff8e1);
    border-top: 1px solid var(--st-gray-20, #ddd);
    font-size: 12px;
    padding: 4px 8px;
  }
  .cosmolabe-observations {
    border-top: 1px solid var(--st-gray-20, #ddd);
    font-size: 12px;
    max-height: 40%;
    overflow: auto;
    padding: 4px 8px;
  }
  .cosmolabe-observations .rows td {
    padding: 0 8px 0 0;
    vertical-align: top;
  }
  .cosmolabe-observations .warn-note {
    color: var(--st-warning-orange, #9a6700);
  }
  .legend {
    align-items: center;
    display: inline-flex;
    gap: 4px;
  }
  .legend i {
    border-radius: 2px;
    display: inline-block;
    height: 3px;
    width: 14px;
  }
  .cosmolabe-toggles {
    display: inline-flex;
    font-size: 12px;
    gap: 8px;
    margin-left: auto;
    white-space: nowrap;
  }
  .cosmolabe-toggles label {
    align-items: center;
    display: inline-flex;
    gap: 3px;
  }
  .cosmolabe-proposal {
    border-top: 1px solid var(--st-gray-20, #ddd);
    display: flex;
    flex-direction: column;
    font-size: 12px;
    gap: 4px;
    max-height: 45%;
    overflow: auto;
    padding: 6px 8px;
  }
  .step,
  .cosmolabe-passes {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .cosmolabe-search input[type='datetime-local'] {
    width: 13.5em;
  }
  .cosmolabe-passes .chosen {
    outline: 2px solid var(--st-primary-60, #2f6fde);
  }
  .cosmolabe-staged {
    border-top: 1px solid var(--st-gray-20, #ddd);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
  }
  .target .state {
    padding-left: 12px;
  }
  .target[data-state='planned'] .state {
    color: var(--st-success-green, #1a7f37);
  }
  .target[data-state='rejected'] .state,
  .target[data-state='run-failed'] .state {
    color: var(--st-error-red, #b00020);
  }
  .target[data-state='changed'] .state,
  .target[data-state='unknown'] .state {
    color: var(--st-warning-orange, #9a6700);
  }
  .muted {
    color: var(--st-gray-60, #666);
  }
  .warn {
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
