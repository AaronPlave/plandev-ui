import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));
const { default: AnalysisAuthoredSequence } = await import('./AnalysisAuthoredSequence.svelte');

/** As SeqJsonAdapter writes it for SeqDev's e2e fixture ban00001 (relative and command-complete times only). */
const authored = {
  format: 'seqJSON',
  kind: 'authored sequence',
  sequenceId: 'testDescription',
  steps: [
    {
      args: [{ type: 'string', value: 'TEST1' }],
      name: 'ECHO',
      position: 1,
      time: { type: 'COMMAND_COMPLETE' },
      type: 'command',
    },
    { args: [], name: 'FSW_CMD', position: 2, time: { tag: '00:00:01', type: 'COMMAND_RELATIVE' }, type: 'command' },
  ],
  timing: {
    absoluteSteps: 0,
    note: 'Steps without an ABSOLUTE time are listed in order only; no time is made up for them',
    otherSteps: 2,
  },
};

describe('an authored sequence', () => {
  afterEach(cleanup);

  it('lists its steps in order with their time tags as written, and claims no plan of its own', () => {
    render(AnalysisAuthoredSequence, { mission: authored });
    expect(screen.getByText('Steps (2)')).toBeTruthy();
    const items = screen.getAllByRole('listitem').map(item => item.textContent?.replace(/\s+/g, ' ').trim());
    expect(items).toEqual([
      '1 ECHO command "TEST1" after previous completes',
      '2 FSW_CMD command COMMAND_RELATIVE 00:00:01',
    ]);
    expect(screen.queryByText('Generated from')).toBeNull();
    expect(screen.getByText(/no time is made up/)).toBeTruthy();
  });

  it('says what a generator said it came from', () => {
    render(AnalysisAuthoredSequence, {
      mission: { ...authored, generatedFrom: { planId: 3, simulationDatasetId: 7 } },
    });
    expect(screen.getByRole('link', { name: 'plan 3' }).getAttribute('href')).toBe('/plans/3');
    expect(screen.getByText('simulation dataset 7')).toBeTruthy();
  });
});
