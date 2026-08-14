export type SelectionAnnotationType = "highlight" | "underline";

export function toolForCapturedSelection(title: string | undefined, hasCapturedSelection: boolean): SelectionAnnotationType | undefined {
  if (!hasCapturedSelection) return undefined;
  if (title === "高亮") return "highlight";
  if (title === "下划线") return "underline";
  return undefined;
}
