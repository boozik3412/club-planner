import { describe, expect, it } from "vitest";
import { createEmptyProject, updateProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { buildProjectSvg } from "./export-svg";

describe("SVG export", () => {
  it("exports round and oval custom objects as ellipses", () => {
    const project = updateProject(createEmptyProject(), (draft) => {
      draft.objects = [
        createObjectFromTemplate("custom-circle", 1, 1, "circle"),
        createObjectFromTemplate("custom-oval", 3, 1, "oval"),
      ];
    });
    const svg = buildProjectSvg(project, {
      source: "<svg/>",
      defsMarkup: "",
      geometryMarkup: "",
      labels: [],
    });

    expect(svg.match(/<ellipse/g)).toHaveLength(2);
    expect(svg).toContain('data-object-id="circle"');
    expect(svg).toContain('data-object-id="oval"');
  });
});
