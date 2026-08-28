import { useEffect, useState } from "react";
import { Download, HardDrive, KeyRound, LoaderCircle, Save, Sparkles, TestTube2 } from "lucide-react";
import { backend, isTauri } from "../services/backend";
import { DEFAULT_LIBRETRANSLATE_ENDPOINT, getTranslationEndpoint, hasTranslationEndpoint, resetTranslationEndpoint, saveTranslationEndpoint } from "../services/translation";
import { useLibrary } from "../state/LibraryContext";
import type { LlmSettings } from "../types";

type LocalEmbedStatus = {
  modelId: string;
  displayName: string;
  hfUrl: string;
  cacheDir: string;
  installed: boolean;
  ready: boolean;
  approxSizeHint: string;
  note: string;
};

export function LlmSettingsForm() {
  const { data, refresh } = useLibrary();
  const [value, setValue] = useState<LlmSettings>();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [ltEndpoint, setLtEndpoint] = useState(DEFAULT_LIBRETRANSLATE_ENDPOINT);
  const [ltConfigured, setLtConfigured] = useState(false);
  const [localEmbed, setLocalEmbed] = useState<LocalEmbedStatus>();

  useEffect(() => {
    if (!data) return;
    setValue({
      ...data.llm,
      autoClassifyOnImport: data.llm.autoClassifyOnImport ?? true,
      taxonomyStrictness: data.llm.taxonomyStrictness ?? "strict",
      embeddingModel: data.llm.embeddingModel ?? "",
    });
  }, [data?.llm]);
  useEffect(() => {
    setLtConfigured(hasTranslationEndpoint());
    setLtEndpoint(getTranslationEndpoint() ?? DEFAULT_LIBRETRANSLATE_ENDPOINT);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    void backend.localEmbeddingStatus().then(setLocalEmbed).catch(error => setNotice(error instanceof Error ? error.message : String(error)));
  }, []);

  if (!value) return null;

  const usingLocal = (value.embeddingModel ?? "").startsWith("local:");

  const persist = async () => {
    const payload = {
      ...value,
      embeddingModel: value.embeddingModel?.trim() || undefined,
    };
    const saved = await backend.saveLlmSettings(payload, apiKey || undefined);
    setValue({ ...saved, embeddingModel: saved.embeddingModel ?? "" });
    setApiKey("");
    await refresh();
  };
  const save = async () => { setBusy(true); try { await persist(); setNotice("LLM 设置已保存；API Key 已写入 Windows Credential Manager。"); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); try { await persist(); await backend.testLlmConnection(); setNotice("连接成功，可以在导入 PDF 时自动整理。"); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const installLocal = async () => {
    setLocalBusy(true);
    try {
      const status = await backend.enableLocalEmbeddingModel();
      setLocalEmbed(await backend.localEmbeddingStatus());
      setValue(current => current && { ...current, embeddingModel: status.embeddingModel ?? "local:bge-small-en-v1.5" });
      await refresh();
      setNotice("本地向量模型已下载并启用。论文雷达「为你推荐」将优先用本地语义重排，无需 Embeddings API Key。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      try { setLocalEmbed(await backend.localEmbeddingStatus()); } catch { /* ignore */ }
    } finally {
      setLocalBusy(false);
    }
  };
  const saveLt = () => {
    try {
      const saved = saveTranslationEndpoint(ltEndpoint);
      setLtEndpoint(saved);
      setLtConfigured(true);
      setNotice("LibreTranslate 地址已保存。阅读台收录可走本地翻译。");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const clearLt = () => {
    resetTranslationEndpoint();
    setLtConfigured(false);
    setLtEndpoint(DEFAULT_LIBRETRANSLATE_ENDPOINT);
    setNotice("已清除 LibreTranslate 配置。");
  };

  return <section className="settings-form llm-settings"><h2><Sparkles size={19} />LLM 自动整理</h2><p className="settings-description">支持 OpenAI 兼容的 Chat Completions 接口。导入新 PDF 时，应用先做本地文本提取，再将论文内容和最多 3 张候选框架图页发送到你配置的模型。阅读台收录术语/写作句时，配置 API Key 后走 LLM 学术翻译。</p>
    <label>API 基础地址<input value={value.baseUrl} onChange={e => setValue(v => v && { ...v, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></label>
    <label>模型名称<input value={value.model} onChange={e => setValue(v => v && { ...v, model: e.target.value })} placeholder="例如 gpt-4.1-mini / 自建模型名" /></label>
    <label>Embeddings 模型（可选；云端 API 名或本地 `local:bge-small-en-v1.5`）<input value={value.embeddingModel ?? ""} onChange={e => setValue(v => v && { ...v, embeddingModel: e.target.value })} placeholder="云端如 text-embedding-3-small；本地请点下方安装按钮" /></label>
    <label><KeyRound size={15} />API Key {value.apiKeySaved ? <small className="key-saved">已保存（留空则保留已存密钥）</small> : <small>未保存</small>}<input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="仅保存在 Windows Credential Manager" /></label>
    <label className="checkbox-setting"><input type="checkbox" checked={value.autoAnalyzeOnImport} onChange={e => setValue(v => v && { ...v, autoAnalyzeOnImport: e.target.checked })} />导入 PDF / 雷达入库后自动用 LLM 整理元数据与术语</label>
    <label className="checkbox-setting"><input type="checkbox" checked={value.autoClassifyOnImport} onChange={e => setValue(v => v && { ...v, autoClassifyOnImport: e.target.checked })} />导入 / 雷达入库时按设置页词表自动分类（主领域与子领域）</label>
    <label>分类严格度<select value={value.taxonomyStrictness} onChange={e => setValue(v => v && { ...v, taxonomyStrictness: e.target.value as LlmSettings["taxonomyStrictness"] })}><option value="strict">严格（仅核心标签，最多 3 个）</option><option value="standard">标准（核心+相关，最多 4 个）</option><option value="relaxed">宽松（最多 6 个）</option></select></label>
    <label className="checkbox-setting"><input type="checkbox" checked={value.visionEnabled} onChange={e => setValue(v => v && { ...v, visionEnabled: e.target.checked })} />发送候选方法图页缩略图（模型需支持图片输入）</label>
    <div className="settings-actions"><button className="primary" disabled={busy} onClick={save}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存 LLM 设置</button><button className="secondary" disabled={busy} onClick={test}><TestTube2 size={16} />测试连接</button></div>
    <div className="info-card"><KeyRound size={18} /><div><strong>密钥保存在 Credential Manager</strong><p>API Key 写入 Windows Credential Manager，SQLite、备份与前端代码均不保存密钥。开启「自动整理」后，导入会调用 LLM。</p></div></div>

    <h2 style={{ marginTop: 28 }}><HardDrive size={19} style={{ verticalAlign: "-3px", marginRight: 6 }} />本地向量模型（论文雷达）</h2>
    <p className="settings-description">
      <a href="https://huggingface.co/allenai/scibert_scivocab_uncased" target="_blank" rel="noreferrer">allenai/scibert_scivocab_uncased</a>
      SciBERT 是科学文本语言模型（MLM）。论文雷达本地语义重排推荐句子向量模型{" "}
      <a href={localEmbed?.hfUrl || "https://huggingface.co/BAAI/bge-small-en-v1.5"} target="_blank" rel="noreferrer">{localEmbed?.displayName || "BAAI/bge-small-en-v1.5"}</a>
      （约 130MB，&lt;2GB）。首次点击将下载到软件目录 <code>models/bge-small-en-v1.5</code>。论文对论文检索可再考虑{" "}
      <a href="https://huggingface.co/sentence-transformers/allenai-specter" target="_blank" rel="noreferrer">SPECTER</a>
      {" / "}
      <a href="https://huggingface.co/allenai/specter2" target="_blank" rel="noreferrer">SPECTER2</a>。
    </p>
    <div className="info-card">
      <HardDrive size={18} />
      <div>
        <strong>{usingLocal ? "当前：本地向量已启用" : localEmbed?.installed ? "模型文件已在本地，待写入 Embeddings 字段" : "待安装本地向量模型"}</strong>
        <p>
          {localEmbed
            ? `目录：${localEmbed.cacheDir || "（安装后显示）"} · ${localEmbed.approxSizeHint}${localEmbed.installed ? " · 已检测到 ONNX" : ""}`
            : "正在读取本地状态…"}
        </p>
      </div>
    </div>
    <div className="settings-actions">
      <button type="button" className="primary" disabled={localBusy || !isTauri()} onClick={() => void installLocal()}>
        {localBusy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
        {localEmbed?.installed ? "重新加载并启用本地向量" : "下载并启用本地向量模型"}
      </button>
    </div>

    <h2 style={{ marginTop: 28 }}>LibreTranslate（可选本地翻译）</h2>
    <p className="settings-description">配置本地 LibreTranslate 后，阅读台收录与摘要翻译可离线使用。请先运行 <code>scripts/start-libretranslate.cmd</code>，地址可填 <code>http://127.0.0.1:5000</code>（会自动补全 <code>/translate</code>）。</p>
    <label>服务地址<input value={ltEndpoint} onChange={e => setLtEndpoint(e.target.value)} placeholder={DEFAULT_LIBRETRANSLATE_ENDPOINT} /></label>
    <p className="settings-description">{ltConfigured ? `当前已配置：${getTranslationEndpoint()}` : "尚未配置本地翻译地址。"}</p>
    <div className="settings-actions"><button type="button" className="secondary" onClick={saveLt}><Save size={16} />保存翻译地址</button><button type="button" className="ghost" onClick={clearLt}>清除</button></div>
    {notice && <p className="inline-notice">{notice}</p>}
  </section>;
}
