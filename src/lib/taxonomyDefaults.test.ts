import { describe, expect, it } from "vitest";
import { defaultCategories, defaultTags } from "../seed";

describe("default taxonomy", () => {
  it("presets ACM-aligned Chinese main fields and subdomain tags", () => {
    expect(defaultCategories.length).toBeGreaterThanOrEqual(12);
    expect(defaultCategories.map(item => item.name)).toEqual(expect.arrayContaining([
      "计算机视觉", "自然语言处理", "机器学习", "信息检索与推荐系统", "安全与隐私", "软件工程"
    ]));
    expect(new Set(defaultCategories.map(item => item.id)).size).toBe(defaultCategories.length);
    expect(defaultTags.map(item => item.name)).toEqual(expect.arrayContaining([
      "大语言模型", "推荐系统", "联邦学习", "综述", "目标检测"
    ]));
    expect(new Set(defaultTags.map(item => item.id)).size).toBe(defaultTags.length);
  });
});
