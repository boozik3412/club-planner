import { describe, expect, it } from "vitest";
import { createEmptyProject, updateProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { EMPTY_SELECTION } from "../model/types";
import { MIXED_VALUE, getMixedValue, pruneSelection, selectTarget } from "./selection";

describe("selection model", () => {
  it("adds and removes an object with Shift semantics", () => {
    const first = createObjectFromTemplate("table", 1, 1, "first");
    const second = createObjectFromTemplate("table", 2, 1, "second");
    const project = updateProject(createEmptyProject(), (draft) => {
      draft.objects = [first, second];
    });

    const selectedFirst = selectTarget(project, EMPTY_SELECTION, first.id, false);
    const selectedBoth = selectTarget(project, selectedFirst, second.id, true);
    const selectedSecond = selectTarget(project, selectedBoth, first.id, true);

    expect(selectedBoth.objectIds).toEqual(["first", "second"]);
    expect(selectedSecond.objectIds).toEqual(["second"]);
  });

  it("selects a permanent group as a unit outside group edit mode", () => {
    const project = updateProject(createEmptyProject(), (draft) => {
      draft.objects = [
        createObjectFromTemplate("table", 1, 1, "first"),
        createObjectFromTemplate("table", 2, 1, "second"),
      ];
      draft.groups = [{ id: "group", name: "Группа", objectIds: ["first", "second"], locked: false }];
    });

    expect(selectTarget(project, EMPTY_SELECTION, "first", false)).toMatchObject({
      objectIds: ["first", "second"],
      groupIds: ["group"],
    });
  });

  it("normalizes selected members when history restores a group", () => {
    const project = updateProject(createEmptyProject(), (draft) => {
      draft.objects = [
        createObjectFromTemplate("table", 1, 1, "first"),
        createObjectFromTemplate("table", 2, 1, "second"),
      ];
      draft.groups = [{ id: "group", name: "Группа", objectIds: ["first", "second"], locked: false }];
    });

    expect(pruneSelection(project, {
      objectIds: ["first"],
      groupIds: [],
      groupEditId: null,
    })).toEqual({
      objectIds: ["first", "second"],
      groupIds: ["group"],
      groupEditId: null,
    });
  });

  it("allows a locked group to be selected so it can be unlocked", () => {
    const project = updateProject(createEmptyProject(), (draft) => {
      draft.objects = [
        { ...createObjectFromTemplate("table", 1, 1, "first"), locked: true },
        { ...createObjectFromTemplate("table", 2, 1, "second"), locked: true },
      ];
      draft.groups = [{ id: "group", name: "Группа", objectIds: ["first", "second"], locked: true }];
    });

    expect(selectTarget(project, EMPTY_SELECTION, "first", false).groupIds).toEqual(["group"]);
  });

  it("reports mixed values", () => {
    const first = createObjectFromTemplate("table", 1, 1, "first");
    const second = { ...createObjectFromTemplate("table", 2, 1, "second"), widthM: 1.8 };
    expect(getMixedValue([first, second], "widthM")).toBe(MIXED_VALUE);
    expect(getMixedValue([first, { ...second, widthM: first.widthM }], "widthM")).toBe(1.4);
  });
});
