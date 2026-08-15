import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "./backend";
import {
  hasTranslationEndpoint,
  normalizeLibreTranslateEndpoint,
  resetTranslationEndpoint,
  saveTranslationEndpoint,
  translateEnglishToChinese,
  translateEnglishToChineseWithFallback
} from "./translation";

describe("translateEnglishToChinese", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("normalizes base LibreTranslate URLs to /translate", () => {
    expect(normalizeLibreTranslateEndpoint("http://127.0.0.1:5000")).toBe("http://127.0.0.1:5000/translate");
    expect(normalizeLibreTranslateEndpoint("http://127.0.0.1:5000/translate/")).toBe("http://127.0.0.1:5000/translate");
  });

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

  it("prefers LLM over LibreTranslate when an API key is available", async () => {
    saveTranslationEndpoint("http://127.0.0.1:5000");
    const llm = vi.spyOn(backend, "translateWithLlm").mockResolvedValue("学术译文");
    const lt = vi.spyOn(backend, "translateText").mockResolvedValue("机器译文");
    await expect(translateEnglishToChineseWithFallback("transformer", true, { mode: "term", context: "We propose a Transformer." })).resolves.toBe("学术译文");
    expect(llm).toHaveBeenCalledWith("transformer", "term", "We propose a Transformer.");
    expect(lt).not.toHaveBeenCalled();
  });

  it("falls back to LibreTranslate when LLM is unavailable", async () => {
    saveTranslationEndpoint("http://127.0.0.1:5000");
    const lt = vi.spyOn(backend, "translateText").mockResolvedValue("本地译文");
    await expect(translateEnglishToChineseWithFallback("paper", false, { mode: "sentence" })).resolves.toBe("本地译文");
    expect(lt).toHaveBeenCalled();
  });

  it("falls back to LibreTranslate when LLM fails", async () => {
    saveTranslationEndpoint("http://127.0.0.1:5000");
    vi.spyOn(backend, "translateWithLlm").mockRejectedValue(new Error("llm down"));
    vi.spyOn(backend, "translateText").mockResolvedValue("备用译文");
    await expect(translateEnglishToChineseWithFallback("paper", true)).resolves.toBe("备用译文");
  });

  it("returns undefined when neither LLM nor translation service is available", async () => {
    await expect(translateEnglishToChineseWithFallback("paper", false)).resolves.toBeUndefined();
  });
});
