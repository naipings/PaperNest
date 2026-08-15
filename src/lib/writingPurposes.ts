/** Built-in writing-purpose labels; user-defined purposes are merged from excerpts. */
export const DEFAULT_WRITING_PURPOSES = ["研究背景", "问题陈述", "方法描述", "实验分析", "对比", "局限", "待分类"] as const;

export function writingPurposeLabels(excerpts: { purpose: string }[]) {
  const seen = new Set<string>(DEFAULT_WRITING_PURPOSES);
  const extra: string[] = [];
  for (const item of excerpts) {
    const purpose = item.purpose.trim();
    if (!purpose || seen.has(purpose)) continue;
    seen.add(purpose);
    extra.push(purpose);
  }
  return [...DEFAULT_WRITING_PURPOSES, ...extra];
}
