# Analysis + Sources: Second Iteration Findings

This iteration follows [the first Analysis + Sources iteration](./ANALYSIS_SOURCES_FINDINGS.md). It asked whether Plan → Analyze holds up as a real workflow, what source management is needed outside an Analysis, and whether data from several kinds of source stays understandable as an Analysis becomes more useful.

The second real format was deferred at the user's request, so the adapter abstraction has still only met TOL. Simulation storage and the other profile findings were deliberately left alone (see [What stayed separate](#what-stayed-separate)).

Branches: `claude/analysis-sources-next` in plandev-ui and plandev.

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
- import (the same form as Add Source, now one component), "Import revision" into a source you own, rename, and delete for the source or one revision. Deleting names the analyses that will lose it.

Usage is computed in the browser from every analysis's `definition.sources` (`definition(path: "sources")`). This is fine for hundreds of analyses; past that it needs a server-side index of analysis → revision.

**Observations:**

- **Deleting a revision an Analysis uses** leaves "Imported source / Unavailable revision", and the Analysis no longer knows which source it was. A binding only stores `revisionId`. Storing the source's id and name on the binding would let it say "Demo tour (revision deleted)" and offer that source's latest revision.
- **Ownership is too narrow for teams.** Sources registered with the CLI have no owner, so only admins can rename, delete or import into them, and nobody can import a new revision of someone else's source. A team will hit this at once.
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
