# Analysis Workspace V1 Spike: Findings

The spike adds a standalone Analysis page (`/analyses/:id`). It has no Plan. It composes sources (imported source revisions and simulation datasets from any plan) on the existing timeline, with an activity table, a read-only inspector and autosaved state. This document records what we learned building it and using it with a realistic demo.

**Demo.** "Tour Comparison" uses three sources:

- an imported mission tour TOL: about 670k activities across 414 types, plus 3.7k resources, spanning ten years;
- Plan A's simulation;
- Plan B's simulation (Banananation).

Its rows hold imported battery resources, imported DSN passes, downlinks and science images, and simulated resources and activities from both plans. Some rows mix sources.

## Architecture in one page

- **Analysis record.** `ui.analysis(id, name, owner, definition jsonb, …)`. The definition holds:

  - `sources`: slot bindings `source-N`, each pointing to an imported revision or a simulation dataset;
  - `view`: the existing `ViewDefinition`.

  Layers store only the slot id (`sourceId`). So rebinding slot `source-1` to a new revision needs no view edits, and sources are referenced, never copied.

- **Sources reach the timeline through a Svelte context** (`setTimelineSourcesContext`). It replaces direct reads of the Plan page's `timelineSources` store. The Analysis page provides its own registry, built from its bindings. Row, RowHeader, the tooltip, the editors and the Sources browser read whichever registry they are mounted under.
- **Activities are a source capability.** The existing `intervals` capability gained `subscribe(request, context)`.
  - Rows subscribe per activity layer, the same way they already did for resources.
  - Imported revisions and simulations both load in full, once per session, and the result is shared across rows.
  - Activities become the timeline's `Span` shape with `sourceId`, `sourceActivityId` and `name`.
  - The drawing id is `(sourceIndex + 1) · 2³² + activityId`. Renderer identity is therefore unique across sources, and the discrete renderer needed no re-keying.
- **Imported activities.**
  - **Ingest:** the TOL adapter reads `ACT_START`/`ACT_END` pairs, with parameters (typed values flattened to JSON), attributes and provenance. They are stored per revision in a list-partitioned `merlin.source_activity`.
  - **Type catalog:** publish writes `merlin.source_activity_type`, which holds each type's count, category, time span and the parameters seen on it.
  - **End time:** in this product `ACT_END` is usually just when the record was emitted. The end is therefore `start + span` when a `span` attribute exists, otherwise `ACT_END`, otherwise the start. The `ACT_END` time is kept in the metadata.
- **Activity table.** `merlin.analysis_activity` is a `UNION ALL` view over imported activities and simulated spans. AG Grid's infinite row model pages it on the server, with count by aggregate. Text, source and type filters and the sort are applied server-side. Scroll-to-selected counts the rows that sort before the selected one.

## What reused cleanly

