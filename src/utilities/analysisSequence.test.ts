import { describe, expect, it } from 'vitest';
import {
  checkGeneratedFrom,
  describeStepTime,
  getAuthoredSections,
  stepMatches,
  type AuthoredMission,
} from './analysisSequence';

const mission: AuthoredMission = {
  immediateCommands: [{ name: 'NOOP', position: 1, type: 'immediate_command' }],
  kind: 'authored sequence',
  requests: [
    {
      name: 'R1',
      steps: [{ name: 'CMD_R', position: 1, time: { tag: '00:00:05', type: 'COMMAND_RELATIVE' }, type: 'command' }],
      time: { tag: '2031-001T00:00:00', type: 'ABSOLUTE' },
    },
  ],
  sequenceId: 'seq',
  steps: [
    {
      args: { mode: 'ON' },
      metadata: { simulatedActivityId: 12 },
      name: 'CMD_A',
      position: 1,
      time: { tag: '2031-001T06:00:00', type: 'ABSOLUTE' },
      type: 'command',
    },
    { name: 'CMD_B', position: 2, time: { type: 'COMMAND_COMPLETE' }, type: 'command' },
    {
      dataQuality: 'Its ABSOLUTE time tag could not be read; not drawn',
      name: 'CMD_C',
      position: 3,
      time: { tag: 'garbage', type: 'ABSOLUTE' },
      type: 'command',
    },
  ],
};

describe('getAuthoredSections', () => {
  it('lists steps, requests and immediate commands in the file order, with records only for readable ABSOLUTE steps', () => {
    const sections = getAuthoredSections(mission);
    expect(sections.map(s => s.label)).toEqual(['Steps', 'Request R1', 'Immediate commands']);
    const [steps, request, immediate] = sections;
    expect(steps.entries.map(e => e.recordKey)).toEqual(['seq#1', null, null]);
    expect(steps.entries.map(e => e.simulatedActivityId)).toEqual([12, null, null]);
    expect(request.entries[0].id).toBe('request:R1:1');
    expect(request.note).toContain('ABSOLUTE');
    expect(immediate.entries[0].recordKey).toBeNull();
  });

  it('leaves empty sections out', () => {
    expect(getAuthoredSections({ ...mission, immediateCommands: [], requests: [] }).map(s => s.label)).toEqual([
      'Steps',
    ]);
  });
});

describe('describeStepTime', () => {
  it('says what each kind of tag means, and makes up no time', () => {
    expect(describeStepTime({ type: 'COMMAND_COMPLETE' }).meaning).toContain('completes');
    expect(describeStepTime(undefined).label).toBe('—');
    expect(describeStepTime({ tag: '00:01:00', type: 'COMMAND_RELATIVE' }).label).toBe('R 00:01:00');
  });
});

describe('stepMatches', () => {
  it('finds a step by name, arguments or tag', () => {
    expect(stepMatches(mission.steps[0], 'cmd_a')).toBe(true);
    expect(stepMatches(mission.steps[0], 'mode="ON"')).toBe(true);
    expect(stepMatches(mission.steps[0], '2031-001')).toBe(true);
    expect(stepMatches(mission.steps[1], 'mode')).toBe(false);
  });
});

describe('checkGeneratedFrom', () => {
  const claimed = { planId: 3, seqId: 'seq', simulationDatasetId: 1 };
  it('verifies only what PlanDev records', () => {
    const result = checkGeneratedFrom(claimed, { assigned: [12, 13], exists: true, planId: 3 }, [12, 99]);
    expect(result).toEqual({
      plan: 'verified',
      sequence: 'verified',
      stepActivities: { unassigned: [99], verified: [12] },
    });
  });
  it('says when the claim does not hold, or could not be checked', () => {
    expect(checkGeneratedFrom(claimed, { assigned: [], exists: true, planId: 4 }, []).plan).toBe('mismatch');
    expect(checkGeneratedFrom(claimed, { assigned: [], exists: false, planId: null }, []).sequence).toBe('missing');
    expect(checkGeneratedFrom(claimed, null, [12]).sequence).toBe('unchecked');
  });
});
