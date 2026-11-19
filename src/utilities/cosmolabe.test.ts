import { describe, expect, test } from 'vitest';
import type { Span } from '../types/simulation';
import { activityId, planetocentric, resolveMission, spanIdOf, spansToActivities } from './cosmolabe';

const span = (span_id: number, startMs: number, endMs: number, type = 'Periapsis') =>
  ({ attributes: { arguments: {}, computedAttributes: {} }, endMs, span_id, startMs, type }) as unknown as Span;

describe('cosmolabe', () => {
  test('resolves a mission by model name, with URLs relative to the index', () => {
    const index = {
      missions: { mro: { adapter: 'mro/adapter.js', catalog: 'mro/catalog.json', label: 'MRO', models: ['orbiter'] } },
      version: 1 as const,
    };
    expect(resolveMission(index, 'http://host:8890/missions/index.json', 'orbiter')).toEqual({
      adapterUrl: 'http://host:8890/missions/mro/adapter.js',
      catalogUrl: 'http://host:8890/missions/mro/catalog.json',
      key: 'mro',
      label: 'MRO',
    });
    expect(resolveMission(index, 'http://host/i.json', 'rover')).toBeNull();
    expect(resolveMission(index, 'http://host/i.json', undefined)).toBeNull();
  });

  test('activity ids name one span of one plan and dataset, and nothing else', () => {
    const id = activityId(86, 217, 1109);
    expect(spanIdOf(id, 86, 217)).toBe(1109);
    // Span ids are per dataset: the same span id in another dataset or plan is not this activity.
    expect(spanIdOf(id, 86, 219)).toBeNull();
    expect(spanIdOf(id, 8, 217)).toBeNull();
    expect(spanIdOf(activityId(86, 21, 7), 86, 2)).toBeNull();
    // Scene activities from a catalog are never PlanDev selections.
    expect(spanIdOf('curiosity:dingo-crossing', 86, 217)).toBeNull();
    expect(spanIdOf(null, 86, 217)).toBeNull();
  });

  test('spans become host activities: instants, intervals, provenance', () => {
    const t = Date.UTC(2024, 0, 2, 9, 27, 15);
    const [instant, interval, ...rest] = spansToActivities(
      [span(1, t, t), span(2, t, t + 300_000, 'TakeRadarObservation'), span(3, t, t - 1), span(4, NaN, NaN)],
      { body: 'Mars', datasetId: 217, planId: 86, planName: 'Plan', vehicle: 'MRO' },
    );
    expect(rest).toEqual([]);
    expect(instant).toMatchObject({
      id: 'plandev:plan/86/dataset/217/span/1',
      start: '2024-01-02T09:27:15.000Z',
      temporality: 'instant',
      timeSystem: 'UTC',
      vehicle: 'MRO',
    });
    expect(interval).toMatchObject({
      end: '2024-01-02T09:32:15.000Z',
      name: 'TakeRadarObservation',
      temporality: 'interval',
    });
    expect(interval.provenance.source).toBe('plandev:plan/86/simulation_dataset/217');
  });

  test('planetocentric latitude and east longitude from a body-fixed position', () => {
    const r = 3396.19;
    const p = planetocentric([0, -r * Math.cos(Math.PI / 6), r * Math.sin(Math.PI / 6)]);
    expect(p.latDeg).toBeCloseTo(30, 9);
    expect(p.lonDeg).toBeCloseTo(-90, 9);
    // On an oblate body a geodetic latitude reads higher than the planetocentric one the goals take.
    const geodetic = (18.742 * Math.PI) / 180;
    const [a, b] = [3396.19, 3376.2];
    const n = a / Math.sqrt(1 - (1 - (b * b) / (a * a)) * Math.sin(geodetic) ** 2);
    const xyz = [n * Math.cos(geodetic), 0, n * ((b * b) / (a * a)) * Math.sin(geodetic)] as const;
    expect(planetocentric(xyz).latDeg).toBeLessThan(18.742);
    expect(planetocentric(xyz).latDeg).toBeCloseTo(18.537, 2);
    expect(planetocentric([-1, -1e-12, 0]).lonDeg).toBeCloseTo(-180, 9);
  });

  test('UTC ↔ ET through the Cosmolabe package conversion, leap seconds included', async () => {
    const { etFromCalendarString, etToDate } = await import('@cosmolabe/viewer');
    // 2024-01-02T00:00:00Z = 757425669.184 s TDB past J2000 (ΔAT 37 s + 32.184 s)
    expect(etFromCalendarString('2024-01-02T00:00:00.000Z')).toBeCloseTo(757425669.184, 3);
    const ms = Date.UTC(2024, 0, 2, 8, 52, 29, 999);
    expect(etToDate(etFromCalendarString(new Date(ms).toISOString())).getTime()).toBe(ms);
  });
});
