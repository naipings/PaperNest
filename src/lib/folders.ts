import type { Folder } from "../types";

export function folderSiblingNameTaken(folders: Folder[], name: string, parentId?: string, excludeId?: string) {
  const key = name.trim().toLowerCase();
  return folders.some(item =>
    item.id !== excludeId
    && (item.parentId ?? undefined) === (parentId ?? undefined)
    && item.name.trim().toLowerCase() === key
  );
}

/** Matching folders plus their ancestors. `undefined` means the query is empty and every folder stays visible. */
export function folderIdsVisibleForQuery(folders: Folder[], query: string): Set<string> | undefined {
  const key = query.trim().toLowerCase();
  if (!key) return undefined;
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const visible = new Set<string>();
  for (const folder of folders) {
    if (!folder.name.toLowerCase().includes(key)) continue;
    visible.add(folder.id);
    let parentId = folder.parentId;
    while (parentId) {
      visible.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }
  return visible;
}
