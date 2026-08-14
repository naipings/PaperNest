import { useEffect, useState } from "react";
import { Globe2, LoaderCircle, Save } from "lucide-react";
import { backend } from "../services/backend";
import { useLibrary } from "../state/LibraryContext";
import type { OnlineMetadataSettings } from "../types";

export function OnlineMetadataSettingsForm() {
  const { data, refresh } = useLibrary(); const [value, setValue] = useState<OnlineMetadataSettings>(); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  useEffect(() => { if (data) setValue(data.metadata); }, [data?.metadata]); if (!value) return null;
  const save = async () => { setBusy(true); try { await backend.saveOnlineMetadataSettings(value); await refresh(); setNotice(value.enabled ? "在线元数据补全已启用；查询只会在你点击论文详情中的按钮后进行。" : "在线元数据补全已关闭。"); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  return <section className="settings-form online-metadata-settings"><h2><Globe2 size={19} />在线元数据补全</h2><p className="settings-description">默认关闭。启用后，只有在论文详情中手动点击“查找在线元数据”时才会向 Crossref 查询 DOI 或标题；候选信息需确认，且只填补空字段。</p><label className="checkbox-setting"><input type="checkbox" checked={value.enabled} onChange={event => setValue(current => current && { ...current, enabled: event.target.checked })} />允许使用 Crossref 公开元数据接口</label><label>联系邮箱（可选，用于 Crossref 礼貌请求标识）<input type="email" value={value.mailto ?? ""} onChange={event => setValue(current => current && { ...current, mailto: event.target.value || undefined })} placeholder="name@example.com" /></label><button className="primary" disabled={busy} onClick={save}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存在线元数据设置</button><div className="info-card"><Globe2 size={18} /><div><strong>仅在你主动查询时联网</strong><p>不开启不会发起任何请求；不上传 PDF、批注、术语或 LLM 密钥。Crossref 返回的候选内容不会自动覆盖本地资料。</p></div></div>{notice && <p className="inline-notice">{notice}</p>}</section>;
}
