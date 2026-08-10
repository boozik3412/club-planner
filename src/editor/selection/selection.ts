import { getObjectsBounds } from "../geometry/geometry";
import { isObjectEditable } from "../model/project";
import {
  EMPTY_SELECTION,
  type BoundsM,
  type GroupId,
  type ObjectId,
  type PlanObject,
  type ProjectState,
  type SelectionState,
} from "../model/types";

export const MIXED_VALUE = Symbol("mixed-value");

export function getGroupForObject(project: ProjectState, objectId: ObjectId) {
  return project.groups.find((group) => group.objectIds.includes(objectId));
}

export function selectTarget(
  project: ProjectState,
  selection: SelectionState,
  objectId: ObjectId,
  additive: boolean,
): SelectionState {
  const object = project.objects.find((candidate) => candidate.id === objectId);
  const layer = object && project.layers.find((candidate) => candidate.id === object.layerId);
  if (!object || layer?.visible === false) return selection;

  const group = getGroupForObject(project, objectId);
  const groupActsAsUnit = group && selection.groupEditId !== group.id;
  const targetObjectIds = groupActsAsUnit ? group.objectIds : [objectId];
  const targetGroupIds = groupActsAsUnit ? [group.id] : [];

  if (!additive) {
    return {
      objectIds: [...targetObjectIds],
      groupIds: [...targetGroupIds],
      groupEditId: selection.groupEditId,
    };
  }

  const selected = new Set(selection.objectIds);
  const targetAlreadySelected = targetObjectIds.every((id) => selected.has(id));
  for (const id of targetObjectIds) {
    if (targetAlreadySelected) selected.delete(id);
    else selected.add(id);
  }

  const selectedGroups = new Set(selection.groupIds);
  for (const id of targetGroupIds) {
    if (targetAlreadySelected) selectedGroups.delete(id);
    else selectedGroups.add(id);
  }

  return {
    objectIds: [...selected],
    groupIds: [...selectedGroups],
    groupEditId: selection.groupEditId,
  };
}

export function selectAllEditable(project: ProjectState): SelectionState {
  return {
    objectIds: project.objects.filter((object) => isObjectEditable(project, object)).map((object) => object.id),
    groupIds: project.groups
      .filter((group) => group.objectIds.some((id) => project.objects.some((object) => object.id === id && isObjectEditable(project, object))))
      .map((group) => group.id),
    groupEditId: null,
  };
}

export function pruneSelection(
  project: ProjectState,
  selection: SelectionState,
): SelectionState {
  const objectIds = new Set(project.objects.map((object) => object.id));
  const groupIds = new Set(project.groups.map((group) => group.id));
  const groupEditId = selection.groupEditId && groupIds.has(selection.groupEditId)
    ? selection.groupEditId
    : null;
  const retainedObjects = new Set(selection.objectIds.filter((id) => objectIds.has(id)));
  const retainedGroups = new Set(selection.groupIds.filter((id) => groupIds.has(id)));

  // History stores project data, not transient selection. When Undo/Redo restores
  // a group, normalize selected members back to the group's unit semantics.
  for (const group of project.groups) {
    if (group.id === groupEditId) continue;
    if (retainedGroups.has(group.id) || group.objectIds.some((id) => retainedObjects.has(id))) {
      retainedGroups.add(group.id);
      group.objectIds.forEach((id) => retainedObjects.add(id));
    }
  }

  return {
    objectIds: [...retainedObjects],
    groupIds: [...retainedGroups],
    groupEditId,
  };
}

export function getSelectedObjects(
  project: ProjectState,
  selection: SelectionState,
): PlanObject[] {
  const selected = new Set(selection.objectIds);
  return project.objects.filter((object) => selected.has(object.id));
}

export function getSelectionBounds(
  project: ProjectState,
  selection: SelectionState,
): BoundsM | null {
  return getObjectsBounds(getSelectedObjects(project, selection));
}

export function getMixedValue<K extends keyof PlanObject>(
  objects: readonly PlanObject[],
  key: K,
): PlanObject[K] | typeof MIXED_VALUE | undefined {
  if (objects.length === 0) return undefined;
  const first = objects[0][key];
  return objects.every((object) => Object.is(object[key], first)) ? first : MIXED_VALUE;
}

export function clearSelection(groupEditId: GroupId | null = null): SelectionState {
  return { ...EMPTY_SELECTION, groupEditId };
}
