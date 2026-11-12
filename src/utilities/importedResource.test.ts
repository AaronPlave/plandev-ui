import { describe, expect, it } from 'vitest';
import {
  composeSeries,
  coversViewport,
  GAP,
  isCompleteRaw,
  NULL,
  planViewportQuery,
  seriesToValues,
  toLoadedWindow,
  type SourceQueryResult,
  type SourceSeries,
} from './importedResource';

function result(series: SourceSeries, extra: Partial<SourceQueryResult> = {}): SourceQueryResult {
  return {
    after: null,
    approximate: false,
    before: null,
    bucketWidth: null,
    next: null,
    representation: 'raw',
    resource: 'r',
    series,
    ...extra,
  };
}

describe('planViewportQuery', () => {
  it('overscans the visible window and scales the budget with width in pixels', () => {
    const query = planViewportQuery({ end: 2000, start: 1000 }, 500);
    expect(query.start).toBe(500_000);
    expect(query.end).toBe(2_500_000);
    expect(query.pointBudget).toBe(2000);
    expect(query.fidelity).toBe('display');
  });

  it('caps the point budget', () => {
    expect(planViewportQuery({ end: 2000, start: 1000 }, 100_000).pointBudget).toBe(8000);
  });
});

describe('coversViewport', () => {
  const query = planViewportQuery({ end: 2000, start: 1000 }, 500);

  it('serves pans inside the overscan without a request', () => {
    const loaded = toLoadedWindow(query, result({ t: [] }, { approximate: true, representation: 'summary' }));
    expect(coversViewport(loaded, { end: 2300, start: 1300 }, 500)).toBe(true);
    expect(coversViewport(loaded, { end: 2600, start: 1600 }, 500)).toBe(false);
  });

  it('needs a finer request when zooming into reduced data, but not into complete data', () => {
    const reduced = toLoadedWindow(query, result({ t: [] }, { approximate: true, representation: 'summary' }));
    expect(coversViewport(reduced, { end: 1500, start: 1400 }, 500)).toBe(false);
    const complete = toLoadedWindow(query, result({ t: [] }));
    expect(coversViewport(complete, { end: 1500, start: 1400 }, 500)).toBe(true);
  });
});

describe('composeSeries', () => {
  const overview = result({ t: [0, 10_000, 20_000, 30_000, 40_000], v: [0, 1, 2, 3, 4] });

  it('replaces the overview between the detail boundary samples', () => {
    const detail = result(
      { t: [12_000, 15_000, 18_000], v: [1.2, 1.5, 1.8] },
      { after: { t: [20_000], v: [2] }, before: { t: [10_000], v: [1] } },
    );
    const series = composeSeries(overview, detail, true);
    expect(series.t).toEqual([0, 10_000, 12_000, 15_000, 18_000, 20_000, 30_000, 40_000]);
    expect(series.v).toEqual([0, 1, 1.2, 1.5, 1.8, 2, 3, 4]);
  });

  it('keeps the overview when the detail window has no samples near it', () => {
    expect(composeSeries(overview, result({ t: [], v: [] }), true).t).toEqual(overview.series.t);
  });

  it('a window with no values inside still carries the value in effect', () => {
    const detail = result({ t: [], v: [] }, { after: { t: [20_000], v: [2] }, before: { t: [10_000], v: [1] } });
    expect(composeSeries(null, detail, true).t).toEqual([10_000, 20_000]);
  });
});

describe('seriesToValues', () => {
  it('step: each sample holds until the next, the last until holdUntil, across a window that starts between samples', () => {
    const detail = result({ t: [15_000], v: [5] }, { after: { t: [30_000], v: [7] }, before: { t: [5_000], v: [3] } });
    const values = seriesToValues(composeSeries(null, detail, true), {
      holdUntil: 40,
      interpolation: 'constant',
      numeric: true,
    });
    expect(values).toEqual([
      { is_gap: false, is_sample: true, x: 5, y: 3 },
      { is_gap: false, x: 15, y: 3 },
      { is_gap: false, is_sample: true, x: 15, y: 5 },
      { is_gap: false, x: 30, y: 5 },
      { is_gap: false, is_sample: true, x: 30, y: 7 },
      { is_gap: false, x: 40, y: 7 },
    ]);
  });

  it('linear: one point per sample, including the samples outside the window', () => {
    const detail = result({ t: [15_000], v: [5] }, { after: { t: [30_000], v: [7] }, before: { t: [5_000], v: [3] } });
    const values = seriesToValues(composeSeries(null, detail, true), {
      holdUntil: 40,
      interpolation: 'linear',
      numeric: true,
    });
    expect(values).toEqual([
      { is_sample: true, x: 5, y: 3 },
      { is_sample: true, x: 15, y: 5 },
      { is_sample: true, x: 30, y: 7 },
    ]);
  });

  it('distinguishes a valid null from a gap', () => {
    const values = seriesToValues(
      { k: [0, NULL, GAP, 0], s: ['A', null, null, 'B'], t: [0, 1000, 2000, 3000] },
      { holdUntil: 4, interpolation: 'constant', numeric: false },
    );
    expect(values.map(({ is_gap, y }) => [y, is_gap])).toEqual([
      ['A', false],
      ['A', false],
      [null, false],
      [null, false],
      [null, true],
      [null, true],
      ['B', false],
      ['B', false],
    ]);
  });

  it('keeps samples that share a timestamp, in order', () => {
    const values = seriesToValues(
      { s: ['A', 'B', 'C'], t: [1000, 1000, 2000] },
      { holdUntil: 3, interpolation: 'constant', numeric: false },
    );
    expect(values.map(v => [v.x, v.y])).toEqual([
      [1, 'A'],
      [1, 'A'],
      [1, 'B'],
      [2, 'B'],
      [2, 'C'],
      [3, 'C'],
    ]);
  });
});

