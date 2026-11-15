import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisSourceBinding, AnalysisSourceRevision } from '../../types/analysis';
import type { User } from '../../types/app';
import { sha256 } from '../../utilities/analysisSequence';

const effects = vi.hoisted(() => ({
  getAnalysisActivities: vi.fn(async () => [{ activity_id: 12, name: 'Lunch bite 1' }]),
  getSequenceProvenance: vi.fn(),
  getSourceActivityLinks: vi.fn(async () => []),
  readWorkspaceFileQuietly: vi.fn(),
}));
vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../../utilities/effects', () => ({ default: effects }));
vi.mock('../../stores/subscribable', () => {
  const store = <T>(value: T) => ({ subscribe: (run: (value: T) => void) => (run(value), () => {}) });
  return { gqlSubscribable: () => ({ ...store([]), error: store(''), loading: store(false) }) };
});

const { default: AnalysisSequencePanel } = await import('./AnalysisSequencePanel.svelte');

const user = { id: 'test' } as User;
const input = '@ID "testDescription"\nC ECHO "TEST1"\nR00:00:01 FSW_CMD\n';

/** As SeqJsonAdapter writes it for SeqDev's e2e fixture ban00001 (relative and command-complete times only). */
const mission = {
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
    {
      args: [],
      metadata: { simulatedActivityId: 12 },
      name: 'FSW_CMD',
      position: 2,
      time: { tag: '00:00:01', type: 'COMMAND_RELATIVE' },
      type: 'command',
    },
  ],
};

async function revision(extra: { generatedFrom?: object } = {}): Promise<AnalysisSourceRevision> {
  return {
    activity_types: [],
    id: 40,
    metadata: {
      product: { mission: { ...mission, ...extra } },
      workspaceFile: {
        conversion: { adaptationId: null, commandDictionaryId: 1, from: 'SeqN' },
        inputHash: await sha256(input),
        path: 'seqs/ban.seqN.txt',
        workspaceId: 2,
        workspaceName: 'ws',
      },
    },
    requested_at: '2026-11-15T00:00:00Z',
  } as unknown as AnalysisSourceRevision;
}
const bindings: AnalysisSourceBinding[] = [{ id: 'source-1', kind: 'imported', revisionId: 40 }];

describe('the Sequence inspector', () => {
  beforeEach(() => {
    effects.readWorkspaceFileQuietly.mockResolvedValue(input);
    effects.getSequenceProvenance.mockResolvedValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists a sequence with no absolute times in order, says once that none of it is on the timeline, and makes up no time', async () => {
    render(AnalysisSequencePanel, { bindings, revisions: [await revision()], user });
    expect(screen.getByText(/none on the timeline \(no absolute times\)/)).toBeTruthy();
    const rows = screen.getAllByRole('listitem').map(item => item.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['1 ECHO "TEST1" C', '2 FSW_CMD R 00:00:01']);
    await waitFor(() => expect(screen.getByText(/The file is unchanged since/)).toBeTruthy());
    expect(screen.getByText(/converted from SeqN by the built-in conversion/)).toBeTruthy();
    // Opened, a step says what its tag means, and that it is not on the timeline.
    await fireEvent.click(screen.getByText('ECHO'));
    expect(screen.getByText(/When the previous step completes/)).toBeTruthy();
    expect(screen.getByText(/no absolute time$/)).toBeTruthy();
    // Nothing generated it: no plan is claimed.
    expect(screen.queryByLabelText('Generated from')).toBeNull();
  });

  it('says when the file has changed since, and opens it in SeqDev as it is now', async () => {
    effects.readWorkspaceFileQuietly.mockResolvedValue(`${input}C NOOP\n`);
    render(AnalysisSequencePanel, { bindings, revisions: [await revision()], user });
    await waitFor(() => expect(screen.getByText('The SeqDev file has changed since this snapshot.')).toBeTruthy());
    expect(screen.getByRole('link', { name: /Open in SeqDev/ }).getAttribute('href')).toBe(
      '/workspaces/2?sequenceId=seqs%2Fban.seqN.txt',
    );

    cleanup();
    effects.readWorkspaceFileQuietly.mockResolvedValue(null);
    render(AnalysisSequencePanel, { bindings, revisions: [await revision()], user });
    await waitFor(() => expect(screen.getByText(/can't be read now/)).toBeTruthy());
    expect(screen.queryByRole('link', { name: /Open in SeqDev/ })).toBeNull();
  });

  it('says "verified" only for the exact saved expansion output, and names the activity each step came from', async () => {
    effects.getSequenceProvenance.mockResolvedValue({
      assigned: [12],
      exists: true,
      generated: { created_at: '2026-11-15T00:00:00Z', expanded_template: input, id: 3 },
      planId: 3,
    });
    const generatedFrom = { planId: 3, seqId: 'testDescription', simulationDatasetId: 1 };
    render(AnalysisSequencePanel, { bindings, revisions: [await revision({ generatedFrom })], user });
    expect(screen.getByLabelText('Generated from').textContent).toMatch(/Generated from plan 3 · Simulation 1/);
    await waitFor(() => expect(screen.getByText(/1 activity contributed · Verified/)).toBeTruthy());
    await fireEvent.click(screen.getByText('FSW_CMD'));
    await waitFor(() => expect(screen.getByText('Lunch bite 1')).toBeTruthy());
    expect(screen.queryByText('not assigned now')).toBeNull();
  });

  it('keeps a claim a claim when the snapshot differs from the latest output, and says what disagrees', async () => {
    effects.getSequenceProvenance.mockResolvedValue({
      assigned: [],
      exists: true,
      generated: { created_at: '2026-11-15T00:00:00Z', expanded_template: `${input}C MORE\n`, id: 4 },
      planId: 3,
    });
    const generatedFrom = { planId: 3, seqId: 'testDescription', simulationDatasetId: 1 };
    render(AnalysisSequencePanel, { bindings, revisions: [await revision({ generatedFrom })], user });
    await waitFor(() => expect(screen.getByText(/Differs from its latest generated output/)).toBeTruthy());
    expect(screen.queryByText(/Verified/)).toBeNull();
    expect(screen.getByText(/1 of the activities its steps name is not assigned to testDescription now/)).toBeTruthy();
  });
});
