import { useEffect, useMemo, useState } from "react";
import { Check, Globe2, LoaderCircle } from "lucide-react";
import { backend } from "../services/backend";
import {
  applyMetadataPatch,
  buildMetadataFieldRows,
  type MetadataFieldKey,
} from "../lib/onlineMetadataPatch";
import type { OnlineMetadataCandidate, Paper } from "../types";
import { Modal } from "./Modal";

export function OnlineMetadataConfirmModal({
  paper,
  candidates,
  cached,
  onClose,
  onSave,
}: {
  paper: Paper;
  candidates: OnlineMetadataCandidate[];
  cached?: boolean;
  onClose(): void;
  onSave(paper: Paper): Promise<void>;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [accepted, setAccepted] = useState<Set<MetadataFieldKey>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const candidate = candidates[selectedIndex];
  const rows = useMemo(
    () => (candidate ? buildMetadataFieldRows(paper, candidate) : []),
    [paper, candidate]
  );

  useEffect(() => {
    if (!candidate) return;
    setAccepted(new Set(rows.filter(row => row.defaultAccepted).map(row => row.key)));
    setNotice("");
  }, [selectedIndex, candidate, rows]);

  const toggle = (key: MetadataFieldKey) => {
    setAccepted(current => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const apply = async () => {
    if (!candidate || !accepted.size) {
      setNotice("请至少勾选一个要写入的字段。");
      return;
    }
    setBusy(true);
    try {
      await onSave(applyMetadataPatch(paper, candidate, accepted));
      onClose();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Crossref 元数据确认" onClose={onClose} wide>
      <div className="online-metadata-modal">
        {cached && <p className="inline-notice">本次结果来自本地缓存。</p>}
        {candidates.length > 1 && (
          <section className="metadata-candidate-list">
            <h3>选择候选条目</h3>
            <div className="metadata-candidate-options">
              {candidates.map((item, index) => (
                <label key={index} className={selectedIndex === index ? "active" : ""}>
                  <input
                    type="radio"
                    name="metadata-candidate"
                    checked={selectedIndex === index}
                    onChange={() => setSelectedIndex(index)}
                  />
                  <span>
                    <strong>{item.titleEn ?? "无标题"}</strong>
                    {item.doi && <small>DOI: {item.doi}</small>}
                    {item.venue && <small>{item.venue}</small>}
                    {typeof item.score === "number" && <small>匹配度 {item.score.toFixed(2)}</small>}
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}
        {candidate && (
          <section className="metadata-diff-table-wrap">
            <h3>字段差异</h3>
            <p className="settings-description">已有内容默认保留；勾选后才写入 Crossref 返回值。</p>
            {!rows.length ? (
              <p className="muted centered">候选条目与当前资料一致，没有可补全字段。</p>
            ) : (
              <table className="metadata-diff-table">
                <thead>
                  <tr>
                    <th>应用</th>
                    <th>字段</th>
                    <th>当前值</th>
                    <th>Crossref</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.key}>
                      <td>
                        <label className="checkbox-setting">
                          <input
                            type="checkbox"
                            checked={accepted.has(row.key)}
                            onChange={() => toggle(row.key)}
                          />
                        </label>
                      </td>
                      <td>{row.label}</td>
                      <td>{row.current}</td>
                      <td>{row.next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {notice && <p className="inline-notice">{notice}</p>}
        <footer className="modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={busy || !rows.length} onClick={() => void apply()}>
            <Check size={16} />
            {busy ? "保存中…" : "应用选中字段"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

export function OnlineMetadataFillButton({
  paper,
  onSave,
}: {
  paper: Paper;
  onSave(paper: Paper): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{ candidates: OnlineMetadataCandidate[]; cached?: boolean }>();

  const lookup = async () => {
    setBusy(true);
    setNotice("");
    try {
      const result = await backend.lookupOnlineMetadata(paper.id);
      if (!result.candidates.length) {
        setNotice("Crossref 未找到可用候选。");
        return;
      }
      setDialog({ candidates: result.candidates, cached: result.cached });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="online-metadata-action">
        <button className="secondary" disabled={busy} onClick={() => void lookup()}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Globe2 size={16} />}
          查找在线元数据
        </button>
        {notice && <small>{notice}</small>}
      </span>
      {dialog && (
        <OnlineMetadataConfirmModal
          paper={paper}
          candidates={dialog.candidates}
          cached={dialog.cached}
          onClose={() => setDialog(undefined)}
          onSave={onSave}
        />
      )}
    </>
  );
}
