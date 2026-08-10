import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import {
  addDimensionCommand,
  createObjectArrayCommand,
  deleteDimensionCommand,
  instantiateCompositeTemplateCommand,
  saveCompositeTemplateCommand,
} from "./advanced-commands";

describe("advanced project commands", () => {
  it("adds and removes a persistent dimension", () => {
    const project = createEmptyProject();
    const measured = addDimensionCommand(project, { xM: 1, yM: 1 }, { xM: 4, yM: 5 });
    expect(measured.dimensions).toHaveLength(1);
    expect(deleteDimensionCommand(measured, measured.dimensions[0].id).dimensions).toHaveLength(0);
  });

  it("creates a horizontal array in one project state", () => {
    const project = createEmptyProject();
    project.objects = [createObjectFromTemplate("table", 1, 2, "table")];
    const result = createObjectArrayCommand(
      project,
      { objectIds: ["table"], groupIds: [], groupEditId: null },
      4,
      1.5,
      "horizontal",
    );
    expect(result?.project.objects.map((object) => object.xM)).toEqual([1, 2.5, 4, 5.5]);
    expect(result?.selection.objectIds).toHaveLength(4);
  });

  it("saves and instantiates a grouped composite template", () => {
    const project = createEmptyProject();
    project.objects = [
      createObjectFromTemplate("table", 1, 2, "table"),
      createObjectFromTemplate("computer", 1, 1.6, "computer"),
    ];
    const saved = saveCompositeTemplateCommand(project, ["table", "computer"], "Игровое место");
    expect(saved?.project.customTemplates[0].items).toHaveLength(2);
    const inserted = saved && instantiateCompositeTemplateCommand(saved.project, saved.templateId, 10, 4);
    expect(inserted?.project.objects).toHaveLength(4);
    expect(inserted?.project.groups).toHaveLength(1);
  });
});
