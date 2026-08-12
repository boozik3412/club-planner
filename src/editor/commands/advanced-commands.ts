import { getObjectsBounds } from "../geometry/geometry";
import { updateProject } from "../model/project";
import { createStableId } from "../model/templates";
import type {
  CompositeTemplate,
  CompositeTemplateItem,
  ObjectId,
  PlanObject,
  PointM,
  ProjectState,
  SelectionState,
} from "../model/types";

function toTemplateObject(source: PlanObject): CompositeTemplateItem["object"] {
  return {
    type: source.type,
    kind: source.kind,
    name: source.name,
    widthM: source.widthM,
    depthM: source.depthM,
    heightM: source.heightM,
    elevationM: source.elevationM,
    rotationDeg: source.rotationDeg,
    layerId: source.layerId,
    labelVisible: source.labelVisible,
    style: source.style ? structuredClone(source.style) : undefined,
    properties: source.properties ? structuredClone(source.properties) : undefined,
  };
}

export function addDimensionCommand(
  project: ProjectState,
  start: PointM,
  end: PointM,
): ProjectState {
  if (Math.hypot(end.xM - start.xM, end.yM - start.yM) < 0.001) return project;
  return updateProject(project, (draft) => {
    draft.dimensions.push({
      id: createStableId("dimension"),
      name: `Размер ${draft.dimensions.length + 1}`,
      start,
      end,
      labelVisible: true,
    });
  });
}

export function deleteDimensionCommand(project: ProjectState, dimensionId: string): ProjectState {
  if (!project.dimensions.some((dimension) => dimension.id === dimensionId)) return project;
  return updateProject(project, (draft) => {
    draft.dimensions = draft.dimensions.filter((dimension) => dimension.id !== dimensionId);
  });
}

export function createObjectArrayCommand(
  project: ProjectState,
  selection: SelectionState,
  count: number,
  stepM: number,
  direction: "horizontal" | "vertical",
): { project: ProjectState; selection: SelectionState } | null {
  const safeCount = Math.min(100, Math.max(2, Math.floor(count)));
  const safeStepM = Math.max(0.1, stepM);
  const selectedIds = new Set(selection.objectIds);
  const originals = project.objects.filter((object) => selectedIds.has(object.id) && !object.locked);
  if (originals.length === 0) return null;

  const copies: PlanObject[] = [];
  const copiedGroupIds: string[] = [];
  const copiedGroups: ProjectState["groups"] = [];
  for (let index = 1; index < safeCount; index += 1) {
    const idMap = new Map<ObjectId, ObjectId>();
    for (const object of originals) {
      const id = createStableId("object");
      idMap.set(object.id, id);
      copies.push({
        ...structuredClone(object),
        id,
        xM: object.xM + (direction === "horizontal" ? safeStepM * index : 0),
        yM: object.yM + (direction === "vertical" ? safeStepM * index : 0),
      });
    }
    for (const group of project.groups.filter((candidate) =>
      candidate.objectIds.every((objectId) => selectedIds.has(objectId)))) {
      const id = createStableId("group");
      copiedGroupIds.push(id);
      copiedGroups.push({
        ...structuredClone(group),
        id,
        name: `${group.name} · ${index + 1}`,
        objectIds: group.objectIds.map((objectId) => idMap.get(objectId) as ObjectId),
      });
    }
  }

  const next = updateProject(project, (draft) => {
    draft.objects.push(...copies);
    draft.groups.push(...copiedGroups);
  });
  return {
    project: next,
    selection: {
      objectIds: [...originals.map((object) => object.id), ...copies.map((object) => object.id)],
      groupIds: [...selection.groupIds, ...copiedGroupIds],
      groupEditId: null,
    },
  };
}

export function saveCompositeTemplateCommand(
  project: ProjectState,
  objectIds: readonly ObjectId[],
  requestedName: string,
): { project: ProjectState; templateId: string } | null {
  const selected = new Set(objectIds);
  const objects = project.objects.filter((object) => selected.has(object.id));
  const bounds = getObjectsBounds(objects);
  if (!bounds || objects.length === 0) return null;
  const templateId = createStableId("template");
  const template: CompositeTemplate = {
    id: templateId,
    name: requestedName.trim() || `Шаблон ${project.customTemplates.length + 1}`,
    items: objects.map((source) => {
      return {
        offsetXM: source.xM - bounds.centerXM,
        offsetYM: source.yM - bounds.centerYM,
        object: toTemplateObject(source),
      };
    }),
  };
  return {
    templateId,
    project: updateProject(project, (draft) => {
      draft.customTemplates.push(template);
    }),
  };
}

export function instantiateCompositeTemplateCommand(
  project: ProjectState,
  templateId: string,
  centerXM: number,
  centerYM: number,
): { project: ProjectState; selection: SelectionState } | null {
  const template = project.customTemplates.find((candidate) => candidate.id === templateId);
  if (!template) return null;
  const objects = template.items.map((item): PlanObject => ({
    ...structuredClone(item.object),
    id: createStableId("object"),
    xM: centerXM + item.offsetXM,
    yM: centerYM + item.offsetYM,
    locked: false,
  }));
  const groupId = objects.length > 1 ? createStableId("group") : null;
  const next = updateProject(project, (draft) => {
    draft.objects.push(...objects);
    if (groupId) {
      draft.groups.push({
        id: groupId,
        name: template.name,
        objectIds: objects.map((object) => object.id),
        locked: false,
      });
    }
  });
  return {
    project: next,
    selection: {
      objectIds: objects.map((object) => object.id),
      groupIds: groupId ? [groupId] : [],
      groupEditId: null,
    },
  };
}

export function deleteCompositeTemplateCommand(project: ProjectState, templateId: string): ProjectState {
  if (!project.customTemplates.some((template) => template.id === templateId)) return project;
  return updateProject(project, (draft) => {
    draft.customTemplates = draft.customTemplates.filter((template) => template.id !== templateId);
  });
}
