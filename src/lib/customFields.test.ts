import { describe, expect, it } from "vitest";
import type { CustomFieldDefinition } from "../types";
import { activeCustomFields, formatCustomFieldValue, optionsFromText, parseOptionLabels, tableCustomFields } from "./customFields";

const selectField: CustomFieldDefinition = {
  id: "f1",
  name: "阅读优先级",
  type: "select",
  options: [{ id: "high", label: "高", color: "#c45c6a" }],
  position: 1,
  showInTable: true,
};

describe("customFields", () => {
  it("filters archived definitions", () => {
    const items = activeCustomFields([
      selectField,
      { ...selectField, id: "f2", name: "旧字段", archivedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(items.map(item => item.id)).toEqual(["f1"]);
  });

  it("formats select and boolean values", () => {
    expect(formatCustomFieldValue(selectField, "high")).toBe("高");
    expect(formatCustomFieldValue({ ...selectField, type: "boolean" }, true)).toBe("是");
  });

  it("parses option labels from multiline text", () => {
    const options = parseOptionLabels("A\nB，C");
    expect(options.map(option => option.label)).toEqual(["A", "B", "C"]);
  });

  it("reuses option ids when labels stay the same", () => {
    const existing = [{ id: "opt-1", label: "高", color: "#7867c6" }];
    const options = optionsFromText(existing, "高\n低");
    expect(options[0].id).toBe("opt-1");
    expect(options[1].label).toBe("低");
    expect(options[1].id).not.toBe("opt-1");
  });

  it("keeps text fields out of table by default in helper", () => {
    const items = tableCustomFields([
      selectField,
      { ...selectField, id: "f-text", type: "text", showInTable: false },
    ]);
    expect(items.map(item => item.id)).toEqual(["f1"]);
  });
});
