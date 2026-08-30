import { useEffect, useState } from "react";
import { Copy, KeyRound, LoaderCircle, Save, Search, TestTube2 } from "lucide-react";
import { backend, isTauri } from "../services/backend";
import type { McpInfo, ResearchLlmSettings } from "../types";

const DEFAULT: ResearchLlmSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1",
  apiKeySaved: false,
  allowWebSearch: false,
  maxIterations: 8,
  maxTokensPerStep: 4000,
  reportMaxTokens: 12000,
  researchMode: "react",
  researchDepth: "standard",
  maxReactRounds: 0,
  maxToolCalls: 0,
  llmNativeWebSearch: "auto",
};

export function ResearchSettingsForm() {
  const [value, setValue] = useState<ResearchLlmSettings>(DEFAULT);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void backend.researchGetSettings()
      .then(settings => setValue({ ...DEFAULT, ...settings }))
      .catch(error => setNotice(error instanceof Error ? error.message : String(error)));
    void backend.mcpGetInfo()
      .then(info => setMcpInfo(info))
      .catch(() => setMcpInfo(null));
  }, []);

  const persist = async () => {
    const saved = await backend.researchSaveSettings(value, apiKey || undefined);
    setValue(saved);
    setApiKey("");
  };

  const save = async () => {
    setBusy(true);
    try {
      await persist();
      setNotice("文献调研 LLM 设置已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await persist();
      await backend.researchTestConnection();
      setNotice("调研 LLM 连接成功。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-form research-settings">
      <h2><Search size={19} />文献调研</h2>
      <p className="settings-description">
        默认关闭。启用后，在「文献调研」页创建任务并点击「开始调研」。默认使用 ReAct 深循环（LLM 自主选工具）；调研 LLM 与「LLM 自动整理」分开配置。外网检索包含 arXiv、OpenAlex（IEEE/ACM 等）、Crossref、GitHub；若模型支持内置联网，还可通过 llm_web_search 检索博客与新闻（费用计入同一 LLM Key）。
      </p>
      {!isTauri() && <p className="inline-notice">浏览器预览模式不支持文献调研。</p>}
      <label className="checkbox-setting">
        <input type="checkbox" checked={value.enabled} onChange={e => setValue(v => ({ ...v, enabled: e.target.checked }))} />
        启用文献调研
      </label>
      <label>API 基础地址<input value={value.baseUrl} onChange={e => setValue(v => ({ ...v, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" /></label>
      <label>模型名称<input value={value.model} onChange={e => setValue(v => ({ ...v, model: e.target.value }))} placeholder="例如 gpt-4.1 / o3" /></label>
      <label>
        <KeyRound size={15} />API Key {value.apiKeySaved ? <small className="key-saved">已保存（留空则保留）</small> : <small>未保存</small>}
        <input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Credential Manager: research_api_key" />
      </label>
      <label className="checkbox-setting">
        <input type="checkbox" checked={value.allowWebSearch} onChange={e => setValue(v => ({ ...v, allowWebSearch: e.target.checked }))} />
        允许外网检索（arXiv、OpenAlex/Crossref、GitHub、LLM 内置联网）
      </label>
      <label>LLM 内置联网
        <select value={value.llmNativeWebSearch ?? "auto"} onChange={e => setValue(v => ({ ...v, llmNativeWebSearch: e.target.value }))}>
          <option value="auto">自动检测（推荐）</option>
          <option value="dashscope">百炼 / Qwen（enable_search）</option>
          <option value="zhipu">智谱 GLM（web_search 工具）</option>
          <option value="openai_responses">OpenAI Responses（web_search）</option>
          <option value="off">关闭 llm_web_search</option>
        </select>
      </label>
      <p className="settings-description"><small>llm_web_search 与 ReAct 自定义工具互斥，由独立 LLM 请求完成；auto 模式会按 API 地址尝试多种适配。不支持内置联网的模型请选「关闭」。</small></p>
      <label>调研模式
        <select value={value.researchMode} onChange={e => setValue(v => ({ ...v, researchMode: e.target.value }))}>
          <option value="react">ReAct 深循环（推荐）</option>
          <option value="pipeline">固定流水线（旧版）</option>
        </select>
      </label>
      <label>调研深度
        <select value={value.researchDepth} onChange={e => setValue(v => ({ ...v, researchDepth: e.target.value }))}>
          <option value="quick">快速（约 8 轮）</option>
          <option value="standard">标准（约 20 轮）</option>
          <option value="deep">深度（约 35 轮）</option>
        </select>
      </label>
      <label>最大 ReAct 轮次（0=按深度预设）<input type="number" min={0} max={50} value={value.maxReactRounds} onChange={e => setValue(v => ({ ...v, maxReactRounds: Number(e.target.value) || 0 }))} /></label>
      <label>最大 tool 调用（0=按深度预设）<input type="number" min={0} max={120} value={value.maxToolCalls} onChange={e => setValue(v => ({ ...v, maxToolCalls: Number(e.target.value) || 0 }))} /></label>
      <label>最大检索轮次（pipeline）<input type="number" min={2} max={12} value={value.maxIterations} onChange={e => setValue(v => ({ ...v, maxIterations: Number(e.target.value) || 8 }))} /></label>
      <label>中间步默认 tokens<input type="number" min={1000} max={16000} step={500} value={value.maxTokensPerStep} onChange={e => setValue(v => ({ ...v, maxTokensPerStep: Number(e.target.value) || 4000 }))} /></label>
      <label>报告最大 tokens<input type="number" min={4000} max={32000} step={500} value={value.reportMaxTokens ?? 12000} onChange={e => setValue(v => ({ ...v, reportMaxTokens: Number(e.target.value) || 12000 }))} /></label>
      <div className="settings-actions">
        <button className="primary" disabled={busy || !isTauri()} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存调研设置</button>
        <button className="secondary" disabled={busy || !isTauri()} onClick={() => void test()}><TestTube2 size={16} />测试连接</button>
      </div>
      {mcpInfo && (
        <div className="research-mcp-card">
          <h3>Codex MCP 集成</h3>
          <p>PaperNest 作为 MCP Server，供 Codex/Cursor 只读访问资料库与调研报告。需将 <code>papernest-mcp.exe</code> 与主程序放在同一目录。</p>
          <p><small>资料库：{mcpInfo.libraryPath}</small></p>
          <p><small>工具：{mcpInfo.tools.join("、")}</small></p>
          <div className="research-mcp-command">
            <code>{mcpInfo.command}</code>
            <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(mcpInfo.command)}><Copy size={14} />复制</button>
          </div>
        </div>
      )}
      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}
