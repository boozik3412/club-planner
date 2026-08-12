import { getObjectsBounds, moveObjects, rotateObjectsAroundCenter } from "../geometry/geometry";
import { normalizeAngle, snapMeters, updateProject } from "../model/project";
import { createObjectFromTemplate, createStableId } from "../model/templates";
import type {
  GroupId,
  LayerId,
  ObjectId,
  ObjectType,
  PlanObject,
  ProjectState,
  SelectionState,
} from "../model/types";

export function replaceObjectsCommand(
  project: ProjectState,
  replacements: readonly PlanObject[],
): ProjectState {
  const replacementMap = new Map(replacements.map((object) => [object.id, object]));
  if (replacementMap.size === 0) return project;
  let changed = false;
  const objects = project.objects.map((object) => {
    const replacement = replacementMap.get(object.id);
    if (!replacement || (
      replacement.id === object.id
      && replacement.type === object.type
      && replacement.name === object.name
      && replacement.xM === object.xM
      && replacement.yM === object.yM
      && replacement.widthM === object.widthM
      && replacement.depthM === object.depthM
      && replacement.heightM === object.heightM
      && replacement.elevationM === object.elevationM
      && replacement.rotationDeg === object.rotationDeg
      && replacement.layerId === object.layerId
      && replacement.locked === object.locked
      && replacement.labelVisible === object.labelVisible
    )) return object;
    changed = true;
    return replacement;
  });
  if (!changed) return project;
  return {
    ...project,
    project: { ...project.project, modifiedAt: new Date().toISOString() },
    objects,
  };
}

export function addObjectCommand(
  project: ProjectState,
  type: ObjectType,
  xM: number,
  yM: number,
): { project: ProjectState; objectId: ObjectId } {
  const snappedX = snapMeters(xM, project.canvas.snapEnabled, project.canvas.snapStepM);
  const snappedY = snapMeters(yM, project.canvas.snapEnabled, project.canvas.snapStepM);
  const object = createObjectFromTemplate(type, snappedX, snappedY);
  if (object.kind === "partition") object.heightM = project.architecture.defaultWallHeightM;
  return {
    objectId: object.id,
    project: updateProject(project, (draft) => {
      draft.objects.push(object);
    }),
  };
}

export function moveObjectsCommand(
  project: ProjectState,
  objectIds: readonly ObjectId[],
  deltaXM: number,
  deltaYM: number,
): ProjectState {
  const selected = new Set(objectIds);
  const objects = project.objects.filter((object) => selected.has(object.id) && !object.locked);
  if (objects.length === 0 || (deltaXM === 0 && deltaYM === 0)) return project;
  return replaceObjectsCommand(project, moveObjects(objects, deltaXM, deltaYM));
}

export function moveObjectsSnappedCommand(
  project: ProjectState,
  objectIds: readonly ObjectId[],
  startObjects: readonly PlanObject[],
  deltaXM: number,
  deltaYM: number,
): ProjectState {
  const selected = new Set(objectIds);
  const movable = startObjects.filter((object) => selected.has(object.id) && !object.locked);
  const bounds = getObjectsBounds(movable);
  if (!bounds) return project;
  const targetX = snapMeters(
    bounds.centerXM + deltaXM,
    project.canvas.snapEnabled,
    project.canvas.snapStepM,
  );
  const targetY = snapMeters(
    bounds.centerYM + deltaYM,
    project.canvas.snapEnabled,
    project.canvas.snapStepM,
  );
  const sharedDeltaXM = targetX - bounds.centerXM;
  const sharedDeltaYM = targetY - bounds.centerYM;
  const replacements = movable.flatMap((object) =>
    sharedDeltaXM === 0 && sharedDeltaYM === 0
      ? []
      : [{ ...object, xM: object.xM + sharedDeltaXM, yM: object.yM + sharedDeltaYM }],
  );
  if (replacements.length === 0) return project;
  return replaceObjectsCommand(project, replacements);
}

export type MassObjectPatch = Partial<
  Pick<
    PlanObject,
    | "name"
    | "xM"
    | "yM"
    | "widthM"
    | "depthM"
    | "heightM"
    | "elevationM"
    | "rotationDeg"
    | "layerId"
    | "locked"
    | "labelVisible"
  >
>;

export function updateObjectsCommand(
  project: ProjectState,
  objectIds: readonly ObjectId[],
  patch: MassObjectPatch,
): ProjectState {
  const selected = new Set(objectIds);
  const safePatch = { ...patch };
  if (safePatch.widthM !== undefined) safePatch.widthM = Math.max(0.1, safePatch.widthM);
  if (safePatch.depthM !== undefined) safePatch.depthM = Math.max(0.1, safePatch.depthM);
  if (safePatch.heightM !== undefined) safePatch.heightM = Math.max(0.1, safePatch.heightM);
  if (safePatch.elevationM !== undefined) safePatch.elevationM = Math.max(0, safePatch.elevationM);
  if (safePatch.rotationDeg !== undefined) safePatch.rotationDeg = normalizeAngle(safePatch.rotationDeg);
  const replacements = project.objects.flatMap((object) => {
      if (!selected.has(object.id)) return [];
      const objectPatch = { ...safePatch };
      if (object.type === "custom-circle") {
        if (objectPatch.widthM !== undefined) {
          objectPatch.depthM = objectPatch.widthM;
        } else if (objectPatch.depthM !== undefined) {
          objectPatch.widthM = objectPatch.depthM;
        }
      }
      const changed = Object.entries(objectPatch).some(([key, value]) =>
        !Object.is(object[key as keyof PlanObject], value),
      );
      return changed ? [{ ...object, ...objectPatch }] : [];
    });
  return replaceObjectsCommand(project, replacements);
}

