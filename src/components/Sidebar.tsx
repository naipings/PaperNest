import { BookOpen, CalendarDays, Feather, Library, Moon, Network, RotateCcw, Settings, Sun, Trash2 } from "lucide-react";
import type { Profile } from "../types";

export type Screen = "library" | "tasks" | "knowledge" | "writing" | "trash" | "settings" | "reader";

export function Sidebar({ screen, onNavigate, profile, onTheme }: { screen: Screen; onNavigate(screen: Screen): void; profile: Profile; onTheme(): void }) {
  const items = [
    { id: "library" as const, label: "论文库", icon: Library },
    { id: "tasks" as const, label: "任务与日历", icon: CalendarDays },
    { id: "writing" as const, label: "写作资料库", icon: Feather },
    { id: "trash" as const, label: "回收站", icon: Trash2 },
    { id: "knowledge" as const, label: "本地知识树", icon: Network },
    { id: "settings" as const, label: "设置", icon: Settings }
  ];
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark"><BookOpen size={18} /></span><div><strong>PaperNest</strong><small>本地论文工作台</small></div></div>
    <nav>{items.map(({ id, label, icon: Icon }) => <button key={id} className={screen === id ? "active" : ""} onClick={() => onNavigate(id)}><Icon size={17} />{label}</button>)}</nav>
    <div className="sidebar-spacer" />
    <button className="theme-switch" onClick={onTheme}>{profile.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} 切换主题</button>
    <div className="profile-mini"><span>{profile.displayName.slice(0, 1)}</span><div><strong>{profile.displayName}</strong><small>{profile.researchField || "未填写研究方向"}</small></div></div>
  </aside>;
}

export function EmptyState({ icon = "library", title, description, action }: { icon?: "library" | "trash"; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state">{icon === "trash" ? <RotateCcw size={32} /> : <BookOpen size={32} />}<h3>{title}</h3><p>{description}</p>{action}</div>;
}
