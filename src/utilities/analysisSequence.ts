import type { AnalysisSourceBinding, AnalysisSourceRevision } from '../types/analysis';

/*
 * An authored sequence as its seqJSON source keeps it (see the backend's SeqJsonAdapter: revision
 * metadata.product.mission), read for the Sequence inspector. Only what the file says: nothing is placed in time that
 * the file doesn't place, and nothing is attributed that the file doesn't attribute.
 */

export type AuthoredStep = {
  args?: Record<string, unknown> | unknown[];
  dataQuality?: string;
  description?: string;
  engine?: unknown;
  epoch?: unknown;
  metadata?: Record<string, unknown>;
  models?: unknown;
  name?: string;
  position: number;
  time?: { tag?: string; type: string };
  type: string;
};

export type AuthoredMission = {
  generatedFrom?: { planId?: number; seqId?: string; simulationDatasetId?: number };
  immediateCommands?: AuthoredStep[];
  kind: 'authored sequence';
  metadata?: Record<string, unknown>;
  requests?: { groundEpoch?: unknown; name: string; steps: AuthoredStep[]; time?: unknown }[];
  sequenceId: string;
  steps: AuthoredStep[];
  timing?: { absoluteSteps?: number; note?: string; otherSteps?: number };
};

/** What "Analyze sequence" recorded about the workspace file a revision is a snapshot of. */
export type WorkspaceFileSnapshot = {
  conversion?: { adaptationId: number | null; commandDictionaryId: number | null; from: string };
  /** Older snapshots said only the language they were converted from. */
  convertedFrom?: string;
  inputHash?: string;
  path: string;
  workspaceId: number;
  workspaceName: string;
};

/** "sha256:<hex>" of `text` as UTF-8: how revisions and snapshots name content. */
export async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** One step of the sequence, wherever it is: its top-level steps, a request's, or an immediate command. */
export type AuthoredEntry = {
  /** Unique in the sequence, e.g. "steps:3", "request:R1:2", "immediate:1". */
  id: string;
  /** The key of its timeline record, when it has one: only top-level steps with an ABSOLUTE time do. */
  recordKey: string | null;
  /** The simulated activity a generator said the step was expanded from (its metadata.simulatedActivityId). */
  simulatedActivityId: number | null;
  step: AuthoredStep;
};

export type AuthoredSection = { entries: AuthoredEntry[]; label: string; note?: string };

export function getAuthoredMission(revision: AnalysisSourceRevision | undefined): AuthoredMission | null {
  const mission = (revision?.metadata as { product?: { mission?: AuthoredMission } } | null)?.product?.mission;
  return mission?.kind === 'authored sequence' ? mission : null;
}

export function getWorkspaceFileSnapshot(revision: AnalysisSourceRevision | undefined): WorkspaceFileSnapshot | null {
  const file = (revision?.metadata as { workspaceFile?: WorkspaceFileSnapshot } | null)?.workspaceFile;
  return file && typeof file.workspaceId === 'number' && typeof file.path === 'string' ? file : null;
}

/** The analysis's imported sources that are authored sequences, with their revision and sequence. */
export function getAuthoredSequenceSources(bindings: AnalysisSourceBinding[], revisions: AnalysisSourceRevision[]) {
  return bindings.flatMap(binding => {
    if (binding.kind !== 'imported') {
      return [];
    }
    const revision = revisions.find(({ id }) => id === binding.revisionId);
    const mission = getAuthoredMission(revision);
    return revision && mission ? [{ binding, mission, revision }] : [];
  });
}

function entry(id: string, step: AuthoredStep, recordKey: string | null): AuthoredEntry {
  const simulatedActivityId = step.metadata?.simulatedActivityId;
  return {
    id,
    recordKey,
    simulatedActivityId: typeof simulatedActivityId === 'number' ? simulatedActivityId : null,
    step,
  };
}

