import { describe, expect, it } from "vitest";
import { createEmptyProject, updateProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { buildProjectPdfSvg, buildProjectSvg } from "./export-svg";

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

  it("exports reflected object geometry without reflecting its label", () => {
    const project = createEmptyProject();
    project.objects = [{ ...createObjectFromTemplate("door", 2, 2, "door"), flipX: true }];
    const svg = buildProjectSvg(project, { source: "<svg/>", defsMarkup: "", geometryMarkup: "", labels: [] });
    expect(svg).toContain("rotate(0) scale(-1 1)");
    expect(svg).toContain("<text");
  });

  it("fits the PDF export onto one A4 landscape SVG page", () => {
    const project = createEmptyProject();
    const svg = buildProjectPdfSvg(project, { source: "<svg/>", defsMarkup: "", geometryMarkup: "", labels: [] });
    expect(svg).toContain('width="1122" height="793" viewBox="0 0 1122 793"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain('y="28"');
  });

  it("keeps a blank source blank even when its underlay checkbox is enabled", () => {
    const project = createEmptyProject();
    project.canvas.basePlanVisible = true;
    const marker = "legacy-base-plan-marker";
    const svg = buildProjectSvg(project, { source: "<svg/>", defsMarkup: "", geometryMarkup: marker, labels: [] });

    expect(svg).not.toContain(marker);
    expect(svg).toContain('viewBox="0 0 4000 3000"');
    expect(svg).toContain('pattern id="club-export-grid" width="50" height="50"');
  });
});
