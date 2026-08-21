import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, Save, Sparkles, TestTube2 } from "lucide-react";
import { backend } from "../services/backend";
import { DEFAULT_LIBRETRANSLATE_ENDPOINT, getTranslationEndpoint, hasTranslationEndpoint, resetTranslationEndpoint, saveTranslationEndpoint } from "../services/translation";
import { useLibrary } from "../state/LibraryContext";
import type { LlmSettings } from "../types";

export function LlmSettingsForm() {
  const { data, refresh } = useLibrary();
  const [value, setValue] = useState<LlmSettings>();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [ltEndpoint, setLtEndpoint] = useState(DEFAULT_LIBRETRANSLATE_ENDPOINT);
  const [ltConfigured, setLtConfigured] = useState(false);
  useEffect(() => { if (data) setValue(data.llm); }, [data?.llm]);
  useEffect(() => {
    setLtConfigured(hasTranslationEndpoint());
    setLtEndpoint(getTranslationEndpoint() ?? DEFAULT_LIBRETRANSLATE_ENDPOINT);
  }, []);
  if (!value) return null;
  const persist = async () => { const saved = await backend.saveLlmSettings(value, apiKey || undefined); setValue(saved); setApiKey(""); await refresh(); };
  const save = async () => { setBusy(true); try { await persist(); setNotice("LLM 设置已保存；API Key 已写入 Windows Credential Manager。"); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); try { await persist(); await backend.testLlmConnection(); setNotice("连接成功，可以在导入 PDF 时自动整理。"); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const saveLt = () => {
    try {
      const saved = saveTranslationEndpoint(ltEndpoint);
      setLtEndpoint(saved);
      setLtConfigured(true);
      setNotice("LibreTranslate 地址已保存。收录时优先用 LLM；仅当 LLM 不可用时才走本地翻译。");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const clearLt = () => {
    resetTranslationEndpoint();
    setLtConfigured(false);
    setLtEndpoint(DEFAULT_LIBRETRANSLATE_ENDPOINT);
    setNotice("已清除 LibreTranslate 配置。");
  };
  return <section className="settings-form llm-settings"><h2><Sparkles size={19} />LLM 自动整理</h2><p className="settings-description">支持 OpenAI 兼容的 Chat Completions 接口。导入新 PDF 时，应用先做本地文本提取，再将论文内容和最多 3 张候选框架图页发送到你配置的模型。阅读台收录术语/写作句时，有 API Key 则优先用 LLM 做学术翻译。</p>
    <label>API 基础地址<input value={value.baseUrl} onChange={e => setValue(v => v && { ...v, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></label>
    <label>模型名称<input value={value.model} onChange={e => setValue(v => v && { ...v, model: e.target.value })} placeholder="例如 gpt-4.1-mini / 自建模型名" /></label>
    <label><KeyRound size={15} />API Key {value.apiKeySaved ? <small className="key-saved">已保存（留空则不覆盖）</small> : <small>未保存</small>}<input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="仅保存在 Windows Credential Manager" /></label>
    <label className="checkbox-setting"><input type="checkbox" checked={value.autoAnalyzeOnImport} onChange={e => setValue(v => v && { ...v, autoAnalyzeOnImport: e.target.checked })} />导入新 PDF 后自动用 LLM 提取并填写信息</label>
    <label className="checkbox-setting"><input type="checkbox" checked={value.visionEnabled} onChange={e => setValue(v => v && { ...v, visionEnabled: e.target.checked })} />发送候选方法图页缩略图（模型需支持图片输入）</label>
    <div className="settings-actions"><button className="primary" disabled={busy} onClick={save}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存 LLM 设置</button><button className="secondary" disabled={busy} onClick={test}><TestTube2 size={16} />测试连接</button></div>
    <div className="info-card"><KeyRound size={18} /><div><strong>密钥不进入资料库</strong><p>SQLite、备份、诊断日志和前端 JavaScript 均不会保存或读取 API Key。关闭“自动整理”后，导入不发起网络请求。</p></div></div>

    <h2 style={{ marginTop: 28 }}>LibreTranslate（可选弱回退）</h2>
    <p className="settings-description">学术翻译默认走上方 LLM。本地 LibreTranslate 仅在未配置/调用 LLM 失败时使用。请先运行 <code>scripts/start-libretranslate.cmd</code>，地址可填 <code>http://127.0.0.1:5000</code>（会自动补全 <code>/translate</code>）。</p>
    <label>服务地址<input value={ltEndpoint} onChange={e => setLtEndpoint(e.target.value)} placeholder={DEFAULT_LIBRETRANSLATE_ENDPOINT} /></label>
    <p className="settings-description">{ltConfigured ? `当前已配置：${getTranslationEndpoint()}` : "尚未配置本地翻译地址。"}</p>
    <div className="settings-actions"><button type="button" className="secondary" onClick={saveLt}><Save size={16} />保存翻译地址</button><button type="button" className="ghost" onClick={clearLt}>清除</button></div>
    {notice && <p className="inline-notice">{notice}</p>}
  </section>;
}