/** The sequence's contents in the file's order, by where they are in it. Empty sections are left out. */
export function getAuthoredSections(mission: AuthoredMission): AuthoredSection[] {
  const sections: AuthoredSection[] = [
    {
      entries: (mission.steps ?? []).map(step =>
        entry(
          `steps:${step.position}`,
          step,
          // The adapter makes a record only of a top-level step whose ABSOLUTE tag it could read.
          step.time?.type === 'ABSOLUTE' && !step.dataQuality ? `${mission.sequenceId}#${step.position}` : null,
        ),
      ),
      label: 'Steps',
    },
    ...(mission.requests ?? []).map(request => ({
      entries: request.steps.map(step => entry(`request:${request.name}:${step.position}`, step, null)),
      label: `Request ${request.name}`,
      note: describeRequestTime(request.time),
    })),
    {
      entries: (mission.immediateCommands ?? []).map(step => entry(`immediate:${step.position}`, step, null)),
      label: 'Immediate commands',
      note: 'Run when received; they have no time tag',
    },
  ];
  return sections.filter(section => section.entries.length);
}

function describeRequestTime(time: unknown): string | undefined {
  const t = time as { tag?: string; type?: string } | undefined;
  return t?.type ? `Request time ${t.type}${t.tag ? ` ${t.tag}` : ''}` : undefined;
}

/** A step's time tag as written, and what it means for placing it in time. */
export function describeStepTime(time: AuthoredStep['time']): { label: string; meaning: string } {
  switch (time?.type) {
    case 'ABSOLUTE':
      return { label: `A ${time.tag ?? ''}`, meaning: 'At this time' };
    case 'COMMAND_RELATIVE':
      return { label: `R ${time.tag ?? ''}`, meaning: 'After the previous step, by this much' };
    case 'EPOCH_RELATIVE':
      return { label: `E ${time.tag ?? ''}`, meaning: 'Relative to an epoch set when the sequence runs' };
    case 'BLOCK_RELATIVE':
      return { label: `B ${time.tag ?? ''}`, meaning: 'Relative to the start of its block' };
    case 'COMMAND_COMPLETE':
      return { label: 'C', meaning: 'When the previous step completes' };
    case undefined:
      return { label: '—', meaning: 'No time tag' };
    default:
      return { label: `${time?.type} ${time?.tag ?? ''}`.trim(), meaning: 'As written' };
  }
}

/** A step's arguments, written out on one line. */
export function formatStepArgs(args: AuthoredStep['args']): string {
  if (!args) {
    return '';
  }
  if (Array.isArray(args)) {
    return args.map(arg => JSON.stringify((arg as { value?: unknown })?.value ?? arg)).join(' ');
  }
  return Object.entries(args)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(' ');
}

/** Whether a step mentions `query` (case-insensitive): its name, kind, arguments, description or time tag. */
export function stepMatches(step: AuthoredStep, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [step.name, step.type, formatStepArgs(step.args), step.description, step.time?.tag]
    .filter(Boolean)
    .some(text => `${text}`.toLowerCase().includes(q));
}

/**
 * How a generated sequence's own claims about where it came from hold up against what PlanDev records: the sequence
 * (seq id in the simulation dataset) exists and its simulation is of the plan claimed; each step's simulated activity
 * is one assigned to the sequence. Claims are never upgraded beyond what was checked.
 */
export function checkGeneratedFrom(
  claimed: NonNullable<AuthoredMission['generatedFrom']>,
  recorded: { assigned: number[]; exists: boolean; planId: number | null } | null,
  stepActivityIds: number[],
): {
  plan: 'verified' | 'mismatch' | 'unchecked';
  sequence: 'verified' | 'missing' | 'unchecked';
  stepActivities: { unassigned: number[]; verified: number[] };
} {
  if (!recorded) {
    return { plan: 'unchecked', sequence: 'unchecked', stepActivities: { unassigned: [], verified: [] } };
  }
  const assigned = new Set(recorded.assigned);
  const ids = [...new Set(stepActivityIds)];
  return {
    plan: !recorded.exists || claimed.planId === undefined ? 'unchecked' : recorded.planId === claimed.planId ? 'verified' : 'mismatch',
    sequence: recorded.exists ? 'verified' : 'missing',
    stepActivities: { unassigned: ids.filter(id => !assigned.has(id)), verified: ids.filter(id => assigned.has(id)) },
  };
}
