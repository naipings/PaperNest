import type { Folder } from "../types";

export function folderSiblingNameTaken(folders: Folder[], name: string, parentId?: string, excludeId?: string) {
  const key = name.trim().toLowerCase();
  return folders.some(item =>
    item.id !== excludeId
    && (item.parentId ?? undefined) === (parentId ?? undefined)
    && item.name.trim().toLowerCase() === key
  );
}