| Piece                                                                                                         | Notes                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Timeline`, `Row` drawing, `LayerLine`, `LayerDiscrete`, x-axis, histogram                                    | Mounted on a page with no Plan. The Plan-only inputs (directives, constraints, simulation) are passed empty. |
| Imported-resource layers (viewport-driven queries, LOD, status)                                               | Work against a revision directly once queries take a `{revisionId}` target instead of only `{planSourceId}`. |
| Simulation resource profiles                                                                                  | `createProfileSubscription` on any dataset id.                                                               |
| View schema, `view` store, `viewTimeRange`, row/layer/axis editing (`viewUpdateRow`, `viewAddFilterToRow`, …) | The analysis keeps its `ViewDefinition` in the same store, so the timeline editor works unchanged.           |
| `TimelineEditorPanel`, `TimelineLayerEditor`, `ActivityFilterBuilder`                                         | With the small changes below.                                                                                |
| Sources browser tree, layer picker, drag to timeline                                                          | With the small changes below.                                                                                |
| Tooltip                                                                                                       | Gained source-aware rows.                                                                                    |
| `DataGrid`/AG Grid patterns, `Panel`, `Resizable`, `Nav`, effects/gql/permissions conventions                 | No changes.                                                                                                  |

## What needed small changes

- **Timeline sources registry via context.** Before this, Row, RowHeader, the tooltip, the editors and the browser imported the Plan page's derived store directly. The change is one context getter in each, with the Plan page providing the same store as before.
- **`intervals.subscribe` / `revisionKey`.** This is the activity counterpart of the resource subscription. Row now keeps per-layer activity subscriptions alongside resource ones. It also runs a source-span filter pass and builds per-row span maps, and the Plan's own activity path is untouched.
- **Source-scoped identity.**
  - `Span` gained optional `sourceId`, `sourceActivityId` and `name`.
  - The tooltip shows "Source", "Name" and "Id (in source)".
  - Grouped discrete trees label groups `type · source` when a row mixes sources.
- **Imported-resource queries target a revision or a plan source** (`SourceTarget`).
- **Filter builder takes a `catalog`.** Non-Plan sources supply their own types. The Plan instance count is hidden for them, since their activities are not loaded there. Imported types carry the parameters seen at ingest, and simulations use their plan's model declarations, so parameter filters work for both.
- **Sources browser takes `groups`, `emptyGroupMessages` and `showUpload`.** The analysis shows only its own groups, with no upload.
- **Layer picker takes the item's `sourceId`.** It only offers existing layers that read the same source, so a type is never added to another source's layer.
- **Row header shows the activity sources live**, from the registry, instead of baking a source label into row names. Baked labels went stale on rebind or removal.
- **`TimelineViewControls.planControls`.** Off the Plan page it hides the controls that read the Plan's directives, spans or URL: copy link, drag lock, auto scroll and the "Current View" URL.
- **`TimelineEditorPanel.timeBounds`.** Guide dates are bounded by the analysis's range, not the Plan's.
- **Histogram counts by `startMs`/`durationMs`**, which every span already carries, instead of re-parsing offsets from the plan or simulation start. The analysis feeds it the times of every bound activity.
- **`LayerDiscrete` packing appends in place.** It used to copy a row's items on every insert. That made packing quadratic and froze the page with thousands of visible activities. This is a Plan-page fix too.

## What remains strongly Plan-coupled

- **Selection.**
  - The timeline's selection is a numeric `span_id`/directive id. The analysis maps its `(sourceId, activityId)` reference to the drawing id, and back from the clicked span.
  - It works, but the timeline has no notion of a source-scoped selection. "Follow selection" and "select in table" exist only because the analysis page wires them itself.
- **Plan stores read globally.** `stores/plan` (`viewTimeRange`, `maxTimeRange`, `planReadOnly`), `stores/simulation` and `stores/activities` are imported directly by timeline components. They work on the analysis only because they sit empty. Examples:
  - The filter builder reads `$planModelActivityTypes` unless given a catalog.
  - `TimelineViewControls` reads the Plan's selected directive and span.
- **Grid layout.** The Plan page's `GridMenu`/`viewTogglePanel` panel switching is built around the Plan's panel set. The analysis uses its own fixed layout (Sources | Timeline / Table | Activity, Timeline Editor) rather than adapting it.
- **View persistence.**
  - Plan views live in `ui.view` with their own save/fork UX.
  - The analysis embeds its view in `ui.analysis.definition` and autosaves the whole definition.
  - The view _schema_ is shared; the persistence is not.
- **Legacy (unbound) layers.** Resource and activity lookups still have a legacy path that reads the Plan's simulation. Analysis layers are always bound, so they never take it.

## What was intentionally duplicated

- **The Analysis page's layout and panels** (`routes/analyses/[id]`, `components/analysis/*`). Generalising the Plan page's grid would be the broad surgery the spike avoids, and we do not yet know which panels an analysis needs.
- **Activity table.** It is new and server-paged, separate from the Plan's directive/span tables. Those are client-side over loaded directives and spans, and a 670k-row source doesn't fit that model.
- **Read-only inspector** (`AnalysisActivityDetails`). The Plan's directive/span forms are editors tied to directives, models and simulation. The inspector fetches an imported activity, or a span, by its source reference.
- **Simulation spans for an arbitrary dataset** (`getSimulationDatasetSpans`). This repeats the Plan page's span load, but keyed by dataset rather than "the plan's current simulation".

## Performance (local, one machine)

- **Ingest** of a 4.4 GB tour TOL with activities: about 4.5 min. Activity storage is about 400 MB of the revision.
- **Full activity load**, all 670k activities with parameters: about 188 MB of JSON and 6.5 s. A single type is much smaller; rows load per type set.
- **Histogram feed** of all 670k activity times: 60 MB of JSON and 3.9 s, once per revision per session.
- **Table:** first page in under 100 ms. An ILIKE text filter count is about 0.6 s. Scroll-to-selected deep in the table is one count query.
- **Revision delete:** about 0.4 s, by dropping partitions.
- **Drawing** is the ceiling now, not loading. Before the packing fix, a row with about 8k visible activities took seconds per redraw. The discrete renderer still stops drawing a row above 10,000 visible items and says so; zooming in draws them. Nothing is sampled or silently left out.

## UX observations

- **What feels central.** Seeing an imported tour and simulations on one time axis is the core value. Every other feature serves that.
- **Sources panel.**
  - Adding sources is clear.
  - Browsing each source's resources and activities, and dragging them to rows, works.
  - Showing the slot (`source-1`) is useful for understanding rebinding, but means little to anyone else.
  - Labels need work: "Tour Plan B · Sim 2" is fine, but imported revisions read as "<source name> r26".
- **Activity table.** It is useful as a finder: text filter, then click to pan the timeline there. It's less useful as a browser: with 670k rows, the source and type filters do the work. A "show only what's in view" option would help.
- **Multiple activity sources.** These are understandable when a row is per source. Mixed rows rely on the `type · source` group labels and on the colour per layer. Without grouping, they are hard to read.
- **Source grouping.** The live source caption on the row header helps. The timeline would benefit from row groups per source, or a source colour chip.
- **Inspection.** It is discoverable once you click, because the right pane switches to Activity. Hover tooltips already show most of it.
- **Missing interactions:**
  - multi-select;
  - comparing the same type across two sources (e.g. Plan A vs Plan B passes) in one gesture;
  - a "show this type from every source" row;
  - jumping from an activity to its source's resource rows;
  - a way to rebind a slot from the UI;
  - telling apart two simulations from the same plan.
- **Autosave.**
  - It is quiet and works for one user. It only runs for someone who can update the analysis; for anyone else the page is read only, with no row, layer or guide edits and no Timeline Editor.
  - The time window is not saved. Saving it on every pan made the header flicker and set off conflicts between people only looking, and saving it only with other edits would restore an arbitrary window. An analysis opens on its sources' range (the simulations', else everything loaded).
  - Two clients on the same analysis conflict. The second save is refused, with "Changed elsewhere, not saving" and Reload. Without that refusal it silently overwrote the other client's rows.

## Recommended next refactors

These are ordered by value per cost. None are implemented beyond what is noted above.

1. **A timeline context object.** It would carry the source registry plus the few page-level inputs timeline components now read from Plan stores: view time range, max time range, read-only, and selection. The registry context is already the first piece. This removes the "works because the Plan stores are empty" coupling.
2. **Source-scoped selection in the timeline.** Make selection an `{sourceId, id}` reference end to end, so the drawing-id encoding stays an internal renderer detail. Plan directives and spans become the `plan` source's ids.
3. **One activity provider shape for Plan and non-Plan sources.** The Plan's directives and spans would be just another `intervals.subscribe`. Row would then have a single activity path instead of two.
4. **A shared server-paged activity table component.** The analysis table is the starting point; the Plan's span table could adopt it when simulations grow.
5. **Exact viewport queries, and a dense representation that still counts everything.** Out of scope here; the whole-revision load is fine for the workflows tried so far. The invariant: an activity that matches a row's filter and intersects the shown range is part of the result, never sampled or cut to the first N. So a viewport query means the types plus _all_ activities intersecting the viewport and some overscan, which at a ten-year zoom is still hundreds of thousands. Where the renderer can't draw that density, it says so (as the 10,000-item cap does today) or draws a representation that accounts for every activity. The histogram's all-activity-times transfer is the first candidate: it exists only to produce aggregate counts.
