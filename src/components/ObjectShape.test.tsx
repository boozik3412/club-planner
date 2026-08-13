/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createObjectFromTemplate } from "../editor/model/templates";
import { ObjectShape } from "./ObjectShape";

afterEach(cleanup);

describe("ObjectShape", () => {
  it("renders a custom circle and oval as SVG ellipses", () => {
    const circle = createObjectFromTemplate("custom-circle", 1, 1, "circle");
    const oval = createObjectFromTemplate("custom-oval", 3, 1, "oval");
    const { container } = render(
      <svg>
        <ObjectShape object={circle} unitsPerMeter={100} canvasRotationDeg={0} zoom={1} selected={false} showHandles={false} labelsVisible={false} />
        <ObjectShape object={oval} unitsPerMeter={100} canvasRotationDeg={0} zoom={1} selected={false} showHandles={false} labelsVisible={false} />
      </svg>,
    );

    expect(container.querySelectorAll("ellipse.object-hit-area")).toHaveLength(2);
    expect(container.querySelector('ellipse[data-object-id="circle"]')).not.toBeNull();
    expect(container.querySelector('ellipse[data-object-id="oval"]')).not.toBeNull();
  });

  it("reflects only the object shape while keeping its label readable", () => {
    const object = { ...createObjectFromTemplate("door", 1, 1, "door"), flipX: true, flipY: true };
    const { container } = render(
      <svg>
        <ObjectShape object={object} unitsPerMeter={100} canvasRotationDeg={0} zoom={1} selected={false} showHandles={false} labelsVisible />
      </svg>,
    );
    expect(container.querySelector('g[transform="scale(-1 -1)"]')).not.toBeNull();
    expect(container.querySelector(".object-label-wrap")?.getAttribute("transform")).toBe("rotate(0)");
  });
});
