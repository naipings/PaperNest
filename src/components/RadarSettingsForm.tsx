import { useEffect, useMemo, useState } from "react";
import { Radar as RadarIcon, LoaderCircle, Save } from "lucide-react";
import { backend, isTauri } from "../services/backend";
import type { RadarSettings } from "../types";

const DEFAULT: RadarSettings = {
  enabled: false,
  categories: ["cs.LG", "cs.CL", "cs.CV", "cs.AI", "cs.IR"],
  keywords: [],
  defaultFilterEnabled: true,
  hotLimit: 30,
  newLimit: 100,
  retainDays: 90,
};

export function RadarSettingsForm() {
  const [value, setValue] = useState<RadarSettings>(DEFAULT);
  const [keywordText, setKeywordText] = useState("");
  const [catalog, setCatalog] = useState<[string, string][]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    void Promise.all([backend.radarGetSettings(), backend.radarCategoryCatalog()])
      .then(([settings, cats]) => {
        setValue({
          ...DEFAULT,
          ...settings,
          keywords: settings.keywords ?? [],
          defaultFilterEnabled: settings.defaultFilterEnabled ?? true,
        });
        setKeywordText((settings.keywords ?? []).join("\n"));
        setCatalog(cats.map(([id, name]) => [id, name]));
      })
      .catch(error => setNotice(error instanceof Error ? error.message : String(error)));
  }, []);

  const toggleCategory = (id: string) => {
    setValue(current => {
      const has = current.categories.includes(id);
      return {
        ...current,
        categories: has ? current.categories.filter(item => item !== id) : [...current.categories, id],
      };
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const keywords = keywordText
        .split(/[\n,，;；]+/)
        .map(item => item.trim())
        .filter(Boolean);
      const saved = await backend.radarSaveSettings({ ...value, keywords });
      setValue(saved);
      setKeywordText((saved.keywords ?? []).join("\n"));
      setNotice(saved.enabled ? "论文雷达已启用。" : "论文雷达已关闭。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const labels = useMemo(() => Object.fromEntries(catalog), [catalog]);

  return (
    <section className="settings-form radar-settings">
      <h2><RadarIcon size={19} />论文雷达</h2>
      <p className="settings-description">
        默认关闭。启用后，在「论文雷达」页点击「推荐今日论文」联网采集：Hot（alphaxiv）+ New（订阅类目日窗）+ Interest（关键词查询）。发现期只保存元数据；界面默认按类目与关键词过滤展示。
      </p>
      {!isTauri() && <p className="inline-notice">浏览器预览模式不支持论文雷达联网功能。</p>}
      <label className="checkbox-setting">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={event => setValue(current => ({ ...current, enabled: event.target.checked }))}
        />
        启用论文雷达
      </label>
      <label>
        联系邮箱（用于 arXiv 礼貌请求标识）
        <input
          type="email"
          value={value.mailto ?? ""}
          onChange={event => setValue(current => ({ ...current, mailto: event.target.value || undefined }))}
          placeholder="name@example.com"
        />
      </label>
      <label className="checkbox-setting">
        <input
          type="checkbox"
          checked={value.defaultFilterEnabled ?? true}
          onChange={event => setValue(current => ({ ...current, defaultFilterEnabled: event.target.checked }))}
        />
        雷达页默认启用兴趣过滤
      </label>
      <label>
        兴趣关键词（每行一个，如 agent、agent memory、agent skill）
        <textarea
          rows={4}
          value={keywordText}
          onChange={event => setKeywordText(event.target.value)}
          placeholder={"agent\nagent memory\nagent skill"}
        />
      </label>
      <fieldset className="radar-category-fieldset">
        <legend>订阅 arXiv 类目（New / Interest 召回 + 兴趣过滤）</legend>
        <div className="radar-category-grid">
          {(catalog.length ? catalog : value.categories.map(id => [id, labels[id] || id] as [string, string])).map(([id, name]) => (
            <label key={id} className="checkbox-setting">
              <input type="checkbox" checked={value.categories.includes(id)} onChange={() => toggleCategory(id)} />
              <span>{id} · {name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="radar-limit-row">
        <label>热点条数<input type="number" min={5} max={100} value={value.hotLimit} onChange={e => setValue(v => ({ ...v, hotLimit: Number(e.target.value) || 30 }))} /></label>
        <label>新稿条数<input type="number" min={5} max={200} value={value.newLimit} onChange={e => setValue(v => ({ ...v, newLimit: Number(e.target.value) || 100 }))} /></label>
        <label>快照保留天数<input type="number" min={7} max={365} value={value.retainDays} onChange={e => setValue(v => ({ ...v, retainDays: Number(e.target.value) || 90 }))} /></label>
      </div>
      <button className="primary" disabled={busy || !isTauri()} onClick={() => void save()}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
        保存论文雷达设置
      </button>
      <div className="info-card">
        <RadarIcon size={18} />
        <div>
          <strong>使用步骤</strong>
          <ol className="metadata-guide-list">
            <li>在此页启用并保存。</li>
            <li>打开侧栏「论文雷达」。</li>
            <li>点击「推荐今日论文」开始采集。</li>
          </ol>
        </div>
      </div>
      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}
