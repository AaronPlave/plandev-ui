import { writable, type Writable } from 'svelte/store';

/*
 * The Analysis's inspection cursor: one instant (ms since the Unix epoch) that stays where the user put it while they
 * look at what each source says then. It is not the hover cursor (which follows the mouse) and not a vertical guide
 * (which is saved with the timeline): it is transient page state and is not saved with the analysis.
 */
export const inspectTimeMs: Writable<number | null> = writable(null);

/** While on, a click or drag on the timeline places the inspection cursor instead of selecting or panning. */
export const inspectMode: Writable<boolean> = writable(false);

export function resetAnalysisInspection() {
  inspectTimeMs.set(null);
  inspectMode.set(false);
}
