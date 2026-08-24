import type { CustomFieldDefinition, CustomFieldOption, CustomFieldValue, PaperCustomFieldValue } from "../types";

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldDefinition["type"], string> = {
  text: "文本",
  number: "数字",
  date: "日期",
  url: "链接",
  boolean: "是 / 否",
  select: "单选",
  multiselect: "多选",
};

export function defaultShowInTable(type: CustomFieldDefinition["type"]) {
  return type !== "text";
}

export function activeCustomFields(definitions: CustomFieldDefinition[]) {
  return definitions.filter(definition => !definition.archivedAt).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "zh-CN"));
}

export function tableCustomFields(definitions: CustomFieldDefinition[]) {
  return activeCustomFields(definitions).filter(definition => definition.showInTable);
}

export function valuesForPaper(values: PaperCustomFieldValue[], paperId: string) {
  return new Map(values.filter(item => item.paperId === paperId).map(item => [item.fieldId, item.value]));
}

export function formatCustomFieldValue(definition: CustomFieldDefinition, value: CustomFieldValue | undefined) {
  if (value == null || value === "") return "—";
  if (definition.type === "boolean") return value === true ? "是" : value === false ? "否" : "—";
  if (definition.type === "multiselect") {
    const ids = Array.isArray(value) ? value : [];
    const labels = ids.map(id => definition.options.find(option => option.id === id)?.label ?? id);
    return labels.length ? labels.join("、") : "—";
  }
  if (definition.type === "select") {
    const id = typeof value === "string" ? value : "";
    return definition.options.find(option => option.id === id)?.label ?? id ?? "—";
  }
  return String(value);
}

export function parseOptionLabels(raw: string): CustomFieldOption[] {
  return optionsFromText([], raw);
}

export function optionsFromText(existing: CustomFieldOption[], raw: string): CustomFieldOption[] {
  const labels = raw.split(/[\n,，;；]/).map(part => part.trim()).filter(Boolean);
  const used = new Set<string>();
  return labels.map(label => {
    const found = existing.find(option => option.label === label && !used.has(option.id));
    if (found) {
      used.add(found.id);
      return found;
    }
    return { id: crypto.randomUUID(), label, color: "#7867c6" };
  });
}

export function emptyCustomFieldValue(type: CustomFieldDefinition["type"]): CustomFieldValue {
  if (type === "boolean") return false;
  if (type === "multiselect") return [];
  if (type === "number") return null;
  return "";
}

export function isEmptyCustomFieldValue(type: CustomFieldDefinition["type"], value: CustomFieldValue | undefined) {
  if (value == null) return true;
  if (type === "boolean") return false;
  if (type === "multiselect") return !Array.isArray(value) || value.length === 0;
  if (type === "number") return value === "" || value == null;
  return String(value).trim() === "";
}
