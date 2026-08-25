import { describe, expect, it } from "vitest";
import { folderSiblingNameTaken } from "./folders";
import type { Folder } from "../types";

const folders: Folder[] = [
  { id: "r1", name: "CS", position: 0, createdAt: "t", updatedAt: "t" },
  { id: "c1", name: "AAAI", parentId: "r1", position: 0, createdAt: "t", updatedAt: "t" },
];

describe("folderSiblingNameTaken", () => {
  it("rejects duplicate root names case-insensitively", () => {
    expect(folderSiblingNameTaken(folders, "cs")).toBe(true);
    expect(folderSiblingNameTaken(folders, "NCS", undefined, "r1")).toBe(false);
  });

  it("allows same name under different parents", () => {
    expect(folderSiblingNameTaken([...folders, { id: "r2", name: "AAAI", position: 0, createdAt: "t", updatedAt: "t" }], "AAAI", "r2")).toBe(false);
    expect(folderSiblingNameTaken(folders, "AAAI", "r1")).toBe(true);
  });
});
