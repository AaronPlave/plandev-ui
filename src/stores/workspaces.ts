import { derived, writable, type Readable, type Writable } from 'svelte/store';
import { WORKSPACE_SHOW_MANAGED_FILES_KEY } from '../constants/localStorage';
import { WorkspaceContentMode } from '../enums/workspace';
import type { Parcel } from '../types/sequencing';
import type { Workspace } from '../types/workspace';
import gql from '../utilities/gql';
import { getLocalStorageItem, setLocalStorageItem } from '../utilities/localStorage';
import { gqlSubscribable } from './subscribable';

/* Writable */
export const selectedActionDefinitionId: Writable<number | null> = writable(null);

export const selectedActionRunId: Writable<number | null> = writable(null);

/** Whether workspace browsers list tool-managed files (see `getFileManager`). Remembered per browser. */
export const showManagedFiles: Writable<boolean> = writable(
  getLocalStorageItem<boolean>(WORKSPACE_SHOW_MANAGED_FILES_KEY) ?? false,
);
showManagedFiles.subscribe(value => setLocalStorageItem(WORKSPACE_SHOW_MANAGED_FILES_KEY, value));

export const workspaceColumns: Writable<string> = writable('1fr 3px 3fr');

export const workspaceContentMode: Writable<WorkspaceContentMode> = writable(WorkspaceContentMode.File);

export const workspaceId: Writable<number> = writable(-1);

/* Subscriptions. */
export const parcels = gqlSubscribable<Parcel[]>(gql.SUB_PARCELS, {}, []);
export const workspaces = gqlSubscribable<Workspace[]>(gql.SUB_WORKSPACES, {}, []);

/* Derived. */
export const workspace: Readable<Workspace | undefined> = derived(
  [workspaceId, workspaces],
  ([$workspaceId, $workspaces]) => {
    return $workspaces.find(({ id }) => $workspaceId === id);
  },
);

export const parcel: Readable<Parcel | undefined> = derived([workspace, parcels], ([$workspace, $parcels]) => {
  if ($workspace) {
    return $parcels.find(({ id }) => $workspace.parcel_id === id);
  }
});

/** The parcel's adaptation and when it last changed: an adaptation updated in place keeps its id. */
export const parcelSequenceAdaptationVersion = gqlSubscribable<{ id: number; updated_at: string } | null>(
  gql.SUB_SEQUENCE_ADAPTATION_VERSION,
  { id: derived(parcel, $parcel => $parcel?.sequence_adaptation_id ?? -1) },
  null,
  (rows: { id: number; updated_at: string }[]) => rows[0] ?? null,
);
