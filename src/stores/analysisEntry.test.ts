import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDefinition, AnalysisSourceUsage } from '../types/analysis';
import type { User } from '../types/app';
import { INITIAL_ACTIVITY_ROW_LIMIT } from '../utilities/analysis';

const effects = vi.hoisted(() => ({
  createAnalysis: vi.fn(),
  getAnalysisSourceUsage: vi.fn(),
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../utilities/effects', () => ({ default: effects }));
vi.mock('./subscribable', () => {
  const store = <T>(value: T) => ({ subscribe: (run: (value: T) => void) => (run(value), () => {}) });
  return { gqlSubscribable: () => ({ ...store([]), error: store(''), loading: store(false) }) };
});

const { analyzePlan, analyzeRevision } = await import('./analysis');

const me = {
  activeRole: 'user',
  id: 'me',
  permissibleQueries: { insert_analysis_one: true },
  token: 't',
} as unknown as User;
const cannotCreate = { ...me, permissibleQueries: {} } as unknown as User;

const plan = { id: 3, name: 'Tour Plan A' };
const analysis = (
  id: number,
  owner: string,
  updated: string,
  sources: AnalysisSourceUsage['sources'],
): AnalysisSourceUsage => ({ id, name: `analysis ${id}`, owner, sources, updated_at: `2026-10-0${updated}T00:00:00Z` });
const planSource = { id: 'source-1', kind: 'plan', planId: 3 } as const;
const simulation = (simulationDatasetId: number) =>
  ({ id: 'source-2', kind: 'simulation', simulationDatasetId }) as const;
const revisionSource = (revisionId: number) => ({ id: 'source-1', kind: 'imported', revisionId, sourceId: 8 }) as const;

/** The definition the next created analysis was given. */
function created(): { definition: AnalysisDefinition; name: string } {
  const [name, definition] = effects.createAnalysis.mock.calls.at(-1)!;
  return { definition, name };
}

describe('Analyze from a plan', () => {
  beforeEach(() => {
    effects.createAnalysis.mockResolvedValue(100);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('first use creates an analysis of the live plan, with a row of its activities', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([]);
    expect(await analyzePlan(plan, null, me)).toBe(100);
    const { definition, name } = created();
    expect(name).toBe('Tour Plan A analysis');
    expect(definition.sources).toEqual([{ id: 'source-1', kind: 'plan', planId: 3 }]); // live: no revision kept
    expect(definition.view.plan.timelines[0].rows.map(row => row.layers.map(layer => layer.sourceId))).toEqual([
      ['source-1'],
    ]);
  });

  it('again reopens your most recently updated analysis of the plan instead of creating one', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([
      analysis(1, 'me', '1', [planSource]),
      analysis(2, 'me', '3', [planSource]),
      analysis(3, 'me', '2', [planSource]),
      analysis(4, 'me', '9', [{ id: 'source-1', kind: 'plan', planId: 99 }]), // another plan
    ]);
    expect(await analyzePlan(plan, null, me)).toBe(2);
    expect(effects.createAnalysis).not.toHaveBeenCalled();
  });

  it('"New analysis" always creates another, without even looking', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([analysis(1, 'me', '1', [planSource])]);
    expect(await analyzePlan(plan, null, me, { fresh: true })).toBe(100);
    expect(effects.getAnalysisSourceUsage).not.toHaveBeenCalled();
    expect(effects.createAnalysis).toHaveBeenCalledTimes(1);
  });

  it('a particular simulation reopens an analysis that has the plan and that simulation', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([
      analysis(1, 'me', '5', [planSource]), // newer, but without the simulation
      analysis(2, 'me', '1', [planSource, simulation(6)]),
      analysis(3, 'me', '4', [planSource, simulation(7)]),
    ]);
    expect(await analyzePlan(plan, 6, me)).toBe(2);
    expect(await analyzePlan(plan, 7, me)).toBe(3);
    expect(effects.createAnalysis).not.toHaveBeenCalled();
  });

  it('a simulation with no matching analysis gets a new one with both sources, and nothing is added silently', async () => {
    const existing = analysis(1, 'me', '5', [planSource]);
    effects.getAnalysisSourceUsage.mockResolvedValue([existing]);
    expect(await analyzePlan(plan, 8, me)).toBe(100);
    expect(created().definition.sources).toEqual([planSource, simulation(8)]);
    expect(existing.sources).toEqual([planSource]); // the existing analysis is untouched
  });

  it("is not satisfied by someone else's analysis, which would open read-only", async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([analysis(1, 'you', '5', [planSource])]);
    expect(await analyzePlan(plan, null, me)).toBe(100);
    expect(effects.createAnalysis).toHaveBeenCalledTimes(1);
  });

  it("opens someone else's analysis read-only for a user who can't create one", async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([
      analysis(1, 'you', '5', [planSource]),
      analysis(2, 'you', '6', [planSource]),
    ]);
    expect(await analyzePlan(plan, null, cannotCreate)).toBe(2);
    expect(effects.createAnalysis).not.toHaveBeenCalled();
  });

  it('does nothing, and creates nothing, when it cannot read the existing analyses', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue(null);
    expect(await analyzePlan(plan, null, me)).toBeNull();
    expect(effects.createAnalysis).not.toHaveBeenCalled();
  });
});

