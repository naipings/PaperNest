import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "./backend";
import { hasTranslationEndpoint, resetTranslationEndpoint, translateEnglishToChinese, translateEnglishToChineseWithFallback } from "./translation";

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
    expect(hasTranslationEndpoint()).toBe(false);
  });

  it("falls back to LLM when no translation endpoint is configured", async () => {
    const llm = vi.spyOn(backend, "translateWithLlm").mockResolvedValue("大模型译文");
    await expect(translateEnglishToChineseWithFallback("hello", true)).resolves.toBe("大模型译文");
    expect(llm).toHaveBeenCalledWith("hello");
  });

  it("falls back to LLM when the translation endpoint fails", async () => {
    localStorage.setItem("papernest.translation.endpoint.v2", JSON.stringify({ endpoint: "https://translate.example/translate" }));
    vi.spyOn(backend, "translateText").mockRejectedValue(new Error("down"));
    const llm = vi.spyOn(backend, "translateWithLlm").mockResolvedValue("备用译文");
    await expect(translateEnglishToChineseWithFallback("paper", true)).resolves.toBe("备用译文");
    expect(llm).toHaveBeenCalledWith("paper");
  });

  it("returns undefined when neither translation service nor LLM is available", async () => {
    await expect(translateEnglishToChineseWithFallback("paper", false)).resolves.toBeUndefined();
  });
});
