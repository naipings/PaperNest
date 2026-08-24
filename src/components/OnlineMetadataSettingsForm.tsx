import { useEffect, useState } from "react";
import { Globe2, LoaderCircle, Save } from "lucide-react";
import { backend } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import type { OnlineMetadataSettings } from "../types";

export function OnlineMetadataSettingsForm() {
  const { data, refresh } = useLibrary();
  const [value, setValue] = useState<OnlineMetadataSettings>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (data) setValue(data.metadata);
  }, [data?.metadata]);

  if (!value) return null;

  const save = async () => {
    setBusy(true);
    try {
      await backend.saveOnlineMetadataSettings(value);
      await refresh();
      setNotice(value.enabled ? "在线元数据补全已启用。" : "在线元数据补全已关闭。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-form online-metadata-settings">
      <h2><Globe2 size={19} />在线元数据补全</h2>
      <p className="settings-description">
        默认关闭。启用后，在论文详情中手动点击「查找在线元数据」才会向 Crossref 查询；导入 PDF 时不会自动联网。
      </p>
      <label className="checkbox-setting">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={event => setValue(current => current && { ...current, enabled: event.target.checked })}
        />
        允许使用 Crossref 公开元数据接口
      </label>
      <label>
        联系邮箱（可选，用于 Crossref 礼貌请求标识）
        <input
          type="email"
          value={value.mailto ?? ""}
          onChange={event => setValue(current => current && { ...current, mailto: event.target.value || undefined })}
          placeholder="name@example.com"
        />
      </label>
      <button className="primary" disabled={busy} onClick={() => void save()}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
        保存在线元数据设置
      </button>

      <div className="info-card">
        <Globe2 size={18} />
        <div>
          <strong>使用步骤</strong>
          <ol className="metadata-guide-list">
            <li>在此页开启 Crossref，并保存设置。</li>
            <li>打开论文库，选中一篇论文，进入右侧「论文详情」。</li>
            <li>在概览页点击「查找在线元数据」。</li>
            <li>在确认面板勾选要写入的字段，然后应用。</li>
          </ol>
        </div>
      </div>

      <div className="info-card">
        <Globe2 size={18} />
        <div>
          <strong>适用场景</strong>
          <ul className="metadata-guide-list">
            <li>PDF 导入后标题、作者、期刊或 DOI 缺失。</li>
            <li>论文已有 DOI，需要补全正式发表信息。</li>
            <li>只有英文标题，需要检索 Crossref 候选条目。</li>
          </ul>
        </div>
      </div>

      <div className="info-card">
        <Globe2 size={18} />
        <div>
          <strong>联网范围</strong>
          <p>关闭时不会发起任何 Crossref 请求。开启后也只在你点击按钮时查询；不上传 PDF、批注、术语或 LLM 密钥。查询结果会缓存在本地，避免重复请求。</p>
        </div>
      </div>

      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}
