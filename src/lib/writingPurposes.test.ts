import { describe, expect, it } from "vitest";
import { DEFAULT_WRITING_PURPOSES, writingPurposeLabels } from "./writingPurposes";

describe("writingPurposeLabels", () => {
  it("keeps defaults and appends custom purposes from excerpts", () => {
    expect(writingPurposeLabels([{ purpose: "方法描述" }, { purpose: "贡献陈述" }, { purpose: "贡献陈述" }])).toEqual([
      ...DEFAULT_WRITING_PURPOSES,
      "贡献陈述"
    ]);
  });
});