describe('Analyze an imported source revision', () => {
  const source = { id: 8, name: 'Demo Tour' };
  const revision = (id: number, activityCount = 40, status = 'success') => ({ activityCount, id, status });
  beforeEach(() => {
    effects.createAnalysis.mockResolvedValue(100);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('makes a single-source analysis with a row of its activities, bound to the revision and its source', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([]);
    expect(await analyzeRevision(source, revision(21), me)).toBe(100);
    const { definition, name } = created();
    expect(name).toBe('Demo Tour analysis');
    expect(definition.sources).toEqual([
      { id: 'source-1', kind: 'imported', revisionId: 21, sourceId: 8, sourceName: 'Demo Tour' },
    ]);
    const rows = definition.view.plan.timelines[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].layers).toMatchObject([{ chartType: 'activity', sourceId: 'source-1' }]);
    expect(rows[0].layers[0]).toMatchObject({
      filter: { activity: expect.not.objectContaining({ static_types: [] }) },
    });
  });

  it('an older successful revision is analyzed explicitly, and is not confused with the latest', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([analysis(1, 'me', '5', [revisionSource(22)])]);
    expect(await analyzeRevision(source, revision(21), me)).toBe(100);
    expect(created().definition.sources).toMatchObject([{ revisionId: 21 }]);
  });

  it('returns to the analysis that already binds exactly that revision', async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([
      analysis(1, 'me', '2', [revisionSource(21)]),
      analysis(2, 'me', '4', [revisionSource(22)]),
      analysis(3, 'me', '3', [planSource, { ...revisionSource(21), id: 'source-2' }]),
    ]);
    expect(await analyzeRevision(source, revision(21), me)).toBe(3);
    expect(await analyzeRevision(source, revision(22), me)).toBe(2);
    expect(effects.createAnalysis).not.toHaveBeenCalled();
  });

  it("doesn't reopen someone else's analysis of it for a user who can create their own", async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([analysis(1, 'you', '2', [revisionSource(21)])]);
    expect(await analyzeRevision(source, revision(21), me)).toBe(100);
  });

  it('cannot analyze a pending or failed revision', async () => {
    expect(await analyzeRevision(source, revision(23, 0, 'pending'), me)).toBeNull();
    expect(await analyzeRevision(source, revision(24, 0, 'failed'), me)).toBeNull();
    expect(effects.getAnalysisSourceUsage).not.toHaveBeenCalled();
    expect(effects.createAnalysis).not.toHaveBeenCalled();
  });

  it("doesn't start with a row for a revision too big to load whole, or with no activities", async () => {
    effects.getAnalysisSourceUsage.mockResolvedValue([]);
    await analyzeRevision(source, revision(21, INITIAL_ACTIVITY_ROW_LIMIT + 1), me);
    expect(created().definition.view.plan.timelines[0].rows).toEqual([]);
    expect(created().definition.sources).toHaveLength(1); // still bound: its resources are in the Sources browser
    await analyzeRevision(source, revision(21, 0), me);
    expect(created().definition.view.plan.timelines[0].rows).toEqual([]);
    await analyzeRevision(source, revision(21, INITIAL_ACTIVITY_ROW_LIMIT), me);
    expect(created().definition.view.plan.timelines[0].rows).toHaveLength(1);
  });
});
