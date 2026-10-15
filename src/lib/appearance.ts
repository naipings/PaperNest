import type { Profile } from "../types";

/** 设置页单一「主题」选项：界面风格 + 明暗 */
export type AppearanceId =
  | "workbench-system"
  | "workbench-light"
  | "workbench-dark"
  | "lilac-system"
  | "lilac-light"
  | "lilac-dark"
  | "mist-system"
  | "mist-light"
  | "mist-dark"
  | "willow-system"
  | "willow-light"
  | "willow-dark"
  | "black-dark";

export const APPEARANCE_OPTIONS: { id: AppearanceId; label: string }[] = [
  { id: "workbench-system", label: "标准 · 跟随系统" },
  { id: "workbench-light", label: "标准 · 浅色" },
  { id: "workbench-dark", label: "标准 · 深色" },
  { id: "lilac-system", label: "紫色 · 跟随系统" },
  { id: "lilac-light", label: "紫色 · 浅色" },
  { id: "lilac-dark", label: "紫色 · 深色" },
  { id: "mist-system", label: "蓝灰 · 跟随系统" },
  { id: "mist-light", label: "蓝灰 · 浅色" },
  { id: "mist-dark", label: "蓝灰 · 深色" },
  { id: "willow-system", label: "苔绿 · 跟随系统" },
  { id: "willow-light", label: "苔绿 · 浅色" },
  { id: "willow-dark", label: "苔绿 · 深色" },
  { id: "black-dark", label: "纯黑 · 夜间" }
];

export function appearanceFromProfile(profile: Pick<Profile, "theme" | "visualTheme">): AppearanceId {
  const visual = profile.visualTheme ?? "workbench";
  return `${visual}-${profile.theme}` as AppearanceId;
}

export function applyAppearance(profile: Profile, appearance: AppearanceId): Profile {
  const [visualTheme, theme] = appearance.split("-") as [NonNullable<Profile["visualTheme"]>, Profile["theme"]];
  return { ...profile, visualTheme, theme };
}
