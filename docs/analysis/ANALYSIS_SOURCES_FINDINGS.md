# Analysis + Sources: Product Iteration Findings

This phase follows the [Analysis Workspace V1 spike](./ANALYSIS_SPIKE_FINDINGS.md). It tests a product thesis:

> An Analysis is a lasting composition of mission data sources, used to explore activities and resources. Imported products, a plan's current data and simulation results can all take part while staying their own kinds of entity.

Comparing sources is useful, but it isn't what an Analysis is for. One source is a normal Analysis.

Branches: `claude/analysis-sources-ux` in plandev-ui and plandev. The gateway needed no changes.

## Summary

| Area                                               | Status                              | Where                                                                    |
| -------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Empty state, suggested first rows                  | Implemented                         | `AnalysisTimelinePanel`                                                  |
| Human source names, aliases, source details        | Implemented                         | `AnalysisSourcesPanel`, `getAnalysisSourceNames`                         |
| Add Source: existing sources, plans, import a file | Implemented                         | `AnalysisAddSourceDialog`, `effects.importSourceRevision`                |
| Source → revisions; "newer revision, use it"       | Implemented (explicit rebind only)  | `rebindAnalysisSource`, `getNewerRevision`                               |
| A plan's current activities as a live source       | Implemented                         | binding `{kind: 'plan'}`, `merlin.analysis_activity` (migration 42)      |
| "Analyze" from a plan                              | Implemented                         | `PlanMenu` → `createPlanAnalysis`                                        |
| Activity table scope: all / current time range     | Implemented                         | `AnalysisActivityTable`                                                  |
| Format adapter discovery (plugins)                 | Implemented, backend                | plandev `docs/sources/ADAPTERS.md`                                       |
| Simulation profile storage                         | Investigated only, no migration     | plandev `docs/sources/SIMULATION_PROFILE_STORAGE.md`                     |
| Follow-latest, plan snapshots, Source Library      | Not built (out of scope)            | Notes below                                                              |

## A. Analysis UX

The sessions below used the local stack: the imported mission tour (about 670k activities), two banana plans, their simulations, and a small TOL imported through the new flow.

- **One plan** ("Analyze" from Tour Plan B). This opens on the plan's current activities and its shown simulation, one row each, grouped by type. It reads as a plan viewer that can take on more data. This is the strongest argument that "Analyze this plan" is a natural way in, perhaps more natural than starting from an empty Analysis.
- **Plan + its simulation.** Rows from the live plan and from Simulation 1 line up, and the table interleaves them by start time with the source on each row. Directives have no duration in the table; spans do. This is a recognisable "what we planned vs what simulated" view without any comparison feature.
- **Plan + simulation + an imported product.** Three groups sit in the Sources browser (Imported Sources, Plans, Simulations) and the table filters by any of them. Nothing in the UI had to know that a comparison was happening.
- **Several sources where comparison is the point** (the tour plus Plan A and Plan B simulations). This works as before, now with human labels.

What changed, and why:

- **Empty state.** A new Analysis explains itself in a card over the timeline: add an imported source, add a plan, import a file. Once sources exist but there are no rows, it explains dragging, and offers one suggestion per plan or simulation: "Show all activities of …". It doesn't offer this for imported products, because a whole product is often far more than one row can draw (10k+), and that would be the arbitrary auto-populated timeline the brief warns against.
- **Empty browser groups are hidden.** An Analysis of one plan no longer shows "No imported sources added". That was the clearest "comparison tool missing its second source" signal in the V1 page.
- **Layout is unchanged** (Sources | Timeline / Activities | Activity / Timeline Editor). After use:
  - The table earns its permanent place. It is the only place a plan's directives and a product's activities can be searched together. The new "Current time range" scope makes it a "what's here" list. It stays off by default: in these sessions, "All activities" plus text search was the more common use.
  - The right column's two tabs fit. Activity details are what you want after a click, and the editor only after adding a row. The page already switches between them by intent, and nothing pulled toward showing both at once.
  - Panel proportions felt right at 1280 px wide, and a timeline-only layout wasn't missed.
- **Known rough edges, deferred.**
  - A grouped row that reads one source still repeats the source name on every group label. The header caption can't sit above a group tree.
  - An empty Analysis shows a 1970 time range until a source is added.

## B. Source identity

