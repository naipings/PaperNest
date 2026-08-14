import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTranslationEndpoint, translateEnglishToChinese } from "./translation";

describe("translateEnglishToChinese", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("posts only the requested text to the configured endpoint", async () => {
    localStorage.setItem("papernest.translation.endpoint.v2", JSON.stringify({ endpoint: "https://translate.example/translate", apiKey: "test-key" }));
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ translatedText: "测试" }), { status: 200 }));
    await expect(translateEnglishToChinese("test")).resolves.toBe("测试");
    expect(request).toHaveBeenCalledWith("https://translate.example/translate", expect.objectContaining({ method: "POST" }));
  });

  it("clears a configured endpoint", () => {
    localStorage.setItem("papernest.translation.endpoint.v2", JSON.stringify({ endpoint: "https://translate.example/translate" }));
    resetTranslationEndpoint();
    expect(localStorage.getItem("papernest.translation.endpoint.v2")).toBeNull();
  });
});
