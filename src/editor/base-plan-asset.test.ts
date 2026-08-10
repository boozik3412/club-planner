import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../assets/base_plan_new_measurement.svg", import.meta.url),
  "utf8",
);

describe("base_plan_new_measurement.svg", () => {
  it("contains the expected measured bounds and separated locked layers", () => {
    expect(source).toContain('viewBox="0 0 23569.5996 2752.6399"');
    expect(source).toContain('id="basePlanGeometry"');
    expect(source).toContain('id="basePlanLabels"');
  });

  it("keeps all 346 label anchors used for rotation compensation", () => {
    expect(source.match(/class="plan-label"/g)).toHaveLength(346);
    expect(source.match(/data-cx=/g)).toHaveLength(346);
    expect(source.match(/data-cy=/g)).toHaveLength(346);
  });

  it("does not reference remote assets", () => {
    expect(source).not.toMatch(/(?:href|src)=["']https?:\/\//i);
  });
});
