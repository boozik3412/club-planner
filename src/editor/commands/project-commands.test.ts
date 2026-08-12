import { describe, expect, it } from "vitest";
import { createEmptyProject, updateProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { EMPTY_SELECTION } from "../model/types";
import {
  addObjectCommand,
  copySelectionToClipboard,
  deleteSelectionCommand,
  duplicateSelectionCommand,
  groupObjectsCommand,
  moveObjectsCommand,
  moveObjectsSnappedCommand,
  pasteObjectClipboardCommand,
  rotateSelectionCommand,
  setGroupsLockedCommand,
  ungroupObjectsCommand,
  updateObjectsCommand,
} from "./project-commands";

function projectWithTwoTables() {
  return updateProject(createEmptyProject(), (draft) => {
    draft.objects = [
      createObjectFromTemplate("table", 1, 1, "first"),
      { ...createObjectFromTemplate("table", 3, 1, "second"), widthM: 1.2 },
    ];
  });
}

describe("project commands", () => {
  it("creates a full-height partition from the project architectural default", () => {
    const project = createEmptyProject();
    project.architecture.defaultWallHeightM = 2.65;
    const result = addObjectCommand(project, "partition", 2, 3);
    expect(result.project.objects[0]).toMatchObject({ heightM: 2.65, elevationM: 0 });
  });

  it("moves a selection by one shared vector", () => {
    const moved = moveObjectsCommand(projectWithTwoTables(), ["first", "second"], 0.5, -0.25);
    expect(moved.objects.map(({ xM, yM }) => [xM, yM])).toEqual([
      [1.5, 0.75],
      [3.5, 0.75],
    ]);
  });

  it("sets the requested width on every selected object", () => {
    const updated = updateObjectsCommand(projectWithTwoTables(), ["first", "second"], { widthM: 1.3 });
    expect(updated.objects.map((object) => object.widthM)).toEqual([1.3, 1.3]);
    expect(updated.objects.map((object) => object.xM)).toEqual([1, 3]);
  });

  it("edits all three dimensions and keeps a custom circle round", () => {
    const project = updateProject(createEmptyProject(), (draft) => {
      draft.objects = [
        createObjectFromTemplate("custom-rectangle", 1, 1, "rectangle"),
        createObjectFromTemplate("custom-circle", 3, 1, "circle"),
      ];
    });
    const resizedRectangle = updateObjectsCommand(project, ["rectangle"], {
      widthM: 2.4,
      depthM: 1.6,
      heightM: 2.1,
    });
    const resizedCircle = updateObjectsCommand(resizedRectangle, ["circle"], {
      widthM: 1.8,
      heightM: 1.4,
    });

    expect(resizedCircle.objects[0]).toMatchObject({ widthM: 2.4, depthM: 1.6, heightM: 2.1 });
    expect(resizedCircle.objects[1]).toMatchObject({ widthM: 1.8, depthM: 1.8, heightM: 1.4 });
  });

  it("does not create a new project for a no-op edit or snapped drag", () => {
    const project = projectWithTwoTables();
    expect(updateObjectsCommand(project, ["first"], { widthM: project.objects[0].widthM })).toBe(project);
    expect(moveObjectsSnappedCommand(project, ["first"], [project.objects[0]], 0.01, 0.01)).toBe(project);
  });

  it("snaps a selection by one shared delta without changing spacing", () => {
    const project = projectWithTwoTables();
    project.objects[0].xM = 1.03;
    project.objects[1].xM = 3.27;
    const initialDistance = project.objects[1].xM - project.objects[0].xM;
    const moved = moveObjectsSnappedCommand(
      project,
      ["first", "second"],
      project.objects,
      0.06,
      0,
    );
    expect(moved.objects[1].xM - moved.objects[0].xM).toBeCloseTo(initialDistance);
  });

  it("groups, rotates around the shared center and ungroups", () => {
    const grouped = groupObjectsCommand(projectWithTwoTables(), ["first", "second"]);
    expect(grouped).not.toBeNull();
    const groupId = grouped?.groupId as string;
    const rotated = rotateSelectionCommand(
      grouped?.project as ReturnType<typeof projectWithTwoTables>,
      { ...EMPTY_SELECTION, objectIds: ["first", "second"], groupIds: [groupId] },
      90,
    );
    expect(rotated.objects[0].xM).toBeCloseTo(1.95);
    expect(rotated.objects[0].yM).toBeCloseTo(0.05);
    expect(rotated.objects[1].xM).toBeCloseTo(1.95);
    expect(rotated.objects[1].yM).toBeCloseTo(2.05);
    expect(ungroupObjectsCommand(rotated, [groupId]).groups).toHaveLength(0);
  });

  it("duplicates, locks and deletes a group as one independent unit", () => {
    const grouped = groupObjectsCommand(projectWithTwoTables(), ["first", "second"]);
    const groupId = grouped?.groupId as string;
    const selection = { ...EMPTY_SELECTION, objectIds: ["first", "second"], groupIds: [groupId] };
    const duplicated = duplicateSelectionCommand(grouped?.project as ReturnType<typeof projectWithTwoTables>, selection);
    expect(duplicated?.project.objects).toHaveLength(4);
    expect(duplicated?.project.groups).toHaveLength(2);
    expect(duplicated?.selection.groupIds[0]).not.toBe(groupId);

    const copyGroupId = duplicated?.selection.groupIds[0] as string;
    const locked = setGroupsLockedCommand(duplicated?.project as ReturnType<typeof projectWithTwoTables>, [copyGroupId], true);
    const copy = locked.groups.find((group) => group.id === copyGroupId);
    expect(copy?.locked).toBe(true);
    expect(locked.objects.filter((object) => copy?.objectIds.includes(object.id)).every((object) => object.locked)).toBe(true);

    const deleted = deleteSelectionCommand(locked, duplicated?.selection as typeof selection);
    expect(deleted.objects).toHaveLength(2);
    expect(deleted.groups.map((group) => group.id)).toEqual([groupId]);
  });

  it("copies a selection snapshot and pastes it after the originals are deleted", () => {
    const grouped = groupObjectsCommand(projectWithTwoTables(), ["first", "second"]);
    const groupId = grouped?.groupId as string;
    const source = grouped?.project as ReturnType<typeof projectWithTwoTables>;
    const selection = { ...EMPTY_SELECTION, objectIds: ["first", "second"], groupIds: [groupId] };
    const clipboard = copySelectionToClipboard(source, selection);
    expect(clipboard?.objects).toHaveLength(2);
    expect(clipboard?.groups).toHaveLength(1);

    const withoutOriginals = deleteSelectionCommand(source, selection);
    const pasted = pasteObjectClipboardCommand(withoutOriginals, clipboard as NonNullable<typeof clipboard>);

    expect(pasted?.project.objects).toHaveLength(2);
    expect(pasted?.project.groups).toHaveLength(1);
    expect(pasted?.selection.objectIds).toHaveLength(2);
  });
});
