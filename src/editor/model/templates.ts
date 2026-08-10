import type { LayerId, ObjectKind, ObjectType, PlanObject } from "./types";

export interface ObjectTemplate {
  type: ObjectType;
  label: string;
  shortLabel: string;
  kind: ObjectKind;
  widthM: number;
  depthM: number;
  heightM?: number;
  layerId: LayerId;
  fill: string;
  seats?: number;
}

export const OBJECT_TEMPLATES: readonly ObjectTemplate[] = [
  { type: "pc1", label: "ПК · 1 место", shortLabel: "ПК — 1 место", kind: "pc", widthM: 1.3, depthM: 0.8, layerId: "equipment", fill: "#d5ecff", seats: 1 },
  { type: "pc2", label: "ПК · 2 места", shortLabel: "ПК — 2 места", kind: "pc", widthM: 2.6, depthM: 0.8, layerId: "equipment", fill: "#cfe8ff", seats: 2 },
  { type: "pc5", label: "Линия · 5 ПК", shortLabel: "Линия — 5 ПК", kind: "pc", widthM: 6.5, depthM: 0.8, layerId: "equipment", fill: "#c7e4fb", seats: 5 },
  { type: "computer", label: "Компьютер / монитор", shortLabel: "Компьютер", kind: "computer", widthM: 0.55, depthM: 0.35, layerId: "equipment", fill: "#c4d9e8" },
  { type: "gaming-chair", label: "Игровое кресло", shortLabel: "Игровое кресло", kind: "gaming-chair", widthM: 0.7, depthM: 0.7, layerId: "furniture", fill: "#d9d4e8" },
  { type: "table", label: "Стол", shortLabel: "Стол", kind: "table", widthM: 1.4, depthM: 0.8, layerId: "furniture", fill: "#e5d2b5" },
  { type: "sofa", label: "Диван", shortLabel: "Диван", kind: "sofa", widthM: 2.2, depthM: 0.9, layerId: "furniture", fill: "#e8dfd0" },
  { type: "armchair", label: "Кресло", shortLabel: "Кресло", kind: "armchair", widthM: 0.9, depthM: 0.9, layerId: "furniture", fill: "#eadfd3" },
  { type: "console", label: "Консольная зона", shortLabel: "Консольная зона", kind: "console", widthM: 2.6, depthM: 1.8, layerId: "equipment", fill: "#ded9f2" },
  { type: "reception", label: "Ресепшн", shortLabel: "Ресепшн", kind: "reception", widthM: 2.4, depthM: 0.85, layerId: "furniture", fill: "#d4e9df" },
  { type: "bar", label: "Бар", shortLabel: "Бар", kind: "bar", widthM: 3, depthM: 0.85, layerId: "furniture", fill: "#e7d7be" },
  { type: "server", label: "Серверная стойка", shortLabel: "Серверная стойка", kind: "server", widthM: 0.8, depthM: 1, layerId: "equipment", fill: "#d9dde3" },
  { type: "partition", label: "Перегородка", shortLabel: "Перегородка", kind: "partition", widthM: 3, depthM: 0.12, layerId: "furniture", fill: "#9ca8b3" },
  { type: "zone", label: "Свободная зона", shortLabel: "Свободная зона", kind: "zone", widthM: 3, depthM: 2.5, layerId: "zones", fill: "#dff3e7" },
  { type: "custom-rectangle", label: "Произвольный прямоугольник", shortLabel: "Прямоугольник", kind: "custom-rectangle", widthM: 1.5, depthM: 1, heightM: 1, layerId: "furniture", fill: "#f2d6a2" },
  { type: "custom-circle", label: "Произвольный круг", shortLabel: "Круг", kind: "custom-circle", widthM: 1.2, depthM: 1.2, heightM: 1, layerId: "furniture", fill: "#c9e5f5" },
  { type: "custom-oval", label: "Произвольный овал", shortLabel: "Овал", kind: "custom-oval", widthM: 1.8, depthM: 1.1, heightM: 1, layerId: "furniture", fill: "#d9d2f2" },
] as const;

export const OBJECT_TYPE_SET = new Set<ObjectType>(
  OBJECT_TEMPLATES.map((template) => template.type),
);

export function getObjectTemplate(type: ObjectType): ObjectTemplate {
  const template = OBJECT_TEMPLATES.find((candidate) => candidate.type === type);
  if (!template) throw new Error(`Неизвестный тип предмета: ${type}`);
  return template;
}

export function createObjectFromTemplate(
  type: ObjectType,
  xM: number,
  yM: number,
  id = createStableId("object"),
): PlanObject {
  const template = getObjectTemplate(type);
  return {
    id,
    type,
    kind: template.kind,
    name: template.label,
    xM,
    yM,
    widthM: template.widthM,
    depthM: template.depthM,
    heightM: template.heightM,
    rotationDeg: 0,
    layerId: template.layerId,
    locked: false,
    labelVisible: true,
    style: { fill: template.fill },
    properties: template.seats ? { seats: template.seats } : undefined,
  };
}

export function createStableId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
