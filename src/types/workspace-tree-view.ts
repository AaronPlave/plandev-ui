import type { WorkspaceContentType } from '../enums/workspace';

export type WorkspaceFileMetadataStatus = 'malformed' | 'missing' | 'ok';

export type WorkspaceFileMetadata = {
  createdAt?: string;
  createdBy?: string;
  lastEditedAt?: string;
  lastEditedBy?: string;
  readOnly?: boolean;
  user?: Record<string, unknown>;
  version?: string;
};

export type WorkspaceTreeNode = {
  contents?: WorkspaceTreeNode[];
  metadata?: WorkspaceFileMetadata | null;
  metadataStatus?: WorkspaceFileMetadataStatus;
  name?: string;
  /** Byte length of a file, from the workspace listing; absent for folders. */
  size?: number;
  type: WorkspaceContentType;
};

export type WorkspaceTreeNodeWithFullPath = WorkspaceTreeNode & {
  depth?: number;
  fullPath: string;
  hasChildren?: boolean;
};

export type WorkspaceTreeMap = Record<string, WorkspaceTreeNode>;

/** One line found by "Find in workspace" (the workspace service's `?search=`). */
export type WorkspaceSearchMatch = {
  column: number;
  line: number;
  path: string;
  snippet: string;
  /** Offset of the snippet within the line (long lines are cut around the match). */
  snippetStart: number;
};

export type WorkspaceSearchResult = {
  filesSearched: number;
  /** Binary files and files too large to search. */
  filesSkipped: number;
  matches: WorkspaceSearchMatch[];
  truncated: boolean;
};
