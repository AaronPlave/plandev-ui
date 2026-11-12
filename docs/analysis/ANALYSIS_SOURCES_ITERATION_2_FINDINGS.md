# Analysis + Sources: Second Iteration Findings

This iteration follows [the first Analysis + Sources iteration](./ANALYSIS_SOURCES_FINDINGS.md). It asked whether Plan → Analyze holds up as a real workflow, what source management is needed outside an Analysis, and whether data from several kinds of source stays understandable as an Analysis becomes more useful.

The second real format was deferred at the user's request, so the adapter abstraction has still only met TOL. Simulation storage and the other profile findings were deliberately left alone (see [What stayed separate](#what-stayed-separate)).

Branches: `claude/analysis-sources-next` in plandev-ui and plandev. The final correctness pass ([section 9](#9-final-correctness-pass)) was made on `claude/tol-sections-options` in plandev-ui, which is `claude/analysis-sources-next` plus the merged timeline sections and rendering-options work.

## Summary

| Area                              | Outcome                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Revision choice in Add Source     | Fixed: the latest _successful_ revision is the one offered                                         |
| Manual pass of the whole workflow | Done; nine problems fixed (below)                                                                  |
| Plan → Analyze                    | Holds up, anchors and live edits included; one workflow gap (repeat Analyze creates duplicates)    |
| More plan data in Analysis        | Not added; each candidate is better as its own source                                              |
| Data from several kinds of source | Small fixes: one source label per row, directive names, same-day revisions, "Show on the timeline" |
| Source lifecycle                  | Pressure was real: a minimal **Imported Sources** page (`/sources`)                                |
| Adapter catalog semantics         | Decided and implemented: `last_seen_at`; the UI offers only adapters a running worker has          |
| Second real format                | Deferred at the user's request                                                                     |

## 1. Closing out the first iteration

### Revision choice

The Imported Sources tab used to treat the highest revision id as the "newest" revision. When that revision was failed or still importing, the Add button was disabled, even though an older revision worked. Now `splitSourceRevisions` divides a source's revisions into three groups:

- **usable**: the latest successful revision, with its Add button;
- **pending**: newer attempts, shown under it by status ("Import failed · Oct 4, 19:22 UTC · Line 412: unexpected end of element", or "Importing…");
- **older**: everything before the usable revision, behind "Show N older revisions". Failed attempts among them are labelled by status, not "Imported …".

Revision order is unchanged, and failed attempts are kept.

### Manual pass

Every step of the brief's list was exercised on the local stack: Plan → Analyze; a plan's current activities plus its simulation; adding an imported source; resource and activity rows; renaming a source in an Analysis; provenance; moving to a newer revision; removing and re-adding; saving and reloading; and read-only. The basic flow worked. The pass found these problems, all fixed:

1. **Every group repeated its source.** A row reading one source labelled each group with it ("BakeBananaBread · Tour Plan A · Current", once per type). The row header now names a single source once, beside the title, so the group tree still lines up with the drawn groups. Groups are only labelled per source when a row mixes sources.
2. **Directives were drawn with their type, not their name.** A plan's directive points showed "BakeBananaBread" where the plan page shows "Bake 1". They now use the directive's name. Spans still show their type, as on the plan page.
3. **Suggested rows had redundant names.** Analyze and "Show all activities of …" named the row after its source ("Tour Plan A · Current"), which the header now shows anyway. They are now plain "Activities"; the header's source label follows renames, aliases and rebinding, and a stored row name would not.
4. **Two revisions of one source imported on the same day had the same label** ("demo-tour · Oct 4, 2026"). This mattered most in the comparison workflow. When short labels collide, the import time is added.
5. **"Newer … Use it" appeared on the older of two revisions** even when the Analysis already had the newer one bound for comparison. It is no longer offered in that case.
6. **A failed simulation could be added.** It is now disabled like a failed import.
7. **Single-day coverage read "Jan 1, 2030 – Jan 1, 2030".** It now reads "Jan 1, 2030".
8. **An empty Analysis showed 1970–1970** in its time header. It now shows the last day, matching the axis.
9. **The ingest worker crashed on a missing input file.** The whole worker exited, so every later import waited. The revision now fails with "The file is missing: …" and the worker carries on. This is a backend fix with an integration test.

The Analyses list's help text still said an Analysis "has no plan of its own"; it now points to Analyze in the plan menu.

## 2. Plan → Analyze as a workflow

The model stayed as it was: plan (live), simulation dataset (snapshot) and source revision (snapshot), with no shared backend entity.

**What held up:**

- **Anchors.** I anchored a directive (Pick 1, +4:30 from Grow 1's start), then moved Grow 1 while the Analysis was open. The table, the timeline point and the details all moved with it. Details show "Anchored to Grow 1 (1) start / Offset 04:30:00", and the start is labelled approximate.
- **Searching.** Text search, table → details → timeline, and selection highlighting all work for directives as they do for imported activities.
- **Large plans.** An Analysis with a 100,000-directive plan loaded in about 4 s on the dev server, and Postgres answers the directive read in milliseconds. Like the plan page's own directive subscription, the live subscription re-sends the whole plan on every change. That is fine at 100k; at 1M directives it would be about 10× the payload on every edit. The plan page has the same ceiling, so this is not Analysis-specific.
- **Removing and re-adding, saving and reloading.** All fine. Rows bound to a removed plan are removed with it.

**Gaps found, not fixed:**

- **Analyze always creates a new Analysis.** Clicking it twice for one plan gives two "Tour Plan A analysis" entries. This is the clearest new pressure: people will expect Analyze to open their existing analysis of that plan, or at least offer it. The smallest version is for Analyze to open the user's most recent Analysis that binds the plan, plus a "New analysis" item.
- **"The plan has changed since this analysis was saved"** shows after any plan edit, until something in the Analysis triggers a save. For a live source this says nothing the user can act on: there is no snapshot to go back to. I'd remove it unless plan snapshots are built.

### Other plan data

For each candidate, I asked: is it part of "the live plan", or another source that happens to be associated with the plan?

| Candidate                                   | Verdict                          | Why                                                                                                                                                                                        |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| External events linked to the plan          | Another source                   | Events belong to derivation groups that several plans share. They have their own types and keys, and the plan only links to them. An "External events" binding would be the natural shape. |
| A plan's external datasets (`plan_dataset`) | Another source                   | They are resources with their own time basis and upload history. They map naturally onto the existing resource capability as a binding of their own.                                       |
| Constraint violations                       | Belongs with a simulation        | Violations are computed from one simulation of the plan. If they are added, they should come with the simulation source, not the plan.                                                     |
| Directive validations, tags, presets        | Part of the plan, not needed yet | Nothing in the sessions reached for them.                                                                                                                                                  |

None of these were built. The Plans tab still adds only "Current activities" and each simulation, as separate choices.

## 3. The four workflows

- **A. Understand one product** (one imported product of about 670k activities). You find activities through the table, and the details show parameters, attributes and provenance. The friction came next: a table hit usually belongs to a type no row draws, so selecting it moved the time window and showed nothing. The details now offer **"Show <type> on the timeline"**, which adds a row of that type from that source and keeps you on the activity. It isn't offered when a row already draws the type.
- **B. Investigate a plan** (Analyze, giving current activities and the simulation). This is the strongest workflow. Labels now read "Activities · Tour Plan A · Current" and "Activities · Tour Plan A · Simulation 1", with directives named as on the plan page.
- **C. Plan plus a mission product.** This works. In "All activities" the product's activities dominate the table by count; the source filter is the way to see the plan's activities. The time range widens to cover every source, and the view keeps the plan's range.
- **D. Comparison** (two revisions of one source). This works, with the same-day labels and the "Newer" fix above.

## 4. Data from several sources

What already worked: the Sources browser's filter searches across every source ("power" finds resources in both imported products and in simulations). Resource labels name their source or its alias ("Power · Ops prediction (W)"). The same activity type from two sources stays as two groups when a row mixes them.

What was missing is fixed above: one source label per row (1), directive names (2), telling revisions apart (4), and getting from a table hit to the timeline (A).

Not built, and not missed: a dedicated comparison mode, automatic grouping by source, and "find the same resource in another source" (the browser filter covers it).

## 5. Source lifecycle

**Without a Sources page**, the brief's questions were answered as follows:

| Question                             | Before                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Find the source I imported yesterday | Only inside some Analysis, through Add Source                                            |
| See its revisions                    | Add Source, older revisions                                                              |
| Import a new revision                | Add Source → Import, from inside an Analysis                                             |
| Where is it used?                    | Nowhere. Analyses reference revisions inside their JSON definition, with no foreign key. |
| Rename                               | No UI (Hasura allows the owner)                                                          |
| Archive or delete                    | No UI. Deleting cascades storage and `plan_source`, and silently breaks analyses.        |
| Who owns it?                         | Not shown                                                                                |

Usage and deletion had no answer at all, and failed imports pile up with no way to clear them. So there was clear workflow pressure, and I built **the smallest Sources page** (`/sources`, "Imported Sources" in the main menu):

- each source with its latest successful revision and summary, its number of revisions, whether a newer import failed or is in progress, how many analyses use it, and its owner;
- expanded, every revision: label or status, contents, error, file and format, who requested it, and links to the analyses that use it;
- import (the same form as Add Source, now one component, in a dialog), "Import revision", rename, and delete for the source or one revision. Deleting names the analyses that will lose it.

Usage is computed in the browser from every analysis's `definition.sources` (`definition(path: "sources")`). This is fine for hundreds of analyses; past that it needs a server-side index of analysis → revision.

**Observations:**

- **Deleting a revision an Analysis uses** left "Imported source / Unavailable revision", with no way to tell which source it was. Fixed in section 9.
- **Ownership is too narrow for teams.** Sources registered with the CLI have no owner, so only admins can rename, delete or import into them, and nobody can import a new revision of someone else's source. A team will hit this at once. The UI now matches what Hasura allows (section 9); the model itself is unchanged.
- **Naming collision.** The app already has "External Sources" (external event sources). "Imported Sources" sits next to it in the menu, and the difference isn't obvious. This needs a product decision before shipping.
- **Archiving wasn't needed.** Deleting old revisions was enough here. Archiving earns its place only if deleting turns out to be too final for revisions an Analysis uses.

## 6. Second real format

This was deferred at the user's request, to be done once a real sample is available. The adapter design is still proven only against TOL and a test-only CSV adapter. The open questions from the brief (canonical shape, `adapter_config`, product metadata, `probe()`, resource-only products) remain open.

One candidate already exists in PlanDev: its external dataset format (JSON `profileSet` and CSV, with real samples). It is resources-only, uses day-of-year time with segment-duration offsets, and has linear and structured values. It would test the abstraction, but it is a PlanDev exchange format, not a mission product.

## 7. Revision identity

There was nothing new to test without a second format. TOL reports no product metadata, so every label falls back to the import time and, when available, the original file name. Revisions imported through the UI now keep `metadata.originalFileName` (shown on the Sources page). Revisions registered with the CLI show the stored path's name.

## 8. Adapter catalog

**Deployment model.** A deployment runs one `source-ingest` worker image. It isn't a standard service yet; locally it is started by hand.

**Semantics** (documented in plandev `docs/sources/ADAPTERS.md`):

- A `merlin.source_adapter` row means "an adapter some worker has had". Rows are never deleted, because old revisions name them.
- A new `last_seen_at` column is refreshed by running workers: at startup, before each claim (at least every 30 s while idle), and on every ingest heartbeat (every 5 s).
- The UI offers only adapters seen in the last two minutes. With none, it says "No ingest worker is running: an import waits until one starts". That was the exact confusion when the local worker had stopped.

**Not built.** Workers with different adapter sets would need adapter-aware claiming, i.e. `adapter = 'auto' or adapter = any(<installed>)`. One worker image doesn't need it.

Migration 41, which is unreleased and exists only on these branches, gained the column, rather than adding a new migration.

## 9. Final correctness pass

A focused pass over the lifecycle edges; no new architecture.

### Fixed

- **Import → add.** "Add it to this analysis" no longer binds a revision that is still importing. The analysis remembers the intent (`pendingAnalysisImports`) and follows the existing live Sources library subscription; when the revision succeeds it is bound (with a toast), when it fails the error is shown in the Import tab with **Try again** (re-uploads the same file as a new revision of the same source) and **Dismiss**. The intent survives closing the dialog, and is dropped, with its subscription, when the analysis closes or another opens. A revision added by hand meanwhile is not bound twice. A revision the library has not listed yet is not treated as deleted.
- **Source identity.** An imported binding now records `sourceId` and a `sourceName` snapshot. Analyses saved with only `revisionId` still load; on open the fields are filled in from the revision (and a rename is followed), and are saved with the analysis's next save. A deleted revision shows as "<Source> · Revision deleted" and offers a choice among the source's other successful revisions (newest preselected, already-bound ones disabled). Choosing one rebinds in place, keeping the binding id, the alias and every timeline row. Nothing switches on its own. When the whole source is deleted, the binding shows "<name> · Source deleted" using the snapshot name and says to remove it; rows bound to it show the same reason. The snapshot is read only when the source can no longer be read.
- **Usage and deletion impact.** Analyses are now de-duplicated by `analysis.id` (`getSourceUsage`), not by object reference. Deleting a source warns about analyses that bind any of its revisions, or name the source in a binding whose revision is already gone (they would lose their recovery path). Deleting one revision warns only about analyses binding that revision. The "used by" count, the revision links and the warning come from the same functions.
- **Imported Sources page.** Browsing has the full width. **Import Source** is a dialog opened from the page header, and **Import revision** opens the same dialog with its source preselected (one `SourceImportForm`). The revision table scrolls horizontally below 560 px and wraps long file names and errors. See [Not verified](#not-verified).
- **Permissions match Hasura.** `source_revision` insert is allowed for admins on any source, for anyone else only on a source they own. The Import revision button and the import form's "new revision of" list used `owner === me`, which blocked admins; both now use `CREATE_SOURCE_REVISION(user, source)`. Rename and delete already matched (admin, or owner; ownerless means admin only).
- **Waiting state.** A pending revision (no worker has claimed it) reads "Waiting for an ingest worker…"; one a worker has claimed reads "Importing…".

### Adapter availability (checked)

Read from the code and confirmed with the integration tests, run against the `tol` stack's database:

| Question                               | Result                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Idle workers refresh `last_seen_at`    | Yes: before every claim, and the idle wait is 30 s. `publishingMarksEveryInstalledAdapterSeenNow`                                                                  |
| Long imports keep refreshing           | Yes: every 5 s heartbeat. `aRunningIngestKeepsItsAdaptersSeen`                                                                                                     |
| Stopped workers drop out of the UI     | Yes: after 2 minutes (`getAvailableAdapters`, unit-tested). The catalog row stays                                                                                  |
| Missing input file                     | Revision fails with "The file is missing: …"; worker continues. `aMissingFileFailsTheRevisionNotTheWorker`                                                         |
| Next revision after a failure          | Claimed and read. `aFailedRevisionDoesNotKeepTheNextOneFromBeingClaimedAndRead`                                                                                    |
| Explicit adapter that is not installed | Revision fails with "No adapter … is installed (installed: …)"; not reclaimed; next revision unaffected. `anAdapterThatIsNotInstalledFailsTheRevisionNotTheWorker` |
| `auto` with no worker                  | The form says "No ingest worker is running: an import waits until one starts", and the revision reads "Waiting for an ingest worker…"                              |

The 2-minute window compares the browser's clock with the database's `last_seen_at`; a skew of more than about a minute would hide or wrongly offer formats. Fine locally; a deployment with unsynchronised clocks would need the comparison done in SQL. The worker's main loop also ends if its listen connection fails (a database outage); a supervisor restarts it.

### Remaining limitations

- **Ownership.** Still owner-or-admin. Ownerless (CLI-registered) sources can be renamed, deleted and imported into only by admins, and a user cannot import a revision of someone else's source. That is the correct UI for the current Hasura rules and the wrong model for shared mission products; it needs groups or roles, which this pass deliberately did not start.
- A revision deleted while an Analysis is open is noticed when the Analysis is next opened, not live.
- Backfilled `sourceId`s on old analyses reach the database with the next save, so an analysis opened only read-only keeps its old definition.
- "Imported Sources" vs "External Sources" naming is unchanged (section 5). Analyze creating duplicates and the stale "plan has changed" note are fixed in [section 10](#10-entering-and-returning-to-an-analysis).

### Not verified

The pass was not exercised in a browser. The `tol` stack's gateway runs with CAM authentication, which cannot be used locally, and a no-auth gateway needs that process's secrets, which I did not copy. So the Imported Sources layout at normal and narrower widths, the Add Source import progress, the replacement picker and the manual regression list (workflow steps 1–11) have **not** been walked through by hand. The behaviour behind them is covered by the automated tests below. Restarting the `tol` gateway with `AUTH_TYPE=none` would allow it.

### Checks run

- plandev-ui: `npm run check` (0 errors), `eslint` and `prettier --check` on the changed files, and `vitest` over `src/utilities`, `src/stores` and `src/components/analysis` (52 files, 1155 tests), all passing.
- plandev: `./gradlew :source-ingest:test` with `SOURCES_IT_DB_URL` pointing at the `tol` stack database: 30 tests, none skipped, all passing.

## 10. Entering and returning to an Analysis

A follow-up on `claude/tol-sections-options`, closing the two workflow gaps above and three correctness items. No new entities or backend tables.

**Analyze reopens.** Plan menu → **Analyze** now opens the user's existing analysis when there is a suitable one, and **New analysis** (same menu) always makes another. Selection (`findAnalysisToReopen`, one read of every analysis's `definition.sources`, the same data as the Sources page's "used by"):

- an analysis must bind _every_ source asked for: the plan, and the simulation shown on the plan page when it succeeded. Analyze never adds to or swaps what an analysis binds, so a plan's analysis without that simulation does not match, and a new analysis (plan + simulation) is made. Running a new simulation therefore leads to a new analysis on the next Analyze; "New analysis" is also the way to get a plan-only one;
- only the user's own analyses are candidates (an admin can edit anyone's, but opening someone else's analysis to work in is not a sensible default). Someone who _cannot_ create analyses gets another person's, read-only, rather than nothing;
- most recently updated wins; ties go to the newest id.

If the read fails, Analyze reports it and does nothing rather than creating a possible duplicate.

**Imported Sources → Analyze.** Each source has **Analyze** (its latest successful revision), and every _successful_ row in the revision table has one for that exact revision. Pending and failed revisions have none. It opens the user's latest analysis that binds that revision (same rule as above; the revision may be one of several sources in it), else creates a single-source analysis, "<source> analysis". It opens on the revision's coverage like any analysis does (from its sources) and has one "Activities" row of the revision's activities, unless it has more than 10,000 (`INITIAL_ACTIVITY_ROW_LIMIT`) or none; a bigger product starts with an empty timeline and its resources and activity types in the Sources browser. There is no "New analysis" button on the Sources page: a second analysis of the same revision is made from the Analyses list.

**Plan revision note removed.** A plan is live, so "The plan has changed since this analysis was saved" implied a snapshot that does not exist. `planRevision` is gone from bindings and from saves (old saved JSON still loads; the field is ignored and dropped on the next save).

**Corrections.**

- Importing a revision into an _existing_ source needed Source-creation permission, because `importSourceRevision` checked `CREATE_SOURCE_REVISION(user)` without the source. It now takes the source's owner and checks `CREATE_SOURCE_REVISION(user, source)`: revision insert and ownership (or admin). A new source and its first revision still need both inserts. The form, the page buttons, the action and Hasura's insert checks agree; the retry of a failed import carries the owner.
- `getAnalysisSourceRevisions` returned `[]` on a failed read, which the analysis read as "every revision was deleted" and showed the replacement picker. It now returns `null`. A confirmed deletion (successful read, revision missing) still offers recovery; an unreadable revision shows "Unavailable revision" and keeps what was loaded, and offers no recovery. A failed read is retried only by reopening the analysis (or the existing 5 s poll when a revision is importing).
- Removed the accidental `src/schemas/ui-view-schema-v4.json.rej`; its hunks were already in the schema.
- Backend: the heartbeat test is renamed `anIngestRefreshesItsAdaptersSeenThroughItsHeartbeat` and says what it proves: an ingest refreshes its adapters' `last_seen_at` (the heartbeat beats once as it starts); it does not wait out the 5 s interval. `publishingMarksEveryInstalledAdapterSeenNow` no longer rewrites every adapter's timestamp, only those the worker installs.

**Tests**: `findAnalysisToReopen` (ordering, ties, simulation match, read-only, no sources), `analyzePlan` and `analyzeRevision` (first use, reopen, fresh, simulation with and without a match, older revision, exact-revision reopen, pending/failed, large revision), import permissions, and deleted vs unavailable revisions.

## 11. Views, plan sources and the Sources grid

A further pass on `claude/tol-sections-options` (plandev-ui) and `claude/analysis-sources-next` (plandev). No new entities or tables.

**Activity identity.** `getRevisionActivities` cached finished `Span[]`s by revision and types, but a span carries the id of the timeline source that reads it (`imported:42` in a Plan, `source-1` in an Analysis). A revision read in both returned one consumer's spans to the other. It now caches the raw records, and each caller converts them for its own binding; type filters stay separate, a failed load is not kept, and an unsubscribed row still gets no update. Test: one revision read under three bindings loads once and gives three sets of ids.

**PEF JSON.** `probe()` required `"inputFiles"` in the first 4 KB, so an array of activity records without the header was refused, even when `pef_json` was named. It now takes an array that shows either an `inputFiles` key or an activity record (`__kind: "activity"` with `genealogy` and `StartTime`); other arrays, a lone `__kind`, or the same keys in an object are still refused, so `auto` is unaffected. The mapping is unchanged. An `EndTime` before its `StartTime` is still drawn zero-length, and now says so in the activity's provenance (`metadata.dataQuality`, beside the file's `endTime`). Tests: probe cases, `auto` and explicit selection with and without the header, and a worker ingest of both files against the database, with the activity queries (`source_activity`, type catalog, `analysis_activity`).

**Remove from Plan.** Each imported source under the Plan's Sources has a Remove button (the plan's owner or an admin, as Hasura allows). It deletes only the `plan_source` row, after a confirmation that names the rows of the open timeline that read it; the revision and its data stay, and the Sources browser follows through its subscription. Attaching twice is refused by the unique constraint and reported as "already in this plan". Layers keep their `imported:<id>` binding: ids are never reused, so adding the revision again is a new binding and they stay unavailable. They now say so ("Imported source imported:7 is no longer in this plan"), not "not available". Checked in SQL (attach, duplicate, detach leaves the revision) and in unit tests; not through a running Hasura.

**Load timeline from view.** _Load from view_ in the Analysis timeline's header (and the empty-timeline note) opens a picker of saved views (a plain DataGrid), then a review step. Only the chosen timeline's rows, sections, layers, axes, guides, margins and rendering options come across; the view's panels and tables do not, and the view is read, never changed (it is migrated in memory, not saved back, and an id that is not found is an error, not the default view). The Analysis keeps its sources, name, owner and permissions, and the change is saved by the autosave; read-only analyses do not offer it. Mapping, with nothing guessed:

- imported layers (`imported:<plan_source>`): the plan source is resolved to its revision and matched to an Analysis binding of **that revision**. Another revision of the same source is not substituted; the review says so;
- layers of the Plan itself (no source, or `plan`): activities read a plan (or a simulation), resources a simulation. A single plan, or else a single simulation, is preselected; with several the person chooses, and until they do the layers are left out;
- external events, external datasets and anything else: left out.

Layers left out are listed with the reason before anything changes; a row with only such layers is dropped, an axis only they used goes with them. Adding the missing source and loading again brings them in. Nothing is attached to the Analysis for the view.

Limits: an Analysis shows one timeline, so a view with several asks which one to load (loading all would leave rows that nothing draws, and "Show on the timeline" would treat them as shown). An unbound Plan activity layer draws directives _and_ simulated spans on the Plan page, and in an Analysis these are separate sources: it maps to one, and the other needs its own row. `bindViewToAnalysisSources` (Analyze) left layers on the Plan's explicit `plan` source unbound; default Plan views use it for resources, so those layers were unavailable in a new Analysis. It now treats `plan` like no source.

**Sources page.** The list is two standard DataGrids: one row per source (name, latest successful revision, status, revision count, analyses using it, owner, actions) and, under it, the revisions of the selected source (version, status, activities, resources, coverage, file, adapter, requested by, analyses using it as links, error, actions). Analyze (the source row analyzes its latest, a revision row that revision), Rename and Delete are the grid's standard row actions with their permission checks; Import Source stays in the header and Import revision beside the revisions, both the one shared import form. Long file names and errors wrap and show whole on hover. Rows are keyed by id, so the selected source stays selected through subscription updates, and is cleared if it is deleted. Not browser-checked (see Not verified); the grid markup is covered by a render test.

**Tests.** plandev-ui: unit tests for the above; `npm run check` 0 errors; eslint and prettier on the changed files; vitest over `src/routes`, `src/utilities`, `src/stores` and `src/components` (86 files, 1310 tests). plandev: `./gradlew :source-ingest:test` against the `tol` stack's database, 40 tests, none skipped. Not run: a browser walkthrough, Playwright, and a Hasura round trip of the new delete.

## What stayed separate

These were not touched: bounded simulation profile queries, simulation storage changes, span streaming, any `pg_chunks_v1` simulation migration, the `resource_profile` time basis, scheduler profile ordering, `ProfileSet` gap handling, and same-time `profile_segment` uniqueness. They are recorded in plandev `docs/sources/SIMULATION_PROFILE_STORAGE.md`. Nothing has been filed upstream; filing issues is the user's call.

No Plan/Analysis workspace abstraction was introduced. The shared pieces are a small timeline fix (row header source label, directive labels) and one shared import form.

## Pressure seen for the watch list

| Idea                                    | Pressure seen                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Open the existing Analysis from Analyze | **Strong**: repeat Analyze creates duplicates                                              |
| Global Source Library                   | **Real**: usage, deletion and failed imports had no home (built minimally)                 |
| Sharing beyond owner and read-only      | **Real for sources** (ownerless CLI sources, other people's sources); not yet for analyses |
| Source revision update notifications    | Weak: the "Newer … Use it" prompt on opening was enough                                    |
| Duplicate or fork an Analysis           | None seen                                                                                  |
| Several named views per Analysis        | None seen                                                                                  |
| Analysis templates                      | None seen                                                                                  |
| Plan snapshots                          | None; it would give "changed since saved" a meaning                                        |
| "Analyze this source"                   | Mild: the Sources page has no way into an Analysis of one source                           |
| Saved searches                          | None seen                                                                                  |
| Cross-source matching                   | None seen in these workflows                                                               |

## Proven, likely, unknown

**Proven**

- Plan → Analyze works as a real workflow: live edits, anchors, search, details, and plans up to 100k directives.
- Plans, simulations and imported products coexist as separate domain sources behind one capability layer, with no shared backend entity.
- The data stays understandable with small presentation fixes; no comparison mode was needed.
- Source lifecycle needs a home outside an Analysis, at least for usage, cleanup and deletion.
- The DB catalog can't tell installed adapters from available ones without a liveness signal; `last_seen_at` is enough for one worker image.

**Likely**

- Analyze should reuse the user's existing analysis of a plan.
- Bindings should record their source's identity so deletion degrades gracefully.
- Sources need team ownership before real use.
- External events and plan datasets will be wanted as their own binding kinds before constraint violations.

**Still unknown**

- Whether the adapter abstraction survives a real second format. Deferred.
- How usage tracking should scale past hundreds of analyses.
- What "Imported Sources" should be called next to "External Sources".
- Whether live directive subscriptions are acceptable for million-directive plans in Analysis. It is the same ceiling as the plan page.