export function rotateSelectionCommand(
  project: ProjectState,
  selection: SelectionState,
  deltaDeg: number,
): ProjectState {
  const selectedIds = new Set(selection.objectIds);
  const replacements = new Map<ObjectId, PlanObject>();
  const handledIds = new Set<ObjectId>();

  for (const groupId of selection.groupIds) {
    const group = project.groups.find((candidate) => candidate.id === groupId);
    if (!group || group.locked) continue;
    const members = project.objects.filter((object) => group.objectIds.includes(object.id));
    for (const object of rotateObjectsAroundCenter(members, deltaDeg)) {
      replacements.set(object.id, object);
      handledIds.add(object.id);
    }
  }

  for (const object of project.objects) {
    if (selectedIds.has(object.id) && !handledIds.has(object.id) && !object.locked) {
      replacements.set(object.id, {
        ...object,
        rotationDeg: normalizeAngle(object.rotationDeg + deltaDeg),
      });
    }
  }

  if (replacements.size === 0) return project;
  return replaceObjectsCommand(project, [...replacements.values()]);
}

export function groupObjectsCommand(
  project: ProjectState,
  objectIds: readonly ObjectId[],
): { project: ProjectState; groupId: GroupId } | null {
  const uniqueIds = [...new Set(objectIds)].filter((id) =>
    project.objects.some((object) => object.id === id),
  );
  if (uniqueIds.length < 2) return null;
  if (project.groups.some((group) => group.objectIds.some((id) => uniqueIds.includes(id)))) {
    return null;
  }
  const groupId = createStableId("group");
  return {
    groupId,
    project: updateProject(project, (draft) => {
      draft.groups.push({
        id: groupId,
        name: `Группа ${draft.groups.length + 1}`,
        objectIds: uniqueIds,
        locked: false,
      });
    }),
  };
}

export function ungroupObjectsCommand(
  project: ProjectState,
  groupIds: readonly GroupId[],
): ProjectState {
  const selected = new Set(groupIds);
  if (!project.groups.some((group) => selected.has(group.id))) return project;
  return updateProject(project, (draft) => {
    draft.groups = draft.groups.filter((group) => !selected.has(group.id));
  });
}

export function deleteSelectionCommand(
  project: ProjectState,
  selection: SelectionState,
): ProjectState {
  const deletedIds = new Set(selection.objectIds);
  if (deletedIds.size === 0) return project;
  return updateProject(project, (draft) => {
    draft.objects = draft.objects.filter((object) => !deletedIds.has(object.id));
    draft.groups = draft.groups
      .map((group) => ({
        ...group,
        objectIds: group.objectIds.filter((id) => !deletedIds.has(id)),
      }))
      .filter((group) => group.objectIds.length >= 2);
  });
}

export function duplicateSelectionCommand(
  project: ProjectState,
  selection: SelectionState,
  offsetM = 0.35,
): { project: ProjectState; selection: SelectionState } | null {
  const selectedIds = new Set(selection.objectIds);
  const originals = project.objects.filter((object) => selectedIds.has(object.id));
  if (originals.length === 0) return null;

  const idMap = new Map<ObjectId, ObjectId>();
  const copies = originals.map((object) => {
    const id = createStableId("object");
    idMap.set(object.id, id);
    return { ...structuredClone(object), id, xM: object.xM + offsetM, yM: object.yM + offsetM };
  });
  const copiedGroups = project.groups
    .filter((group) => group.objectIds.every((id) => selectedIds.has(id)))
    .map((group) => ({
      ...structuredClone(group),
      id: createStableId("group"),
      name: `${group.name} — копия`,
      objectIds: group.objectIds.map((id) => idMap.get(id) as ObjectId),
    }));

  const nextProject = updateProject(project, (draft) => {
    draft.objects.push(...copies);
    draft.groups.push(...copiedGroups);
  });
  return {
    project: nextProject,
    selection: {
      objectIds: copies.map((object) => object.id),
      groupIds: copiedGroups.map((group) => group.id),
      groupEditId: null,
    },
  };
}

export function setGroupsLockedCommand(
  project: ProjectState,
  groupIds: readonly GroupId[],
  locked: boolean,
): ProjectState {
  const selected = new Set(groupIds);
  return updateProject(project, (draft) => {
    draft.groups = draft.groups.map((group) =>
      selected.has(group.id) ? { ...group, locked } : group,
    );
    const memberIds = new Set(
      draft.groups.filter((group) => selected.has(group.id)).flatMap((group) => group.objectIds),
    );
    draft.objects = draft.objects.map((object) =>
      memberIds.has(object.id) ? { ...object, locked } : object,
    );
  });
}

export function setLayerForObjectsCommand(
  project: ProjectState,
  objectIds: readonly ObjectId[],
  layerId: LayerId,
): ProjectState {
  return updateObjectsCommand(project, objectIds, { layerId });
}

export function rotateGroupToAngleCommand(
  project: ProjectState,
  groupId: GroupId,
  angleDeg: number,
): ProjectState {
  const group = project.groups.find((candidate) => candidate.id === groupId);
  if (!group) return project;
  const objects = project.objects.filter((object) => group.objectIds.includes(object.id));
  const bounds = getObjectsBounds(objects);
  if (!bounds || objects.length === 0) return project;
  const first = objects[0];
  return rotateSelectionCommand(
    project,
    { objectIds: group.objectIds, groupIds: [groupId], groupEditId: null },
    normalizeAngle(angleDeg - first.rotationDeg),
  );
}
