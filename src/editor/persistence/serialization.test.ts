import { describe, expect, it } from "vitest";
import { groupObjectsCommand } from "../commands/project-commands";
import { createEmptyProject, updateProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { decodeProject, encodeProject } from "./serialization";

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