describe('sample provenance', () => {
  const raw = (series: SourceSeries, extra: Partial<SourceQueryResult> = {}) => result(series, extra);
  const summary = (series: SourceSeries) => result(series, { approximate: true, representation: 'summary' });
  const render = (series: ReturnType<typeof composeSeries>, interpolation: 'linear' | 'constant' = 'linear') =>
    seriesToValues(series, { holdUntil: 100, interpolation, numeric: true });
  const sampleXs = (values: { is_sample?: boolean; x: number }[]) => values.filter(v => v.is_sample).map(v => v.x);

  it('a complete raw response is eligible; summary and approximate raw responses are not', () => {
    const series = { t: [0, 10_000], v: [1, 2] };
    expect(isCompleteRaw(raw(series))).toBe(true);
    expect(isCompleteRaw(summary(series))).toBe(false);
    expect(isCompleteRaw(raw(series, { approximate: true }))).toBe(false);
    expect(sampleXs(render(composeSeries(raw(series), null, true)))).toEqual([0, 10]);
    expect(sampleXs(render(composeSeries(summary(series), null, true)))).toEqual([]);
    expect(sampleXs(render(composeSeries(raw(series, { approximate: true }), null, true)))).toEqual([]);
  });

  it('judges the overview and the detail independently', () => {
    const overview = summary({ t: [0, 10_000, 20_000, 30_000, 40_000], v: [0, 1, 2, 3, 4] });
    const detail = raw(
      { t: [12_000, 15_000, 18_000], v: [1.2, 1.5, 1.8] },
      { after: { t: [20_000], v: [2] }, before: { t: [10_000], v: [1] } },
    );
    const values = render(composeSeries(overview, detail, true));
    // only the raw window and its boundary samples; the summary points around it stay unmarked
    expect(sampleXs(values)).toEqual([10, 12, 15, 18, 20]);
    expect(values.map(v => v.x)).toEqual([0, 10, 12, 15, 18, 20, 30, 40]); // line geometry unchanged
  });

  it('a summary approximate-raw detail does not vouch for anything, even over a raw overview', () => {
    const overview = raw({ t: [0, 40_000], v: [0, 4] });
    const detail = raw({ t: [12_000], v: [1] }, { approximate: true });
    expect(sampleXs(render(composeSeries(overview, detail, true)))).toEqual([0, 40]);
  });

  it('zooming into a held summary makes no markers; complete raw detail then makes real ones', () => {
    const overview = summary({ t: [0, 50_000], v: [0, 5] });
    expect(sampleXs(render(composeSeries(overview, overview, true), 'constant'))).toEqual([]);
    const detail = raw({ t: [20_000, 25_000, 30_000], v: [2, 2.5, 3] });
    expect(sampleXs(render(composeSeries(overview, detail, true), 'constant'))).toEqual([20, 25, 30]);
  });

  it('never marks a hold endpoint, even where it shares a sample x', () => {
    const values = render(composeSeries(raw({ t: [0, 10_000], v: [1, 2] }), null, true), 'constant');
    expect(values.map(v => [v.x, v.y, v.is_sample === true])).toEqual([
      [0, 1, true],
      [10, 1, false],
      [10, 2, true],
      [100, 2, false],
    ]);
    expect(values.some(v => v.is_hold)).toBe(false);
  });

  it('keeps null and gap values unmarked and their geometry unchanged', () => {
    const values = seriesToValues(
      composeSeries(raw({ k: [0, NULL, GAP, 0], t: [0, 1000, 2000, 3000], v: [1, null, null, 2] }), null, true),
      { holdUntil: 4, interpolation: 'linear', numeric: true },
    );
    expect(values.map(({ is_gap, is_sample, y }) => [y, is_gap ?? false, is_sample === true])).toEqual([
      [1, false, true],
      [null, false, false],
      [null, true, false],
      [null, true, false],
      [2, false, true],
    ]);
  });

  it('a series with no provenance (anything not composed) is unmarked', () => {
    expect(
      sampleXs(seriesToValues({ t: [0], v: [1] }, { holdUntil: 1, interpolation: 'linear', numeric: true })),
    ).toEqual([]);
  });
});
