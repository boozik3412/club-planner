import { createEmptyProject, normalizeAngle } from "../model/project";
import { getObjectTemplate, OBJECT_TYPE_SET, createStableId } from "../model/templates";
import type {
  CompositeTemplate,
  CompositeTemplateItem,
  Layer,
  ObjectGroup,
  ObjectType,
  PlanObject,
  ProjectDimension,
  ProjectState,
  WallArchitectureOverride,
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

export interface DecodeResult {
  project: ProjectState;
  legacy: boolean;
  warnings: string[];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: ожидался объект`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: ожидался массив`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}: ожидалась непустая строка`);
  }
  return value;
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}: ожидалось конечное число`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}: ожидалось логическое значение`);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseObject(
  value: unknown,
  index: number,
  layerIds: Set<string>,
  objectIds: Set<string>,
  warnings: string[],
): PlanObject {
  const record = asRecord(value, `objects[${index}]`);
  const id = asString(record.id, `objects[${index}].id`);
  if (objectIds.has(id)) throw new Error(`Повторяющийся ID предмета: ${id}`);
  objectIds.add(id);
  const typeValue = asString(record.type, `objects[${index}].type`);
  if (!OBJECT_TYPE_SET.has(typeValue as ObjectType)) {
    throw new Error(`objects[${index}].type: неизвестный тип ${typeValue}`);
  }
  const type = typeValue as ObjectType;
  const template = getObjectTemplate(type);
  const layerId = asString(record.layerId, `objects[${index}].layerId`);
  if (!layerIds.has(layerId)) throw new Error(`Предмет ${id} ссылается на неизвестный слой ${layerId}`);
  const style = record.style === undefined ? undefined : asRecord(record.style, `objects[${index}].style`);
  const properties = record.properties === undefined
    ? undefined
    : asRecord(record.properties, `objects[${index}].properties`);
  const widthM = asFiniteNumber(record.widthM, `objects[${index}].widthM`);
  let depthM = asFiniteNumber(record.depthM, `objects[${index}].depthM`);
  const heightM = record.heightM === undefined
    ? template.heightM
    : asFiniteNumber(record.heightM, `objects[${index}].heightM`);
  const elevationM = record.elevationM === undefined
    ? template.elevationM ?? 0
    : asFiniteNumber(record.elevationM, `objects[${index}].elevationM`);
  if (widthM < 0.1 || depthM < 0.1 || heightM < 0.1 || elevationM < 0) {
    throw new Error(`Предмет ${id} имеет размер меньше 0,1 м`);
  }
  if (type === "custom-circle" && depthM !== widthM) {
    depthM = widthM;
    warnings.push(`Диаметр круга ${id} нормализован по ширине`);
  }
  const rawAngle = asFiniteNumber(record.rotationDeg, `objects[${index}].rotationDeg`);
  const normalizedAngle = normalizeAngle(rawAngle);
  if (normalizedAngle !== rawAngle) warnings.push(`Угол предмета ${id} нормализован`);
  const parsedProperties: NonNullable<PlanObject["properties"]> = {};
  if (properties && typeof properties.seats === "number" && Number.isFinite(properties.seats)) {
    parsedProperties.seats = properties.seats;
  }
  if (properties?.doorSwing === "left" || properties?.doorSwing === "right") {
    parsedProperties.doorSwing = properties.doorSwing;
  }
  if (properties && typeof properties.openingAngleDeg === "number" && Number.isFinite(properties.openingAngleDeg)) {
    parsedProperties.openingAngleDeg = Math.min(180, Math.max(0, properties.openingAngleDeg));
  }
  if (type === "door") {
    parsedProperties.doorSwing ??= "right";
    parsedProperties.openingAngleDeg ??= 90;
  }
  return {
    id,
    type,
    kind: template.kind,
    name: asString(record.name, `objects[${index}].name`),
    xM: asFiniteNumber(record.xM, `objects[${index}].xM`),
    yM: asFiniteNumber(record.yM, `objects[${index}].yM`),
    widthM,
    depthM,
    heightM,
    elevationM,
    rotationDeg: normalizedAngle,
    layerId,
    locked: asBoolean(record.locked, `objects[${index}].locked`),
    labelVisible: asBoolean(record.labelVisible, `objects[${index}].labelVisible`),
    style: style && typeof style.fill === "string" ? { fill: style.fill } : { fill: template.fill },
    properties: Object.keys(parsedProperties).length > 0
      ? parsedProperties
      : template.seats
        ? { seats: template.seats }
        : undefined,
  };
}

function parseClubplan(root: Record<string, unknown>): DecodeResult {
  if (root.format !== "clubplan") throw new Error("Файл не является проектом Club Planner");
  const version = asFiniteNumber(root.formatVersion, "formatVersion");
  if (version > 2) throw new Error(`Файл создан более новой версией Club Planner (${version})`);
  if (version !== 1 && version !== 2) throw new Error(`Неподдерживаемая версия формата: ${version}`);

  const warnings: string[] = [];
  if (version === 1) warnings.push("Проект автоматически обновлён из формата v1 в v2");
  const next = createEmptyProject();
  const projectMeta = asRecord(root.project, "project");
  next.project = {
    id: asString(projectMeta.id, "project.id"),
    createdAt: asString(projectMeta.createdAt, "project.createdAt"),
    modifiedAt: asString(projectMeta.modifiedAt, "project.modifiedAt"),
  };
  const canvas = asRecord(root.canvas, "canvas");
  next.canvas = {
    rotationDeg: normalizeAngle(asFiniteNumber(canvas.rotationDeg, "canvas.rotationDeg")),
    gridVisible: asBoolean(canvas.gridVisible, "canvas.gridVisible"),
    gridStepM: Math.max(0.01, asFiniteNumber(canvas.gridStepM, "canvas.gridStepM")),
    snapEnabled: asBoolean(canvas.snapEnabled, "canvas.snapEnabled"),
    snapStepM: Math.max(0.001, asFiniteNumber(canvas.snapStepM, "canvas.snapStepM")),
    wallSnapOffsetM: canvas.wallSnapOffsetM === undefined
      ? next.canvas.wallSnapOffsetM
      : Math.max(0, asFiniteNumber(canvas.wallSnapOffsetM, "canvas.wallSnapOffsetM")),
    autoRotateFurnitureToWall: optionalBoolean(
      canvas.autoRotateFurnitureToWall,
      next.canvas.autoRotateFurnitureToWall,
    ),
    autoRotatePartitionsToWall: optionalBoolean(
      canvas.autoRotatePartitionsToWall,
      next.canvas.autoRotatePartitionsToWall,
    ),
    semanticLayerVisible: optionalBoolean(
      canvas.semanticLayerVisible,
      next.canvas.semanticLayerVisible,
    ),
    clearanceWarningsVisible: optionalBoolean(
      canvas.clearanceWarningsVisible,
      next.canvas.clearanceWarningsVisible,
    ),
    minimumPassageWidthM: canvas.minimumPassageWidthM === undefined
      ? next.canvas.minimumPassageWidthM
      : Math.max(0, asFiniteNumber(canvas.minimumPassageWidthM, "canvas.minimumPassageWidthM")),
    basePlanVisible: asBoolean(canvas.basePlanVisible, "canvas.basePlanVisible"),
    planLabelsVisible: asBoolean(canvas.planLabelsVisible, "canvas.planLabelsVisible"),
    objectLabelsVisible: asBoolean(canvas.objectLabelsVisible, "canvas.objectLabelsVisible"),
    basePlanOpacity: Math.min(1, Math.max(0, asFiniteNumber(canvas.basePlanOpacity, "canvas.basePlanOpacity"))),
  };

  if (version === 2) {
    const architecture = asRecord(root.architecture, "architecture");
    const wallOverridesRecord = architecture.wallOverrides === undefined
      ? {}
      : asRecord(architecture.wallOverrides, "architecture.wallOverrides");
    const wallOverrides: Record<string, WallArchitectureOverride> = {};
    for (const [wallId, value] of Object.entries(wallOverridesRecord)) {
      const record = asRecord(value, `architecture.wallOverrides.${wallId}`);
      const override: WallArchitectureOverride = {};
      if (record.heightM !== undefined) {
        override.heightM = Math.max(0.1, asFiniteNumber(record.heightM, `architecture.wallOverrides.${wallId}.heightM`));
      }
      if (record.thicknessM !== undefined) {
        override.thicknessM = Math.max(0.01, asFiniteNumber(record.thicknessM, `architecture.wallOverrides.${wallId}.thicknessM`));
      }
      if (record.baseElevationM !== undefined) {
        override.baseElevationM = Math.max(0, asFiniteNumber(record.baseElevationM, `architecture.wallOverrides.${wallId}.baseElevationM`));
      }
      wallOverrides[wallId] = override;
    }
    next.architecture = {
      defaultWallHeightM: Math.max(0.1, asFiniteNumber(architecture.defaultWallHeightM, "architecture.defaultWallHeightM")),
      defaultWallThicknessM: Math.max(0.01, asFiniteNumber(architecture.defaultWallThicknessM, "architecture.defaultWallThicknessM")),
      wallOverrides,
    };
  }

  const layerIds = new Set<string>();
  next.layers = asArray(root.layers, "layers").map((value, index): Layer => {
    const layer = asRecord(value, `layers[${index}]`);
    const id = asString(layer.id, `layers[${index}].id`);
    if (layerIds.has(id)) throw new Error(`Повторяющийся ID слоя: ${id}`);
    layerIds.add(id);
    return {
      id,
      name: asString(layer.name, `layers[${index}].name`),
      visible: asBoolean(layer.visible, `layers[${index}].visible`),
      locked: asBoolean(layer.locked, `layers[${index}].locked`),
    };
  });
  if (next.layers.length === 0) throw new Error("В проекте нет слоёв");

  const objectIds = new Set<string>();
  next.objects = asArray(root.objects, "objects").map((value, index) =>
    parseObject(value, index, layerIds, objectIds, warnings),
  );
  const groupedObjects = new Set<string>();
  const groupIds = new Set<string>();
  next.groups = asArray(root.groups, "groups").map((value, index): ObjectGroup => {
    const group = asRecord(value, `groups[${index}]`);
    const id = asString(group.id, `groups[${index}].id`);
    if (groupIds.has(id)) throw new Error(`Повторяющийся ID группы: ${id}`);
    groupIds.add(id);
    const memberIds = asArray(group.objectIds, `groups[${index}].objectIds`).map((member, memberIndex) =>
      asString(member, `groups[${index}].objectIds[${memberIndex}]`),
    );
    if (memberIds.length < 2) throw new Error(`Группа ${id} содержит меньше двух предметов`);
    for (const objectId of memberIds) {
      if (!objectIds.has(objectId)) throw new Error(`Группа ${id} ссылается на отсутствующий предмет ${objectId}`);
      if (groupedObjects.has(objectId)) throw new Error(`Предмет ${objectId} входит более чем в одну группу`);
      groupedObjects.add(objectId);
    }
    return {
      id,
      name: asString(group.name, `groups[${index}].name`),
      objectIds: memberIds,
      locked: asBoolean(group.locked, `groups[${index}].locked`),
    };
  });

  const lockedGroupObjectIds = new Set(
    next.groups.filter((group) => group.locked).flatMap((group) => group.objectIds),
  );
  next.objects = next.objects.map((object) => lockedGroupObjectIds.has(object.id)
    ? { ...object, locked: true }
    : object);

  const dimensionIds = new Set<string>();
  next.dimensions = root.dimensions === undefined
    ? []
    : asArray(root.dimensions, "dimensions").map((value, index): ProjectDimension => {
        const dimension = asRecord(value, `dimensions[${index}]`);
        const id = asString(dimension.id, `dimensions[${index}].id`);
        if (dimensionIds.has(id)) throw new Error(`Повторяющийся ID размера: ${id}`);
        dimensionIds.add(id);
        const start = asRecord(dimension.start, `dimensions[${index}].start`);
        const end = asRecord(dimension.end, `dimensions[${index}].end`);
        return {
          id,
          name: asString(dimension.name, `dimensions[${index}].name`),
          start: {
            xM: asFiniteNumber(start.xM, `dimensions[${index}].start.xM`),
            yM: asFiniteNumber(start.yM, `dimensions[${index}].start.yM`),
          },
          end: {
            xM: asFiniteNumber(end.xM, `dimensions[${index}].end.xM`),
            yM: asFiniteNumber(end.yM, `dimensions[${index}].end.yM`),
          },
          labelVisible: optionalBoolean(dimension.labelVisible, true),
        };
      });

  const templateIds = new Set<string>();
  next.customTemplates = root.customTemplates === undefined
    ? []
    : asArray(root.customTemplates, "customTemplates").map((value, index): CompositeTemplate => {
        const template = asRecord(value, `customTemplates[${index}]`);
        const id = asString(template.id, `customTemplates[${index}].id`);
        if (templateIds.has(id)) throw new Error(`Повторяющийся ID шаблона: ${id}`);
        templateIds.add(id);
        const localObjectIds = new Set<string>();
        const items = asArray(template.items, `customTemplates[${index}].items`).map((itemValue, itemIndex) => {
          const item = asRecord(itemValue, `customTemplates[${index}].items[${itemIndex}]`);
          const storedObject = asRecord(item.object, `customTemplates[${index}].items[${itemIndex}].object`);
          const parsed = parseObject({
            ...storedObject,
            id: `template-${index}-${itemIndex}`,
            xM: 0,
            yM: 0,
            locked: false,
          }, itemIndex, layerIds, localObjectIds, warnings);
          return {
            offsetXM: asFiniteNumber(item.offsetXM, `customTemplates[${index}].items[${itemIndex}].offsetXM`),
            offsetYM: asFiniteNumber(item.offsetYM, `customTemplates[${index}].items[${itemIndex}].offsetYM`),
            object: toTemplateObject(parsed),
          };
        });
        if (items.length === 0) throw new Error(`Шаблон ${id} не содержит предметов`);
        return { id, name: asString(template.name, `customTemplates[${index}].name`), items };
      });

  if (root.basePlan && asRecord(root.basePlan, "basePlan").sha256 !== next.basePlan.sha256) {
    warnings.push("Ссылка на базовый план обновлена до актуального замера");
  }
  return { project: next, legacy: false, warnings };
}

function parseLegacy(root: Record<string, unknown>): DecodeResult {
  const legacyObjects = asArray(root.objects, "objects");
  const project = createEmptyProject();
  const warnings = ["Импортирован legacy JSON v6; группы и слои в исходном файле отсутствовали"];
  const usedIds = new Set<string>();
  project.canvas.rotationDeg = normalizeAngle(
    typeof root.canvasAngle === "number" && Number.isFinite(root.canvasAngle) ? root.canvasAngle : 0,
  );
  project.objects = legacyObjects.map((value, index) => {
    const record = asRecord(value, `objects[${index}]`);
    const rawType = typeof record.type === "string" ? record.type : "zone";
    const type = OBJECT_TYPE_SET.has(rawType as ObjectType) ? (rawType as ObjectType) : "zone";
    if (type !== rawType) warnings.push(`Тип ${rawType} заменён на «Свободная зона»`);
    const template = getObjectTemplate(type);
    let id = typeof record.id === "string" && record.id ? record.id : createStableId("legacy-object");
    if (usedIds.has(id)) {
      id = createStableId("legacy-object");
      warnings.push(`Повторяющийся legacy ID заменён: objects[${index}]`);
    }
    usedIds.add(id);
    const numberOr = (candidate: unknown, fallback: number) =>
      typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
    return {
      id,
      type,
      kind: template.kind,
      name: typeof record.label === "string" && record.label.trim() ? record.label : template.label,
      xM: numberOr(record.x, 0),
      yM: numberOr(record.y, 0),
      widthM: Math.max(0.1, numberOr(record.w, template.widthM)),
      depthM: Math.max(0.1, numberOr(record.h, template.depthM)),
      heightM: template.heightM,
      elevationM: template.elevationM ?? 0,
      rotationDeg: normalizeAngle(numberOr(record.angle, 0)),
      layerId: template.layerId,
      locked: false,
      labelVisible: true,
      style: { fill: typeof record.fill === "string" ? record.fill : template.fill },
      properties: {
        seats: numberOr(record.seats, template.seats ?? 0),
      },
    } satisfies PlanObject;
  });
  project.project.modifiedAt = new Date().toISOString();
  return { project, legacy: true, warnings };
}

export function decodeProject(source: string): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Файл содержит некорректный JSON");
  }
  const root = asRecord(parsed, "project file");
  if (root.format === "clubplan") return parseClubplan(root);
  if (Array.isArray(root.objects) && (root.version === 6 || root.format === undefined)) {
    return parseLegacy(root);
  }
  throw new Error("Неизвестный формат проекта");
}

export function encodeProject(project: ProjectState): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function createRecoveryEnvelope(project: ProjectState, sourcePath: string | null): string {
  return JSON.stringify({ savedAt: new Date().toISOString(), sourcePath, project });
}

export function decodeRecoveryEnvelope(source: string): { project: ProjectState; sourcePath: string | null } {
  const record = asRecord(JSON.parse(source), "recovery");
  const result = parseClubplan(asRecord(record.project, "recovery.project"));
  return {
    project: result.project,
    sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : null,
  };
}

export function normalizeOptionalBoolean(value: unknown, fallback: boolean): boolean {
  return optionalBoolean(value, fallback);
}
