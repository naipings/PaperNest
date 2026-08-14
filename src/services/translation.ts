import { backend } from "./backend";

const endpointKey = "papernest.translation.endpoint.v2";
const legacyEndpointKey = "papernest.translation.endpoint";
type TranslationConfig = { endpoint: string; apiKey?: string };

function translationConfig(): TranslationConfig {
  const saved = localStorage.getItem(endpointKey);
  if (saved) { try { return JSON.parse(saved) as TranslationConfig; } catch { localStorage.removeItem(endpointKey); } }
  const endpoint = window.prompt("\u8bf7\u8f93\u5165\u7ffb\u8bd1\u670d\u52a1\u5730\u5740\uff08HTTPS \u6216\u672c\u673a LibreTranslate\uff09\uff1a", "")?.trim() ?? "";
  if (!endpoint) throw new Error("\u672a\u914d\u7f6e\u7ffb\u8bd1\u670d\u52a1\u3002\u8bf7\u5728\u4e0b\u6b21\u70b9\u51fb\u672f\u8bed\u6216\u5199\u4f5c\u5e93\u65f6\u8f93\u5165\u53ef\u7528\u7684\u7ffb\u8bd1 API \u5730\u5740\u3002");
  const apiKey = window.prompt("\u53ef\u9009 API Key\uff08\u81ea\u5efa\u672c\u5730 LibreTranslate \u8bf7\u7559\u7a7a\uff09\uff1a", "")?.trim() || undefined;
  const config = { endpoint, apiKey }; localStorage.setItem(endpointKey, JSON.stringify(config)); return config;
}

export async function translateEnglishToChinese(text: string): Promise<string> {
  const value = text.trim(); if (!value) return "";
  const config = translationConfig();
  return backend.translateText(config.endpoint, value, config.apiKey);
}

export function resetTranslationEndpoint() { localStorage.removeItem(endpointKey); localStorage.removeItem(legacyEndpointKey); }
