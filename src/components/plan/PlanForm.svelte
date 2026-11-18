<svelte:options immutable={true} />

<script lang="ts">
  import { FileUp, Pencil } from 'lucide-svelte';
  import { PlanStatusMessages } from '../../enums/planStatusMessages';
  import { SearchParameters } from '../../enums/searchParameters';
  import { field } from '../../stores/form';
  import {
    planImportRequest,
    planIsLocked,
    planIsNonExecutable,
    planMetadata,
    planReadOnly,
    planReadOnlySnapshot,
  } from '../../stores/plan';
  import {
    initialPlanSnapshotsLoading,
    planSnapshotId,
    planSnapshots,
    planSnapshotsWithSimulations,
  } from '../../stores/planSnapshots';
  import { plans } from '../../stores/plans';
  import { simulationDataset, simulationDatasetId } from '../../stores/simulation';
  import { viewTogglePanel } from '../../stores/views';
  import type { ActivityDirectivesMap } from '../../types/activity';
  import type { User, UserId } from '../../types/app';
  import type { Plan, PlanCollaborator, PlanSlimmer } from '../../types/plan';
  import type { PlanSnapshot as PlanSnapshotType } from '../../types/plan-snapshot';
  import type { PlanTagsInsertInput, Tag, TagsChangeEvent } from '../../types/tags';
  import effects from '../../utilities/effects';
  import { availability, availabilityOf } from '../../utilities/availability';
  import { featurePermissions } from '../../utilities/permissions';
  import { exportPlan } from '../../utilities/plan';
  import { getShortISOForDate } from '../../utilities/time';
  import { tooltip } from '../../utilities/tooltip';
  import { removeQueryParam, setQueryParam } from '../../utilities/url';
  import { required, unique } from '../../utilities/validators';
  import Collapse from '../Collapse.svelte';
  import Field from '../form/Field.svelte';
  import PropertyField from '../form/PropertyField.svelte';
  import AsyncContentState from '../ui/AsyncContentState.svelte';
  import CardList from '../ui/CardList.svelte';
  import FilterToggleButton from '../ui/FilterToggleButton.svelte';
  import ProgressRadial from '../ui/ProgressRadial.svelte';
  import PlanCollaboratorInput from '../ui/Tags/PlanCollaboratorInput.svelte';
  import TagList from '../ui/Tags/TagList.svelte';
  import TagsInput from '../ui/Tags/TagsInput.svelte';
  import AvailabilityButton from '../ui/AvailabilityButton.svelte';
  import RestrictionBanner from '../ui/RestrictionBanner.svelte';
  import PlanSnapshot from './PlanSnapshot.svelte';
  import PlanTimeBounds from './PlanTimeBounds.svelte';

  const planSnapshotsError = planSnapshots.error;

  export let plan: Plan | null;
  export let activityDirectivesMap: ActivityDirectivesMap | null = {};
  export let planTags: Tag[];
  export let tags: Tag[] = [];
  export let user: User | null;
  export let users: UserId[] = [];
  export let usersLoading: boolean = false;
  export let userWriteablePlans: PlanSlimmer[] | null = null;

  let filteredPlanSnapshots: PlanSnapshotType[] = [];
  let isFilteredBySimulation: boolean = false;
  let hasCreateSnapshotPermission: boolean = false;
  let hasPlanUpdatePermission: boolean = false;
  let hasPlanCollaboratorsUpdatePermission: boolean = false;
  let hasChangePlanModelPermission: boolean = false;
  let planNameField = field<string>('', [
    required,
    unique(
      $plans.filter(p => p.id !== plan?.id).map(p => p.name),
      'Plan name already exists',
    ),
  ]);
  let planExporting: boolean = false;

  $: permissionError = $planReadOnly ? PlanStatusMessages.READ_ONLY : 'You do not have permission to edit this plan.';
  $: changeModelAvailability = $planReadOnly
    ? availabilityOf(false, PlanStatusMessages.READ_ONLY)
    : availabilityOf(hasChangePlanModelPermission, "You don't have permission to change mission model");
  $: snapshotAvailability = $planReadOnly
    ? availabilityOf(false, PlanStatusMessages.READ_ONLY)
    : availabilityOf(hasCreateSnapshotPermission, 'You do not have permission to create a plan snapshot');
  $: if (plan && plan.model) {
    hasCreateSnapshotPermission = featurePermissions.planSnapshot.canCreate(user, plan, plan.model) && !$planReadOnly;
  }
  $: {
    if (plan && user) {
      hasPlanUpdatePermission = featurePermissions.plan.canUpdate(user, plan) && !$planIsLocked;
      hasPlanCollaboratorsUpdatePermission =
        featurePermissions.planCollaborators.canCreate(user, plan) && !$planIsLocked;
      hasChangePlanModelPermission = featurePermissions.plan.canUpdateModel(user, plan);
    } else {
      hasPlanUpdatePermission = false;
      hasPlanCollaboratorsUpdatePermission = false;
      hasChangePlanModelPermission = false;
    }
  }

  $: if (isFilteredBySimulation && $simulationDataset != null) {
    filteredPlanSnapshots = $planSnapshotsWithSimulations.filter(
      planSnapshot => planSnapshot.revision === $simulationDataset?.plan_revision,
    );
  } else {
    filteredPlanSnapshots = $planSnapshotsWithSimulations;
  }
  $: if ($plans) {
    planNameField.updateValidators([
      required,
      unique(
        $plans.filter(p => p.id !== plan?.id).map(p => p.name),
        'Plan name already exists',
      ),
    ]);
  }
  $: if (plan) {
    planNameField.validateAndSet(plan?.name ?? '');
  }

  async function onTagsInputChange(event: TagsChangeEvent) {
    const {
      detail: { tag, type },
    } = event;
    if (type === 'remove' && plan) {
      await effects.deletePlanTag(tag.id, plan.id, user);
    } else if (plan && (type === 'create' || type === 'select')) {
      let tagsToAdd: Tag[] = [tag];
      if (type === 'create') {
        tagsToAdd = (await effects.createTags([{ color: tag.color, name: tag.name }], user, false)) || [];
      }
      const newPlanTags: PlanTagsInsertInput[] = tagsToAdd.map(({ id: tag_id }) => ({
        plan_id: plan?.id || -1,
        tag_id,
      }));
      await effects.createPlanTags(newPlanTags, plan, user, true);
    }
  }

  function onPlanCollaboratorsCreate(event: CustomEvent<PlanCollaborator[]>) {
    if (plan) {
      effects.createPlanCollaborators(plan, event.detail, user);
    }
  }

  function onPlanCollaboratorsDelete(event: CustomEvent<string>) {
    if (plan) {
      effects.deletePlanCollaborator(plan, event.detail, user);
    }
  }

  function onCreatePlanSnapshot(event: MouseEvent) {
    event.stopPropagation();
    if (plan) {
      effects.createPlanSnapshot(plan, user);
    }
  }

  function onToggleFilter() {
    isFilteredBySimulation = !isFilteredBySimulation;
  }

  async function openChangePlanMissionModelModal(e: Event) {
    e.stopPropagation();
    if (plan !== null) {
      const success = await effects.updatePlanMissionModel(plan, user);
      if (success) {
        // Clear active simulation
        $simulationDatasetId = -1;
      }
    }
  }

  async function onPlanNameChange() {
    if (plan && $planNameField.dirtyAndValid && $planNameField.value) {
      // Optimistically update plan metadata
      planMetadata.updateValue(pm => (pm ? { ...pm, name: $planNameField.value } : null));
      effects.updatePlan(plan, { name: $planNameField.value }, user);
    }
  }

  async function onExportPlan() {
    if (plan && !planExporting && !$planImportRequest && activityDirectivesMap) {
      planExporting = true;
      await exportPlan(plan, user, Object.values(activityDirectivesMap));
      planExporting = false;
    }
  }