- **Labels for people.** An imported revision shows its source name and version. The version is the product's own generation date when the format records one (`metadata.product.generatedAt`), otherwise the import time, e.g. "Imported Oct 4, 2026, 17:31 UTC". A simulation reads "Tour Plan A · Simulation 1"; a plan "Tour Plan A · Current". Database revision ids and slot ids (`source-1`) no longer appear in labels; the slot id is listed last in the details, as "Rows refer to it as".
- **Aliases.** `binding.label` is the Analysis's own name for a source (e.g. "Actual Tour"). It is set with the ✎ button, and the source's own name stays visible beside it. Row captions, the table, tooltips and the inspector all read the label live from the binding, so renaming never leaves stale text in row names.
- **Source details** (the ⓘ button) answer "what exactly is this data?":
  - **Imported:** source, revision, product name if any, original file, coverage, resource and activity counts, import status and time, format and its version, content hash.
  - **Simulation:** its plan, its id, status and coverage.
  - **Plan:** bounds, current revision, and a sentence on what "live" means.
- **Same-day revisions.** These were indistinguishable by date alone, so the import-date fallback includes the time. Most products carry no generation time; the TOL format has none in its header. So until adapters report product metadata, labels show import times.

## C. Import vs Add Source

- **Add Source** has three tabs: Imported Sources, Plans, Import New Source. Importing creates an ordinary Source revision. Its new source is owned by the importer, and any Analysis can use it. "Add it to this analysis" (on by default) only adds a reference. The model stays Import → Source → Revision, with Analysis → references a revision.
- **Mechanics.** The file uploads through the existing gateway `/file` endpoint. The UI then inserts `source` and `source_revision` (`adapter: 'auto'` unless a format is chosen), and the ingest worker does the rest.
  - A bound revision that is still importing shows "The source is still being imported". The page re-reads its sources every 5 s until the import finishes (marked `ponytail:`).
  - The original file name is kept in `metadata.originalFileName`, because the gateway makes stored upload names unique.
- **Observations.**
  - Importing into an *existing* source is only offered for sources you own, which matches Hasura's insert check. A team-shared source would need ownership or ACL work, which is out of scope.
  - A local deployment doesn't run the ingest worker by default. I ran it with `gradlew :source-ingest:run --args=work`. Making the worker a standard service is a deployment task for whoever ships this.
  - Multi-GB uploads still go through the browser. The dialog says to use the CLI for very large products.

## D. Source and Revision as user concepts

- The Imported Sources tab lists **sources**, each with its newest revision first and "Show N older revisions". It no longer lists revisions as unrelated sources.
- **Newer revision.** When a bound revision's source has a newer successful revision, the Sources panel shows "Newer: <version> [Use it]". Using it rebinds the same slot (`source-3 → revision 41`). Every row and layer stays bound to `source-3` and now shows the new data, the selection is cleared if it came from that source, and the alias is kept. Rebinding never happens on its own: there is no follow-latest.
- **Does this need a Source Library page?** Not yet. Sources-with-revisions inside Add Source, plus the details panel, answered every question in these sessions. A library would earn its place for managing sources (renaming, deleting, ownership, comparing revisions), not for picking them.

## E. A plan's current data as a source

- **Binding:** `{kind: 'plan', planId, planRevision?}`. The plan is not an imported `merlin.source`; it stays a plan.
- **Live.** Rows, the Sources browser, the histogram and the inspector all read one GraphQL subscription per plan to `activity_directive_extended`. Edits to the plan show up as they happen; I checked this by moving a directive. The table re-reads when the plan's revision changes. The UI says "Live", and the details explain it.
- **Changed since saved.** Saving records each plan's current `revision` on its binding. When the live revision differs, the panel says "The plan has changed since this analysis was saved". There is no plan history, and a `plan_snapshot` source wasn't nearly free, so neither was built.
- **What a directive is.** Each directive keeps its id, type, name, arguments, metadata and anchor (anchor id, start or end, offset). It starts at the plan's own anchor-resolved `approximate_start_time`, so anchoring isn't reimplemented.
  - **No invented duration.** The shared activity shape gained `Span.endUnknown`. Such an activity is drawn as a point (the existing 2 px mark and label, as for directives).
  - The tooltip shows "Duration: None (no end)" with no end time. The inspector says "None: a directive has no end until it is simulated". The table's duration is blank. `merlin.analysis_activity` has `end_time = null` for directives, and the "Current time range" filter matches them by their start.
  - This is a small plan-specific adapter, `planDirectiveToSpan`, not the Plan page's directive renderer. Using the real directive path would have meant the drawing-id and selection refactor the V1 spike deferred. The cost is that anchor icons aren't drawn.
- **Nothing else comes along.** Adding a plan adds only its current activities. Its simulations are separate choices in the same tab, and its imported plan sources, external datasets and events aren't offered.
- **Table.** Rows read "Tour Plan A · Current" or "Tour Plan A · Simulation 1". In SQL, `source_kind = 'plan'` and `source_ref` is the plan id. `get_approximate_start_time` walks anchors per row; that's fine for plans of a few thousand directives (marked `ponytail:`).

## F. "Analyze" from a plan

