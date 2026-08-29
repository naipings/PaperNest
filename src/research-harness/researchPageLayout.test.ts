import { describe, expect, it } from "vitest";
import { measureResearchLayout, researchContentMaxWidth, trajectoryHeightBounds } from "./researchPageLayout";

describe("researchPageLayout", () => {
  it("widens content max on large viewports", () => {
    expect(researchContentMaxWidth(1500, 1920)).toBe(1480);
    expect(researchContentMaxWidth(1200, 1280)).toBe(1200);
  });

  it("scales trajectory bounds with viewport height", () => {
    expect(trajectoryHeightBounds(1300).max).toBeGreaterThan(trajectoryHeightBounds(800).max);
  });

  it("fits trajectory height into measured available space", () => {
    const metrics = measureResearchLayout({
      pageWidth: 1400,
      viewportWidth: 1600,
      viewportHeight: 1080,
      headingBottom: 180,
      trajectoryBodyTop: 320,
      tabsHeight: 44,
      hasResumeBar: true,
      trajectoryActive: true,
    });
    expect(metrics.trajectoryHeight).toBeGreaterThanOrEqual(460);
    expect(metrics.trajectoryHeight).toBeLessThanOrEqual(780);
    expect(metrics.contentMaxWidth).toBe(1360);
  });
});
