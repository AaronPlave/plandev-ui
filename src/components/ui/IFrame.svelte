<svelte:options immutable={true} />

<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { onDestroy } from 'svelte';
  import { activityDirectivesMap, selectActivity, selectedActivityDirectiveId } from '../../stores/activities';
  import { plan, planRevision, timeCursorMs, viewTimeRange } from '../../stores/plan';
  import { selectedSpanId, simulationDatasetId, simulationDatasetsPlan, spansMap } from '../../stores/simulation';
  import { view } from '../../stores/views';
  import type { ViewIFrame } from '../../types/view';
  import { contextMessage, originOf, parseEmbedRequest, type EmbedContext } from '../../utilities/embedBridge';

  export let iFrameId: number;

  /** Upper bound on context posts while the time cursor is being dragged. */
  const POST_INTERVAL_MS = 100;

  let frame: HTMLIFrameElement | undefined;
  let iFrame: ViewIFrame | undefined;
  let lastPostedAt = 0;
  let postTimer: ReturnType<typeof setTimeout> | null = null;

  $: iFrame = $view?.definition.plan.iFrames.find(iFrame => iFrame.id === iFrameId);
  $: origin = originOf(iFrame?.src);
  $: context = {
    planId: $plan?.id ?? null,
    // The live revision (a subscription), not the revision the page loaded with.
    planRevision: $planRevision >= 0 ? $planRevision : ($plan?.revision ?? null),
    selectedActivityDirectiveId: $selectedActivityDirectiveId,
    selectedSpanId: $selectedSpanId,
    simulationDatasetId: $simulationDatasetId >= 0 ? $simulationDatasetId : null,
    timeMs: $timeCursorMs,
  } satisfies EmbedContext;
  $: schedulePost(context);

  function post() {
    if (postTimer !== null) {
      clearTimeout(postTimer);
    }
    postTimer = null;
    lastPostedAt = Date.now();
    // targetOrigin pins delivery to the configured app: if the frame navigated elsewhere, nothing is sent.
    if (frame?.contentWindow && origin) {
      frame.contentWindow.postMessage(contextMessage(context), origin);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function schedulePost(_context: EmbedContext) {
    if (postTimer === null) {
      postTimer = setTimeout(post, Math.max(0, POST_INTERVAL_MS - (Date.now() - lastPostedAt)));
    }
  }

  /** Scrolls the timeline, keeping its zoom, so that `timeMs` is visible. */
  function reveal(timeMs: number | null | undefined) {
    if (timeMs == null || !Number.isFinite(timeMs)) {
      return;
    }
    const { end, start } = $viewTimeRange;
    if (timeMs < start || timeMs > end) {
      const half = (end - start) / 2;
      viewTimeRange.set({ end: timeMs + half, start: timeMs - half });
    }
  }

  function onMessage(event: MessageEvent) {
    // Only the frame this panel owns, at the origin it was configured with.
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) {
      return;
    }
    const request = parseEmbedRequest(event.data);
    if (request?.type === 'ready') {
      post();
    } else if (request?.type === 'setTime') {
      timeCursorMs.set(request.timeMs);
      reveal(request.timeMs);
    } else if (request?.type === 'select') {
      const span = request.spanId !== null ? $spansMap?.[request.spanId] : undefined;
      const directive = request.directiveId !== null ? $activityDirectivesMap?.[request.directiveId] : undefined;
      if (span) {
        selectActivity(null, span.span_id, false);
        reveal(span.startMs);
      } else if (directive) {
        selectActivity(directive.id, null, false);
        reveal(directive.start_time_ms);
      }
    } else if (request?.type === 'openPlan' && request.planId !== $plan?.id) {
      // Stay in the current view; the plan page enforces the user's own permissions on the target plan.
      goto(`${base}/plans/${request.planId}${$view ? `?viewId=${$view.id}` : ''}`);
    } else if (
      request?.type === 'showSimulation' &&
      $simulationDatasetsPlan.some(dataset => dataset.id === request.simulationDatasetId)
    ) {
      // Only a simulation of the open plan; the context change is posted back to the app.
      simulationDatasetId.set(request.simulationDatasetId);
    }
  }

  onDestroy(() => {
    if (postTimer !== null) {
      clearTimeout(postTimer);
    }
  });
</script>

<svelte:window on:message={onMessage} />

<iframe bind:this={frame} allow="fullscreen" src={iFrame?.src} title="iframe-{iFrame?.title}" on:load={post} />

<style>
  iframe {
    border: 0;
    height: 100%;
    width: 100%;
  }
</style>
