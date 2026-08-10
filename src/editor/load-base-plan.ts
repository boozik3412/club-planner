import basePlanUrl from "../../assets/base_plan_new_measurement.svg?url";

const expectedViewBox = "0 0 23569.5996 2752.6399";

export interface LoadedPlanLabel {
  id: string;
  cx: number;
  cy: number;
  markup: string;
}

export interface LoadedBasePlan {
  source: string;
  defsMarkup: string;
  geometryMarkup: string;
  labels: LoadedPlanLabel[];
}

let basePlanPromise: Promise<LoadedBasePlan> | null = null;

function parseCoordinate(value: string | null, label: string): number {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate)) {
    throw new Error(`у подписи отсутствует координата ${label}`);
  }
  return coordinate;
}

async function fetchAndParseBasePlan(): Promise<LoadedBasePlan> {
  const response = await fetch(basePlanUrl);
  if (!response.ok) {
    throw new Error(`файл SVG недоступен (${response.status})`);
  }

  const source = await response.text();
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    throw new Error("SVG не удалось разобрать");
  }

  const root = document.documentElement;
  if (root.getAttribute("viewBox") !== expectedViewBox) {
    throw new Error("размер SVG не совпадает с актуальным замером");
  }

  const defs = root.querySelector("defs");
  const geometry = root.querySelector("#basePlanGeometry");
  const labelsGroup = root.querySelector("#basePlanLabels");

  if (!defs || !geometry || !labelsGroup) {
    throw new Error("в SVG отсутствуют обязательные слои");
  }

  const labels = Array.from(labelsGroup.children).map((element, index) => ({
    id: `plan-label-${index}`,
    cx: parseCoordinate(element.getAttribute("data-cx"), "X"),
    cy: parseCoordinate(element.getAttribute("data-cy"), "Y"),
    markup: element.innerHTML,
  }));

  return {
    source,
    defsMarkup: defs.innerHTML,
    geometryMarkup: geometry.innerHTML,
    labels,
  };
}

export function loadBasePlan(): Promise<LoadedBasePlan> {
  basePlanPromise ??= fetchAndParseBasePlan();
  return basePlanPromise;
}
