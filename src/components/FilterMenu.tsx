import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type FilterOption = { id: string; label: string };
export type FilterGroup = { title?: string; options: FilterOption[] };

export function FilterMenu({ icon, value, groups, onChange }: {
  icon?: ReactNode;
  value: string;
  groups: FilterGroup[];
  onChange(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = groups.flatMap(group => group.options).find(option => option.id === value);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return <div className={"filter-menu" + (open ? " open" : "")} ref={root}>
    <button type="button" className="filter-menu-trigger" aria-expanded={open} onClick={() => setOpen(next => !next)}>
      {icon}<span>{current?.label ?? "筛选"}</span><ChevronDown size={14} />
    </button>
    {open && <div className="filter-menu-panel" role="listbox">
      {groups.map((group, index) => (
        <div className="filter-menu-group" key={group.title ?? index}>
          {group.title && <small>{group.title}</small>}
          {group.options.map(option => (
            <button type="button" role="option" aria-selected={option.id === value} className={option.id === value ? "active" : ""} key={option.id} onClick={() => { onChange(option.id); setOpen(false); }}>{option.label}</button>
          ))}
        </div>
      ))}
    </div>}
  </div>;
}
