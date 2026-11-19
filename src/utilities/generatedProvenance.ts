import { base } from '$app/paths';
import { SearchParameters } from '../enums/searchParameters';
import type { User } from '../types/app';
import type { Workspace } from '../types/workspace';
import type { WorkspaceTreeNode } from '../types/workspace-tree-view';
import { flattenWorkspaceTreeWithPaths, WorkspaceApi } from './workspaces';

/**
 * Where a generated sequence came from, recorded on its workspace file (`user.generatedFrom`) by the
 * step that wrote it. Only what generation actually knew; never reconstructed afterwards.
 */
export type GeneratedFrom = {
  expandedAt: string | null;
  /** The `expanded_templates` row whose text was written. */
  expandedTemplateId: number | null;
  kind: 'sequence-template-expansion';
  planId: number;
  planName: string;
  seqId: string;
  simulationDatasetId: number;
  /** Simulated activities linked to the sequence when it was written (`sequence_to_simulated_activity`). */
  spanIds: number[];
  writtenAt: string;
};

export const GENERATED_FROM_KEY = 'generatedFrom';

export function getGeneratedFrom(user: Record<string, unknown> | null | undefined): GeneratedFrom | null {
  const value = user?.[GENERATED_FROM_KEY] as Partial<GeneratedFrom> | undefined;
  return value && typeof value.planId === 'number' && typeof value.seqId === 'string' && Array.isArray(value.spanIds)
    ? (value as GeneratedFrom)
    : null;
}

/** The plan page, on the simulation the sequence was generated from, with one of its activities selected. */
export function getGeneratedFromPlanUrl(from: GeneratedFrom, spanId: number | null = null): string {
  const params = new URLSearchParams({ [SearchParameters.SIMULATION_DATASET_ID]: `${from.simulationDatasetId}` });
  if (spanId !== null) {
    params.set(SearchParameters.SPAN_ID, `${spanId}`);
  }
  return `${base}/plans/${from.planId}?${params}`;
}

export type GeneratedFile = { from: GeneratedFrom; path: string; workspace: Workspace };

/**
 * Workspace files whose recorded provenance names this plan, across the given workspaces. One
 * listing per workspace; workspaces the user cannot list are skipped.
 */
export async function findGeneratedFiles(
  workspaces: Workspace[],
  planId: number,
  user: User | null,
): Promise<GeneratedFile[]> {
  const perWorkspace = await Promise.all(
    workspaces.map(async workspace => {
      try {
        const contents: WorkspaceTreeNode[] | null = await WorkspaceApi.getWorkspaceContents(
          workspace.id,
          '',
          user,
          true,
        );
        return flattenWorkspaceTreeWithPaths(contents ?? []).flatMap(node => {
          const from = getGeneratedFrom(node.metadata?.user);
          return from?.planId === planId ? [{ from, path: node.fullPath, workspace }] : [];
        });
      } catch {
        return [];
      }
    }),
  );
  return perWorkspace.flat();
}