</script>

<div class="plan-form">
  {#if plan}
    <fieldset>
      <Collapse title="Details" contentClass="px-1">
        <svelte:fragment slot="right">
          {#if planExporting}
            <button class="st-button icon progress" on:click|stopPropagation={() => {}}>
              <ProgressRadial strokeWidth={1} />
            </button>
          {:else}
            <span
              use:tooltip={{
                content: $planImportRequest ? 'Import is incomplete – export is unavailable' : 'Export Plan JSON',
              }}
            >
              <button
                class="st-button icon export"
                disabled={!!$planImportRequest}
                on:click|stopPropagation={onExportPlan}
              >
                <FileUp size={16} />
              </button>
            </span>
          {/if}
        </svelte:fragment>
        {#if !hasPlanUpdatePermission}
          <RestrictionBanner reason={permissionError} />
        {/if}
        <div class="plan-form-field">
          <Field field={planNameField} on:change={onPlanNameChange}>
            <PropertyField
              editable={hasPlanUpdatePermission}
              id="plan-name"
              label="Plan Name"
              name="planName"
              value={plan.name}
            >
              <input
                autocomplete="off"
                class="st-input w-full"
                name="plan-name"
                placeholder="Enter a plan name"
                id="plan-name"
              />
            </PropertyField>
          </Field>
        </div>
        <PropertyField label="Plan ID" name="planId" value={plan.id} />
        {#if $planIsNonExecutable}
          <PropertyField label="Model" name="modelName" value="Model-free plan" />
        {:else}
          <PropertyField label="Model" name="modelName" value={plan.model?.name ?? 'Model not found'}>
            <AvailabilityButton
              slot="action"
              availability={changeModelAvailability}
              label="Change mission model"
              size="icon-sm"
              variant="ghost"
              on:click={openChangePlanMissionModelModal}
            >
              <Pencil size={14} />
            </AvailabilityButton>
          </PropertyField>
          <PropertyField label="Model ID" name="modelId" value={plan.model_id} />
          <PropertyField label="Model version" name="modelVersion" value={plan.model?.version ?? 'Model not found'} />
        {/if}
        <PlanTimeBounds
          {plan}
          {user}
          isReadOnly={$planReadOnly}
          hasUpdatePermission={hasPlanUpdatePermission}
          {permissionError}
        />
        <PropertyField label="Owner" name="owner" value={plan.owner} />
        <PropertyField label="Created" name="createdAt" value={getShortISOForDate(new Date(plan.created_at))} />
        <PropertyField label="Updated" name="updatedAt" value={getShortISOForDate(new Date(plan.updated_at))} />
        <PropertyField label="Updated by" name="updatedBy" value={plan.updated_by} />
        <PropertyField label="Revision" name="revision" value={plan.revision} />
        <PropertyField
          editable={hasPlanCollaboratorsUpdatePermission && !usersLoading && userWriteablePlans !== null}
          label="Collaborators"
          name="collaborators"
          value={usersLoading || userWriteablePlans === null
            ? 'Loading…'
            : plan.collaborators.map(({ collaborator }) => collaborator).join(', ')}
        >
          <PlanCollaboratorInput
            name="collaborators"
            collaborators={plan.collaborators}
            {users}
            plans={userWriteablePlans ?? []}
            {plan}
            {user}
            on:create={onPlanCollaboratorsCreate}
            on:delete={onPlanCollaboratorsDelete}
          />
        </PropertyField>
        <PropertyField editable={hasPlanUpdatePermission} label="Tags" name="tags" value={null}>
          <TagsInput options={tags} selected={planTags} on:change={onTagsInputChange} />
          <TagList slot="read" tags={planTags} />
        </PropertyField>
      </Collapse>
    </fieldset>
    <fieldset>
      <Collapse title="Snapshots" padContent={false}>
        <div class="buttons" slot="right">
          {#if $simulationDatasetId >= 0}
            <FilterToggleButton
              label="Snapshot"
              offTooltipContent="Filter snapshots by selected simulation"
              onTooltipContent="Remove filter"
              isOn={isFilteredBySimulation}
              on:toggle={onToggleFilter}
            />
          {/if}
          <button
            class="st-button secondary"
            disabled={$initialPlanSnapshotsLoading}
            use:availability={snapshotAvailability}
            on:click={onCreatePlanSnapshot}
          >
            Take Snapshot
          </button>
        </div>
        <div style="margin-top: 8px">
          <AsyncContentState
            loading={$initialPlanSnapshotsLoading}
            error={$planSnapshotsError || null}
            errorMessage="Failed to load plan snapshots"
            showRetry
            empty={!filteredPlanSnapshots.length}
            emptyMessage="No Plan Snapshots Found"
            on:retry={() => planSnapshots.restartSocket()}
          >
            <CardList>
              {#each filteredPlanSnapshots as planSnapshot (planSnapshot.snapshot_id)}
                <PlanSnapshot
                  activePlanSnapshotId={$planSnapshotId}
                  planModelId={plan.model?.id}
                  {planSnapshot}
                  on:click={() => {
                    setQueryParam(SearchParameters.SNAPSHOT_ID, `${planSnapshot.snapshot_id}`, 'PUSH');
                    $planSnapshotId = planSnapshot.snapshot_id;
                    $planReadOnlySnapshot = true;

                    if (planSnapshot.simulation?.id != null) {
                      setQueryParam(SearchParameters.SIMULATION_DATASET_ID, `${planSnapshot.simulation?.id}`, 'PUSH');
                      $simulationDatasetId = planSnapshot.simulation?.id;

                      viewTogglePanel({ state: true, type: 'left', update: { leftComponentTop: 'SimulationPanel' } });
                    } else {
                      removeQueryParam(SearchParameters.SIMULATION_DATASET_ID);
                      $simulationDatasetId = -1;
                    }
                  }}
                  on:restore={() => plan && effects.restorePlanSnapshot(planSnapshot, plan, user)}
                  on:delete={() => effects.deletePlanSnapshot(planSnapshot, user)}
                />
              {/each}
            </CardList>
          </AsyncContentState>
        </div>
      </Collapse>
    </fieldset>
  {/if}
</div>

<style>
  .plan-form fieldset:last-child {
    padding-bottom: 16px;
  }

  .buttons {
    column-gap: 4px;
    display: flex;
  }

  .plan-form-field :global(fieldset) {
    padding: 0;
  }

  .plan-form-field :global(fieldset .error *) {
    padding-left: calc(100px + 8px);
  }

  .export {
    border-radius: 50%;
    height: 28px;
    position: relative;
    width: 28px;
  }

  .progress {
    border: 0;
    border-radius: 50%;
    width: 28px;
    --progress-radial-background: var(--st-gray-20);
  }
  .progress:hover {
    background: none;
  }
</style>
