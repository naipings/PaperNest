import { backend } from "./backend";

const endpointKey = "papernest.translation.endpoint.v2";
const legacyEndpointKey = "papernest.translation.endpoint";
export const DEFAULT_LIBRETRANSLATE_ENDPOINT = "http://127.0.0.1:5000/translate";
type TranslationConfig = { endpoint: string; apiKey?: string };
export type LlmTranslateMode = "term" | "sentence";

/** Accept base URL or full /translate path; always POST to .../translate. */
export function normalizeLibreTranslateEndpoint(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/translate$/i.test(trimmed) ? trimmed : `${trimmed}/translate`;
}

function translationConfig(): TranslationConfig {
  const saved = localStorage.getItem(endpointKey);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as TranslationConfig;
      const endpoint = normalizeLibreTranslateEndpoint(parsed.endpoint ?? "");
      if (endpoint) return { ...parsed, endpoint };
      localStorage.removeItem(endpointKey);
    } catch { localStorage.removeItem(endpointKey); }
  }
  const endpoint = normalizeLibreTranslateEndpoint(
    window.prompt(
      "请输入 LibreTranslate 地址（需先运行 scripts/start-libretranslate.cmd；可填 http://127.0.0.1:5000 或完整 /translate 路径）：",
      DEFAULT_LIBRETRANSLATE_ENDPOINT
    )?.trim() ?? ""
  );
  if (!endpoint) throw new Error("未配置翻译服务。请先启动 LibreTranslate，或依赖已配置的 LLM 做学术翻译。");
  const apiKey = window.prompt("可选 API Key（自建本地 LibreTranslate 请留空）：", "")?.trim() || undefined;
  const config = { endpoint, apiKey };
  localStorage.setItem(endpointKey, JSON.stringify(config));
  return config;
}

export function hasTranslationEndpoint() {
  const saved = localStorage.getItem(endpointKey);
  if (!saved) return false;
  try { return Boolean(normalizeLibreTranslateEndpoint((JSON.parse(saved) as TranslationConfig).endpoint ?? "")); } catch { return false; }
}

export function getTranslationEndpoint(): string | undefined {
  const saved = localStorage.getItem(endpointKey);
  if (!saved) return undefined;
  try {
    const endpoint = normalizeLibreTranslateEndpoint((JSON.parse(saved) as TranslationConfig).endpoint ?? "");
    return endpoint || undefined;
  } catch { return undefined; }
}

export function saveTranslationEndpoint(endpoint: string, apiKey?: string) {
  const normalized = normalizeLibreTranslateEndpoint(endpoint);
  if (!normalized) throw new Error("请填写 LibreTranslate 地址");
  localStorage.setItem(endpointKey, JSON.stringify({ endpoint: normalized, apiKey: apiKey?.trim() || undefined }));
  return normalized;
}

export async function translateEnglishToChinese(text: string): Promise<string> {
  const value = text.trim(); if (!value) return "";
  const config = translationConfig();
  return backend.translateText(config.endpoint, value, config.apiKey);
}

/** Prefer configured LLM for academic quality; LibreTranslate is a weak offline fallback. */
export async function translateEnglishToChineseWithFallback(
  text: string,
  llmReady: boolean,
  options?: { mode?: LlmTranslateMode; context?: string }
): Promise<string | undefined> {
  const value = text.trim();
  if (!value) return undefined;
  if (llmReady) {
    try { return await backend.translateWithLlm(value, options?.mode ?? "sentence", options?.context); }
    catch { /* fall through to LibreTranslate */ }
  }
  if (hasTranslationEndpoint()) {
    try { return await translateEnglishToChinese(value); }
    catch { /* both unavailable */ }
  }
  return undefined;
}

export function resetTranslationEndpoint() { localStorage.removeItem(endpointKey); localStorage.removeItem(legacyEndpointKey); }
