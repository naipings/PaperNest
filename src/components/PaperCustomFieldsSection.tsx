import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { activeCustomFields, emptyCustomFieldValue, formatCustomFieldValue, isEmptyCustomFieldValue, valuesForPaper } from "../lib/customFields";
import { useLibrary } from "../state/LibraryContext";
import type { CustomFieldDefinition, CustomFieldValue, Paper } from "../types";
import { now } from "../types";

function FieldInput({
  definition,
  value,
  onChange,
}: {
  definition: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  onChange(value: CustomFieldValue): void;
}) {
  if (definition.type === "boolean") {
    return (
      <label className="checkbox-setting custom-field-boolean">
        <input type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
        {value ? "是" : "否"}
      </label>
    );
  }
  if (definition.type === "select") {
    return (
      <select value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value || null)}>
        <option value="">—</option>
        {definition.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    );
  }
  if (definition.type === "multiselect") {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <div className="custom-field-multiselect">
        {definition.options.map(option => (
          <label key={option.id} className="checkbox-setting">
            <input
              type="checkbox"
              checked={selected.has(option.id)}
              onChange={event => {
                const next = new Set(selected);
                event.target.checked ? next.add(option.id) : next.delete(option.id);
                onChange([...next]);
              }}
            />
            <span className="category" style={{ "--tag-color": option.color } as React.CSSProperties}>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }
  if (definition.type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={event => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    );
  }
  const inputType = definition.type === "date" ? "date" : definition.type === "url" ? "url" : "text";
  const multiline = definition.type === "text";
  if (multiline) {
    return <textarea rows={3} value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value)} />;
  }
  return <input type={inputType} value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value)} />;
}

export function PaperCustomFieldsSection({ paper }: { paper: Paper }) {
  const { data, savePaperCustomFieldValues } = useLibrary();
  const fields = useMemo(() => activeCustomFields(data?.customFieldDefinitions ?? []), [data?.customFieldDefinitions]);
  const [draft, setDraft] = useState<Record<string, CustomFieldValue | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const current = valuesForPaper(data?.customFieldValues ?? [], paper.id);
    const next: Record<string, CustomFieldValue | undefined> = {};
    for (const field of fields) {
      next[field.id] = current.get(field.id) ?? emptyCustomFieldValue(field.type);
    }
    setDraft(next);
    setNotice("");
  }, [paper.id, data?.customFieldValues, fields]);

  if (!fields.length) return null;

  const save = async () => {
    setBusy(true);
    try {
      const timestamp = now();
      const values = fields.map(field => {
        const value = draft[field.id];
        return {
          paperId: paper.id,
          fieldId: field.id,
          value: isEmptyCustomFieldValue(field.type, value) ? null : (value as CustomFieldValue),
          updatedAt: timestamp,
        };
      });
      await savePaperCustomFieldValues(paper.id, values);
      setNotice("自定义字段已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="custom-fields-card">
      <header>
        <h3>自定义字段</h3>
        <button className="secondary" disabled={busy} onClick={() => void save()}><Save size={15} />保存</button>
      </header>
      <dl className="metadata custom-fields-grid">
        {fields.map(field => (
          <div key={field.id}>
            <dt>{field.name}</dt>
            <dd>
              <FieldInput
                definition={field}
                value={draft[field.id]}
                onChange={value => setDraft(current => ({ ...current, [field.id]: value }))}
              />
              {field.type === "text" && typeof draft[field.id] === "string" && draft[field.id] && (
                <small className="muted">预览：{formatCustomFieldValue(field, draft[field.id])}</small>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {notice && <p className="inline-notice">{notice}</p>}
    </section>
  );
}
