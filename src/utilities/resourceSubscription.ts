import { createExternalResourceSubscription } from '../stores/externalResource';
import { createProfileSubscription, type ProfileSubscription } from '../stores/profile';
import type { ResourceType, SimulationDataset } from '../types/simulation';
import type { User } from '../types/app';

export type ResourceSubscriptionKind = 'external' | 'internal';

export type ResourceSubscription = ProfileSubscription & {
  kind: ResourceSubscriptionKind;
};

/**
 * A resource is external when the mission model does not declare it — its profile lives in a
 * plan_dataset rather than in the simulation's own output.
 */
export function isExternalResource(name: string, resourceTypes: ResourceType[]): boolean {
  return !resourceTypes.find(type => type.name === name);
}

/**
 * Subscribes to a resource's profile, picking the right factory for internal vs external data.
 *
 * This exists so the id-space distinction below lives in exactly one place. External datasets are
 * matched by the simulation_dataset *id* (what plan_dataset.simulation_dataset_id references),
 * whereas internal profiles are fetched by dataset_id. These are distinct id spaces; passing
 * dataset_id to the external factory makes its sim-tied plan_dataset row preference silently never
 * match.
 *
 * Both underlying factories refcount themselves into the timeline resource registry, so several
 * callers (rows, the time cursor inspector) may subscribe to the same resource without duplicating
 * fetches — as long as each one calls `unsubscribe`.
 */
export function createResourceSubscription(
  name: string,
  simulationDataset: SimulationDataset,
  planStartTimeYmd: string,
  resourceTypes: ResourceType[],
  user: User | null,
): ResourceSubscription {
  if (isExternalResource(name, resourceTypes)) {
    return {
      ...createExternalResourceSubscription(simulationDataset.id, name, planStartTimeYmd, user),
      kind: 'external',
    };
  }

  const simProfileStartYmd = simulationDataset.simulation_start_time ?? planStartTimeYmd;
  return {
    ...createProfileSubscription(simulationDataset.dataset_id, name, simProfileStartYmd, user),
    kind: 'internal',
  };
}

/**
 * The registry key space a subscription for `name` writes to, so callers that read the registry
 * directly can look an entry up without re-deriving the internal/external split.
 */
export function getResourceRegistryDatasetId(
  name: string,
  simulationDataset: SimulationDataset,
  resourceTypes: ResourceType[],
): number {
  return isExternalResource(name, resourceTypes) ? simulationDataset.id : simulationDataset.dataset_id;
}
