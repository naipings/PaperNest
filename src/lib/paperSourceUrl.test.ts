import { describe, expect, it } from "vitest";
import { resolvePaperSourceUrl } from "./paperSourceUrl";

describe("resolvePaperSourceUrl", () => {
  it("prefers an explicit source URL", () => {
    expect(resolvePaperSourceUrl({ sourceUrl: "https://example.com/p", doi: "10.1/x" })).toBe("https://example.com/p");
  });

  it("builds a DOI link when sourceUrl is missing", () => {
    expect(resolvePaperSourceUrl({ doi: "10.1145/3589335.3651529" })).toBe("https://doi.org/10.1145/3589335.3651529");
    expect(resolvePaperSourceUrl({ doi: "https://doi.org/10.1145/3589335.3651529" })).toBe("https://doi.org/10.1145/3589335.3651529");
  });

  it("builds an arXiv abs link", () => {
    expect(resolvePaperSourceUrl({ arxivId: "1706.03762" })).toBe("https://arxiv.org/abs/1706.03762");
  });
});
