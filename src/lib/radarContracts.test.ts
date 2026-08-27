import { describe, expect, it } from "vitest";
import type { RadarRecommendResult, RadarSettings } from "../types";

describe("radar types contracts", () => {
  it("keeps dual-layer settings defaults offline", () => {
    const settings: RadarSettings = {
      enabled: false,
      categories: ["cs.LG"],
      keywords: ["agent"],
      defaultFilterEnabled: true,
      hotLimit: 30,
      newLimit: 100,
      retainDays: 90,
    };
    expect(settings.defaultFilterEnabled).toBe(true);
  });

  it("labels empty recommend cascade strategy", () => {
    const result: RadarRecommendResult = {
      strategy: "empty_cta",
      windowDays: 30,
      coverageDays: 0,
      items: [],
    };
    expect(result.strategy).toBe("empty_cta");
    expect(result.items).toHaveLength(0);
  });
});
