import { describe, expect, it } from "vitest";
import { parseTesseractTsv } from "./ocr";

describe("parseTesseractTsv", () => {
  it("keeps coordinates, confidence and metric suggestions", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "5\t1\t1\t1\t1\t1\t10\t20\t80\t15\t94.5\t3500 мм",
      "5\t1\t1\t1\t2\t1\t30\t50\t60\t15\t88\tH=3,2",
    ].join("\n");
    const result = parseTesseractTsv(tsv);
    expect(result).toHaveLength(2);
    expect(result[0].suggestedDistanceM).toBeCloseTo(3.5);
    expect(result[1].suggestedWallHeightM).toBeCloseTo(3.2);
    expect(result[0].bounds.x).toBe(10);
  });
});
