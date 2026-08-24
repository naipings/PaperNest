import { useState } from "react";
import { Archive, Plus, Save, SlidersHorizontal } from "lucide-react";
import { backend } from "../services/backend";
import { CUSTOM_FIELD_TYPE_LABELS, defaultShowInTable, optionsFromText } from "../lib/customFields";
import { useLibrary } from "../state/LibraryContext";
import type { CustomFieldDefinition, CustomFieldType } from "../types";
import { now, uuid } from "../types";

const FIELD_TYPES: CustomFieldType[] = ["text", "number", "date", "url", "boolean", "select", "multiselect"];

function blankDefinition(type: CustomFieldType = "text"): CustomFieldDefinition {
  return { id: uuid(), name: "", type, options: [], position: 0, showInTable: defaultShowInTable(type) };
}

export function CustomFieldsSettingsForm() {
  const { data, refresh } = useLibrary();
  const [draft, setDraft] = useState<CustomFieldDefinition | null>(null);
  const [optionText, setOptionText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!data) return null;

  const fields = data.customFieldDefinitions.filter(definition => !definition.archivedAt);

  const startCreate = () => {
    setDraft(blankDefinition());
    setOptionText("");
    setNotice("");
  };

  const startEdit = (definition: CustomFieldDefinition) => {
    setDraft({ ...definition, options: definition.options.map(option => ({ ...option })) });
    setOptionText(definition.options.map(option => option.label).join("\n"));
    setNotice("");
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const next: CustomFieldDefinition = {
        ...draft,
        options: draft.type === "select" || draft.type === "multiselect"
          ? optionsFromText(draft.options, optionText)
          : [],
      };
      const saved = await backend.saveCustomFieldDefinition(next);
      await refresh();
      setDraft(null);
      setOptionText("");
      setNotice(`自定义字段「${saved.name}」已保存。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const archive = async (definition: CustomFieldDefinition) => {
    const count = data.customFieldValues.filter(item => item.fieldId === definition.id).length;
    const message = count
      ? `归档「${definition.name}」后，${count} 篇论文上的该字段值会保留但不再显示。继续吗？`
      : `归档「${definition.name}」？`;
    if (!confirm(message)) return;
    setBusy(true);
    try {
      await backend.archiveCustomFieldDefinition(definition.id);
      await refresh();
      if (draft?.id === definition.id) setDraft(null);
      setNotice(`已归档「${definition.name}」。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-form custom-fields-settings">
      <h2><SlidersHorizontal size={19} />自定义元数据字段</h2>
      <p className="settings-description">
        为论文添加额外属性。导入、LLM 和 Crossref 只写固定核心字段；自定义字段在论文详情中手工填写。
      </p>

      <div className="custom-field-list">
        {fields.map(definition => (
          <article key={definition.id}>
            <div>
              <strong>{definition.name}</strong>
              <small>{CUSTOM_FIELD_TYPE_LABELS[definition.type]}{definition.showInTable ? " · 表格列" : " · 仅详情"}</small>
            </div>
            <div className="custom-field-list-actions">
              <button className="ghost" onClick={() => startEdit(definition)}>编辑</button>
              <button className="ghost" onClick={() => void archive(definition)}><Archive size={14} />归档</button>
            </div>
          </article>
        ))}
        {!fields.length && <p className="muted centered">还没有自定义字段</p>}
      </div>

      <button className="secondary" onClick={startCreate}><Plus size={16} />新增字段</button>

      {draft && (
        <div className="custom-field-editor">
          <h3>{fields.some(item => item.id === draft.id) ? "编辑字段" : "新增字段"}</h3>
          <label>
            显示名称
            <input value={draft.name} onChange={event => setDraft(current => current && { ...current, name: event.target.value })} placeholder="例如：阅读优先级" />
          </label>
          <label>
            类型
            <select
              value={draft.type}
              onChange={event => {
                const type = event.target.value as CustomFieldType;
                setDraft(current => current && { ...current, type, showInTable: defaultShowInTable(type), options: [] });
                setOptionText("");
              }}
            >
              {FIELD_TYPES.map(type => <option key={type} value={type}>{CUSTOM_FIELD_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          {(draft.type === "select" || draft.type === "multiselect") && (
            <label>
              选项（每行一个，或用逗号分隔）
              <textarea value={optionText} onChange={event => setOptionText(event.target.value)} rows={4} placeholder={"高\n中\n低"} />
            </label>
          )}
          <label className="checkbox-setting">
            <input type="checkbox" checked={draft.showInTable} onChange={event => setDraft(current => current && { ...current, showInTable: event.target.checked })} />
            在论文库表格中显示此列
          </label>
          <div className="modal-actions">
            <button className="ghost" onClick={() => setDraft(null)}>取消</button>
            <button className="primary" disabled={busy} onClick={() => void save()}><Save size={16} />保存字段</button>
          </div>
        </div>
      )}

      <div className="info-card">
        <SlidersHorizontal size={18} />
        <div>
          <strong>使用方式</strong>
          <ol className="metadata-guide-list">
            <li>在此定义字段名称和类型。</li>
            <li>打开论文详情，在「自定义字段」区域填写每篇论文的值。</li>
            <li>勾选「表格列」的字段会出现在论文库主表。</li>
          </ol>
        </div>
      </div>

      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}
