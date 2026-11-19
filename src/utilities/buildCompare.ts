import type { User } from '../types/app';
import { findBuiltSourceCommit, type BuildProvenance } from './buildProvenance';
import { showWorkspaceFileComparisonModal } from './modal';
import { WorkspaceApi } from './workspaces';

/** The server's maximum: the whole history for any realistic file. */
const HISTORY_LIMIT = 1000;

/**
 * Opens the source as it was built (its revision, recorded commit, or the saved version with the
 * recorded content hash) against the saved source now. Returns a note when it can't be found.
 */
export async function compareSourceWithBuild(
  provenance: BuildProvenance,
  workspaceId: number,
  user: User | null,
): Promise<string | null> {
  const history = await WorkspaceApi.getFileHistory(workspaceId, provenance.source, user, undefined, HISTORY_LIMIT);
  const { commit, found, searched } = await findBuiltSourceCommit(provenance, history, c =>
    WorkspaceApi.getFileAtCommit(workspaceId, provenance.source, c, user),
  );
  if (!found) {
    return `The built source is not among the ${searched} saved versions of ${provenance.source} (it may have been saved under another path).`;
  }
  showWorkspaceFileComparisonModal({
    history,
    leftCommit: commit,
    leftFilePath: provenance.source,
    leftRevisionName: provenance.sourceRevision,
    rightFilePath: provenance.source,
    type: null,
    user,
    workspaceId,
  });
  return null;
}