The plan menu's **Analyze** creates "<plan> analysis" and opens it. It contains the plan's current activities, plus the simulation shown on the plan page if that one succeeded, with a row each. It is about 30 lines.

Recommendation: keep it. In these sessions it was the fastest way into a useful Analysis. That suggests Analysis is reached from the things it analyses as often as from the Analyses list.

## G. Format plugins (backend)

Implemented in plandev `source-ingest` and documented in `docs/sources/ADAPTERS.md`:

- **Descriptor.** `SourceAdapter.descriptor()` gives the id, display name, version, extensions, MIME types, capabilities and an optional config schema. Adapters still only parse.
- **Registry.** `AdapterRegistry` discovers adapters with `ServiceLoader`, and the TOL adapter registers the same way. A mission deploys a trusted adapter JAR on the worker's classpath. There is no hot reload and no JAR upload.
- **Selection.** A revision's `adapter` is an explicit id, or `auto`, which probes every adapter and needs exactly one match. The worker records the adapter and version it actually used.
- **Config and metadata.** `adapter_config` (jsonb) is stored on the revision and passed to the adapter, so an import can be reproduced. Adapters may report product metadata (generated time, product version, suggested name, mission facts). The importer, never the adapter, writes it to `metadata.product`.
- **Catalog.** The worker upserts installed descriptors into `merlin.source_adapter`; the Import tab lists them.
- **Tests.** A test-only CSV adapter proves discovery, and tests cover `auto`, ambiguous and unknown adapters, config pass-through and product metadata.
- **Future escape hatch (documented, not built).** For non-Java adapters, source-ingest would launch a trusted executable that streams a versioned, batched canonical resource/activity format into `SourceImporter`, with no always-on service.

The boundaries the brief asked for hold. Adapters emit canonical data, the importer owns physical storage (`pg_chunks_v1`), and an Analysis binds to domain sources (revision, simulation, plan), never to a storage provider.

## H. Simulation profile storage

This was investigated only; nothing was migrated. Details, numbers and the benchmark tool are in plandev `docs/sources/SIMULATION_PROFILE_STORAGE.md` and `deployment/benchmarks/simulation_profiles/`.

**Recommendation.** Keep `profile_segment` as the store of record. Make large simulations interactive with bounded window queries that include the segment just before the window, plus reduction to a display resolution on the server (path A). Add a rebuildable summary of a completed simulation only when a real model's simulations go past the limits below (path B). Don't build pluggable dense storage (path C) without evidence.

- **Not lossless as it stands.** The chunk format can't hold every simulation profile exactly:
  - linear `{initial, rate}` segments, including jumps at a boundary;
  - 64-bit integers;
  - structured discrete values;
  - times relative to the dataset's start.

  Chunks can hold same-time values; `profile_segment` can't.
- **The lifecycles don't match.** A dataset is created before its simulation runs and is written while it runs. `pg_chunks_v1` is written once and published at the end. Constraints, the scheduler, the gateway, Hasura views and actions, and the UI read `profile_segment` directly.
- **Cost is set by the window, not the dataset.** On the local stack:
  - A 1-day window costs about 2–8 ms whether the dataset is 300 MB (2M segments) or 41 GB (a 4.35-year product loaded as 276M segments).
  - A whole profile costs much more: 1.8–2.1 s and 118–149 MB of JSON at the large end.
- **Limits, inferred from per-segment costs:**
  - raw bounded windows are fine up to about 50k segments per request;
  - reducing on the fly is fine for profiles up to about 200k segments;
  - above that, a stored summary is needed for whole-extent views.
- **Storage:** about 155 bytes per segment, against about 20 bytes per sample in chunks.
- **What failed first.** The million-activity simulation ran out of memory building its *spans*, after all its profiles had been streamed. Spans, not profiles, were the bottleneck.

An Analysis doesn't need either migration. Its resource provider already hides the difference between the stores: an imported revision goes through `pg_chunks_v1`, a simulation dataset through `profile_segment`. If the chunk design is ever reused for simulations, the physical storage piece should be extracted. Simulation datasets should not become fake imported sources.

## What should happen next

1. **Use it.** Run real sessions with mission planners on "Analyze" from a plan, and on a one-product analysis.
2. **Have adapters report product dates.** Product metadata is the only thing between import times and meaningful revision names. A TOL variant with a header, or a sidecar, would show the value quickly.
3. **Directive rendering.** If plan sources stick, give the timeline source-scoped selection (V1 recommendation 2), so plan directives can use the real directive renderer, anchors included.
4. **Ship the ingest worker as a service** in the deployment, so Import works without a manual step.
5. **Decide whether "Analyze" belongs on the plan page permanently**, and whether an analysis created from a plan should show up on that plan.
