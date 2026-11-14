import { describe, expect, it, vi } from 'vitest';
import type { User } from '../types/app';
import { getActivityDrawingId, importedActivityToSpan } from '../utilities/analysis';

const effects = vi.hoisted(() => ({ getSourceActivities: vi.fn(), getSourceActivityLinks: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../utilities/effects', () => ({ default: effects }));
vi.mock('./subscribable', () => ({ gqlSubscribable: vi.fn() }));

const { getRevisionActivities } = await import('./analysisActivities');

const user = { activeRole: 'user', id: 'test', permissibleQueries: {}, token: 't' } as unknown as User;
const record = (id: number, type = 'Pass') => ({
  category: null as string | null,
  end_time: '2030-01-01T01:00:00Z',
  id,
  name: `${type} ${id}`,
  parameters: {},
  start_time: '2030-01-01T00:00:00Z',
  type,
});

describe('getRevisionActivities', () => {
  it('gives each source binding its own identity for one revision, from a single load', async () => {
    effects.getSourceActivities.mockResolvedValue([record(1), record(2)]);
    const asPlan = await getRevisionActivities(42, null, a => importedActivityToSpan('imported:42', a), user);
    const asAnalysis = await getRevisionActivities(42, null, a => importedActivityToSpan('source-1', a), user);
    const asOtherAnalysis = await getRevisionActivities(42, null, a => importedActivityToSpan('source-7', a), user);

    expect(effects.getSourceActivities).toHaveBeenCalledTimes(1);
    expect(asPlan.map(s => s.sourceId)).toEqual(['imported:42', 'imported:42']);
    expect(asAnalysis.map(s => s.sourceId)).toEqual(['source-1', 'source-1']);
    expect(asOtherAnalysis.map(s => s.sourceId)).toEqual(['source-7', 'source-7']);
    expect(asAnalysis[0].span_id).toBe(getActivityDrawingId({ activityId: 1, sourceId: 'source-1' }));
    expect(new Set([asPlan[0].span_id, asAnalysis[0].span_id, asOtherAnalysis[0].span_id]).size).toBe(3);
    // Every consumer's activities are its own objects: one's changes can't reach another's.
    expect(asPlan[0]).not.toBe(asAnalysis[0]);
  });

  it('keeps type filters independent and retries a failed load', async () => {
    effects.getSourceActivities.mockReset();
    effects.getSourceActivities.mockImplementation(async (_revision: number, types: string[] | null) =>
      types ? [record(3, types[0])] : [record(3, 'A'), record(4, 'B')],
    );
    const toSpan = (a: ReturnType<typeof record>) => importedActivityToSpan('source-1', a);
    expect((await getRevisionActivities(9, ['A'], toSpan, user)).map(s => s.type)).toEqual(['A']);
    expect((await getRevisionActivities(9, ['B'], toSpan, user)).map(s => s.type)).toEqual(['B']);
    expect(await getRevisionActivities(9, null, toSpan, user)).toHaveLength(2);

    effects.getSourceActivities.mockReset();
    effects.getSourceActivities.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([record(5)]);
    await expect(getRevisionActivities(10, null, toSpan, user)).rejects.toThrow('down');
    await Promise.resolve();
    expect(await getRevisionActivities(10, null, toSpan, user)).toHaveLength(1);
  });

  it('links each record to the parent it names, even when the parent is of a type not loaded', async () => {
    effects.getSourceActivities.mockReset();
    const command = (id: number, parent: string) => ({ ...record(id, 'COMMAND'), parent, source_key: `cmd-${id}` });
    effects.getSourceActivities.mockResolvedValue([command(7, 'seq-A'), command(8, 'seq-gone'), command(9, 'cmd-7')]);
    // seq-A is a SEQUENCE (id 2) not in this load; seq-gone names no record.
    effects.getSourceActivityLinks.mockResolvedValue([
      { id: 2, source_key: 'seq-A' },
      { id: 7, source_key: 'cmd-7' },
    ]);
    const spans = await getRevisionActivities(11, ['COMMAND'], a => importedActivityToSpan('source-1', a), user);
    expect(effects.getSourceActivityLinks).toHaveBeenCalledWith(11, { keys: ['seq-A', 'seq-gone', 'cmd-7'] }, 3, user);
    expect(spans.map(span => span.parent_id)).toEqual([
      getActivityDrawingId({ activityId: 2, sourceId: 'source-1' }),
      null,
      getActivityDrawingId({ activityId: 7, sourceId: 'source-1' }),
    ]);
  });
});
