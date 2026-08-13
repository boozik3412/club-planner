import { describe, expect, it } from "vitest";
import { groupObjectsCommand } from "../commands/project-commands";
import { addDimensionCommand, saveCompositeTemplateCommand } from "../commands/advanced-commands";
import { createEmptyProject, updateProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import {
  createRecoveryEnvelope,
  decodeProject,
  decodeRecoveryEnvelope,
  encodeProject,
} from "./serialization";

describe(".clubplan serialization", () => {
  it("round-trips objects and permanent groups", () => {
    const project = updateProject(createEmptyProject("2026-08-10T00:00:00.000Z", "project"), (draft) => {
      draft.objects = [
        createObjectFromTemplate("table", 1, 2, "first"),
        createObjectFromTemplate("pc1", 3, 4, "second"),
      ];
    }, "2026-08-10T00:00:00.000Z");
    const grouped = groupObjectsCommand(project, ["first", "second"]);
    const decoded = decodeProject(encodeProject(grouped?.project as typeof project));
    expect(decoded.legacy).toBe(false);
    expect(decoded.project.objects).toHaveLength(2);
    expect(decoded.project.groups[0].objectIds).toEqual(["first", "second"]);
    expect(encodeProject(grouped?.project as typeof project)).not.toContain("selection");
  });

  it("restores member locks for a locked persisted group", () => {
    const source = JSON.parse(encodeProject(createEmptyProject()));
    source.objects = [
      createObjectFromTemplate("table", 1, 2, "first"),
      createObjectFromTemplate("table", 3, 2, "second"),
    ];
    source.groups = [{ id: "locked", name: "Locked", objectIds: ["first", "second"], locked: true }];
    const decoded = decodeProject(JSON.stringify(source));
    expect(decoded.project.objects.every((object) => object.locked)).toBe(true);
  });

  it("keeps v1 files compatible when new wall snap settings are absent", () => {
    const source = JSON.parse(encodeProject(createEmptyProject()));
    source.formatVersion = 1;
    delete source.architecture;
    delete source.canvas.wallSnapOffsetM;
    delete source.canvas.autoRotateFurnitureToWall;
    delete source.canvas.autoRotatePartitionsToWall;
    delete source.canvas.semanticLayerVisible;
    delete source.canvas.clearanceWarningsVisible;
    delete source.canvas.minimumPassageWidthM;
    delete source.dimensions;
    delete source.customTemplates;
    const legacyV1Object = createObjectFromTemplate("table", 2, 3, "v1-table") as unknown as Record<string, unknown>;
    delete legacyV1Object.heightM;
    delete legacyV1Object.elevationM;
    source.objects = [legacyV1Object];
    const decoded = decodeProject(JSON.stringify(source));
    expect(decoded.warnings).toContain("Проект автоматически обновлён из формата v1 в v3");
    expect(decoded.project.formatVersion).toBe(3);
    expect(decoded.project.canvas).toMatchObject({
      wallSnapOffsetM: 0,
      autoRotateFurnitureToWall: false,
      autoRotatePartitionsToWall: true,
      semanticLayerVisible: true,
      clearanceWarningsVisible: true,
      minimumPassageWidthM: 1,
    });
    expect(decoded.project.dimensions).toEqual([]);
    expect(decoded.project.customTemplates).toEqual([]);
    expect(decoded.project.architecture).toMatchObject({ defaultWallHeightM: 3.04, defaultWallThicknessM: 0.15 });
    expect(decoded.project.objects[0]).toMatchObject({ heightM: 0.75, elevationM: 0 });
  });

  it("round-trips v3 architectural overrides, elevations and reflections", () => {
    const project = createEmptyProject();
    project.architecture.defaultWallHeightM = 3.2;
    project.architecture.wallOverrides["wall-main-top"] = {
      heightM: 2.75,
      thicknessM: 0.2,
      baseElevationM: 0.1,
    };
    project.objects = [{
      ...createObjectFromTemplate("table", 2, 3, "raised-table"),
      elevationM: 0.25,
      flipX: true,
    }];

    const decoded = decodeProject(encodeProject(project));
    expect(decoded.project.architecture).toEqual(project.architecture);
    expect(decoded.project.objects[0]).toMatchObject({ heightM: 0.75, elevationM: 0.25, flipX: true, flipY: false });
  });

  it("keeps v3 architecture in the recovery envelope", () => {
    const project = createEmptyProject();
    project.architecture.defaultWallHeightM = 3.4;
    project.architecture.wallOverrides["wall-main-top"] = { heightM: 2.9 };

    const recovered = decodeRecoveryEnvelope(createRecoveryEnvelope(project, "C:\\plans\\club.clubplan"));

    expect(recovered.sourcePath).toBe("C:\\plans\\club.clubplan");
    expect(recovered.project.architecture).toEqual(project.architecture);
  });

  it("rejects projects from a future format version", () => {
    const source = JSON.parse(encodeProject(createEmptyProject()));
    source.formatVersion = 4;

    expect(() => decodeProject(JSON.stringify(source))).toThrow(/более новой версией/);
  });

  it("round-trips custom shapes and their physical height", () => {
    const project = updateProject(createEmptyProject(), (draft) => {
      draft.objects = [
        { ...createObjectFromTemplate("custom-rectangle", 1, 2, "rectangle"), heightM: 2.4 },
        createObjectFromTemplate("custom-circle", 3, 2, "circle"),
        createObjectFromTemplate("custom-oval", 5, 2, "oval"),
      ];
    });
    const decoded = decodeProject(encodeProject(project));

    expect(decoded.project.objects.map((object) => object.type)).toEqual([
      "custom-rectangle",
      "custom-circle",
      "custom-oval",
    ]);
    expect(decoded.project.objects[0].heightM).toBe(2.4);
  });

  it("round-trips semantic objects, dimensions and composite templates", () => {
    const base = updateProject(createEmptyProject(), (draft) => {
      draft.canvas.minimumPassageWidthM = 1.2;
      draft.objects = [createObjectFromTemplate("door", 2, 3, "door")];
    });
    const withDimension = addDimensionCommand(base, { xM: 1, yM: 1 }, { xM: 4, yM: 1 });
    const withTemplate = saveCompositeTemplateCommand(withDimension, ["door"], "Дверной модуль");
    const decoded = decodeProject(encodeProject(withTemplate?.project as typeof base));

    expect(decoded.project.canvas.minimumPassageWidthM).toBe(1.2);
    expect(decoded.project.objects[0].properties).toMatchObject({ doorSwing: "right", openingAngleDeg: 90 });
    expect(decoded.project.dimensions[0]).toMatchObject({ start: { xM: 1, yM: 1 }, end: { xM: 4, yM: 1 } });
    expect(decoded.project.customTemplates[0]).toMatchObject({ name: "Дверной модуль" });
    expect(decoded.project.customTemplates[0].items[0].object.type).toBe("door");
  });

  it("migrates legacy v6 JSON", () => {
    const decoded = decodeProject(JSON.stringify({
      version: 6,
      canvasAngle: 180,
      objects: [{ id: "o1", type: "table", label: "Стол", x: 1, y: 2, w: 1.2, h: 0.8, angle: -90 }],
    }));
    expect(decoded.legacy).toBe(true);
    expect(decoded.project.canvas.rotationDeg).toBe(180);
    expect(decoded.project.objects[0]).toMatchObject({
      id: "o1",
      xM: 1,
      yM: 2,
      widthM: 1.2,
      rotationDeg: 270,
    });
  });

  it("migrates every legacy v6 object type", () => {
    const legacyTypes = ["pc1", "pc2", "pc5", "table", "sofa", "armchair", "console", "reception", "bar", "server", "partition", "zone"];
    const decoded = decodeProject(JSON.stringify({
      version: 6,
      objects: legacyTypes.map((type, index) => ({ id: `legacy-${index}`, type, x: index, y: 1 })),
    }));
    expect(decoded.project.objects.map((object) => object.type)).toEqual(legacyTypes);
  });

  it("rejects corrupted references without returning a partial project", () => {
    const source = JSON.parse(encodeProject(createEmptyProject()));
    source.groups = [{ id: "bad", name: "Bad", objectIds: ["missing", "also-missing"], locked: false }];
    expect(() => decodeProject(JSON.stringify(source))).toThrow(/отсутствующий предмет/);
  });
});
