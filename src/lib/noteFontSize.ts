import type { NoteFontSize } from "../types";

export const NOTE_FONT_PX: Record<NoteFontSize, { edit: number; preview: number }> = {
  sm: { edit: 13, preview: 14 },
  md: { edit: 15, preview: 16 },
  lg: { edit: 17, preview: 18 },
};

export function noteFontSize(value?: NoteFontSize): NoteFontSize {
  return value ?? "md";
}
