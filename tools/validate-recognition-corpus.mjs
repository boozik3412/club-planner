import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout } from "node:process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "tests/fixtures/recognition/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.format !== "club-planner-recognition-corpus" || ![1, 2].includes(manifest.version)) {
  throw new Error("Неподдерживаемая версия manifest корпуса распознавания");
}
const ids = new Set();
const counts = { vector: 0, scan: 0, photo: 0 };
for (const fixture of manifest.cases) {
  if (ids.has(fixture.id)) throw new Error(`Повторяющийся fixture id: ${fixture.id}`);
  ids.add(fixture.id);
  if (!(fixture.category in counts)) throw new Error(`Неизвестная категория: ${fixture.category}`);
  if (!fixture.license?.includes("self-generated")) throw new Error(`Нет разрешённой лицензии: ${fixture.id}`);
  if (!fixture.groundTruth?.walls?.length || !(fixture.groundTruth.calibration?.knownDistanceM > 0)) {
    throw new Error(`Нет ground truth или калибровки: ${fixture.id}`);
  }
  if (manifest.version >= 2 && fixture.category === "photo"
    && (!Array.isArray(fixture.groundTruth.sourceQuad) || fixture.groundTruth.sourceQuad.length !== 4)) {
    throw new Error(`Нет четырёхточечной photo-калибровки: ${fixture.id}`);
  }
  for (const opening of fixture.groundTruth.openings ?? []) {
    const host = fixture.groundTruth.walls[opening.hostWallIndex];
    if (!host || host.kind !== "line") throw new Error(`Некорректный host проёма: ${fixture.id}`);
  }
  const bytes = await readFile(resolve(root, fixture.path));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== fixture.sha256) throw new Error(`SHA-256 не совпал: ${fixture.id}`);
  counts[fixture.category] += 1;
}
for (const [category, count] of Object.entries(counts)) {
  if (count < 10) throw new Error(`Недостаточно фикстур ${category}: ${count}`);
}
for (const fixture of manifest.manualFixtures ?? []) await readFile(resolve(root, fixture.path));
stdout.write(`Recognition corpus OK: ${manifest.cases.length} cases (${counts.vector}/${counts.scan}/${counts.photo})\n`);
