import { describe, expect, it } from "vitest";
import { defaultCategories, defaultTags } from "../seed";

describe("default taxonomy", () => {
  it("presets clinical secondary disciplines and study-design tags", () => {
    expect(defaultCategories.length).toBeGreaterThanOrEqual(12);
    expect(defaultCategories.map(item => item.name)).toEqual(expect.arrayContaining([
      "内科学", "外科学", "肿瘤学", "重症医学", "影像医学与核医学", "麻醉学"
    ]));
    expect(new Set(defaultCategories.map(item => item.id)).size).toBe(defaultCategories.length);
    expect(defaultTags.map(item => item.name)).toEqual(expect.arrayContaining([
      "随机对照试验", "队列研究", "系统评价", "综述", "CONSORT"
    ]));
    expect(new Set(defaultTags.map(item => item.id)).size).toBe(defaultTags.length);
  });
});
