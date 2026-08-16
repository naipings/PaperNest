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
  | "mist-dark";

export const APPEARANCE_OPTIONS: { id: AppearanceId; label: string }[] = [
  { id: "workbench-system", label: "经典工作台 · 跟随系统" },
  { id: "workbench-light", label: "经典工作台 · 浅色" },
  { id: "workbench-dark", label: "经典工作台 · 深色" },
  { id: "lilac-system", label: "柔光紫仪表盘 · 跟随系统" },
  { id: "lilac-light", label: "柔光紫仪表盘 · 浅色" },
  { id: "lilac-dark", label: "柔光紫仪表盘 · 深色" },
  { id: "mist-system", label: "雾蓝日程面板 · 跟随系统" },
  { id: "mist-light", label: "雾蓝日程面板 · 浅色" },
  { id: "mist-dark", label: "雾蓝日程面板 · 深色" }
];

export function appearanceFromProfile(profile: Pick<Profile, "theme" | "visualTheme">): AppearanceId {
  const visual = profile.visualTheme ?? "workbench";
  return `${visual}-${profile.theme}` as AppearanceId;
}

export function applyAppearance(profile: Profile, appearance: AppearanceId): Profile {
  const [visualTheme, theme] = appearance.split("-") as [NonNullable<Profile["visualTheme"]>, Profile["theme"]];
  return { ...profile, visualTheme, theme };
}
