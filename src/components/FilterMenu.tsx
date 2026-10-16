import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = groups.flatMap(group => group.options).find(option => option.id === value);
  useEffect(() => {
    if (!open) return;
    const options = root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]');
    (Array.from(options).find(option => option.getAttribute("aria-selected") === "true") ?? options[0])?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  return <div className={"filter-menu" + (open ? " open" : "")} ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current!.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!open) { setOpen(true); return; }
        const options = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'));
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      }
    }}>
    <button ref={trigger} type="button" className="filter-menu-trigger" title={current?.label} aria-haspopup="listbox" aria-controls={open ? listId : undefined} aria-expanded={open} onClick={() => setOpen(next => !next)}>
      {icon}<span>{current?.label ?? "筛选"}</span><ChevronDown size={14} />
    </button>
    {open && <div className="filter-menu-panel" id={listId} role="listbox" aria-label={current?.label ?? "筛选"}>
      {groups.map((group, index) => (
        <div className="filter-menu-group" key={group.title ?? index}>
          {group.title && <small>{group.title}</small>}
          {group.options.map(option => (
            <button type="button" role="option" tabIndex={-1} aria-selected={option.id === value} className={option.id === value ? "active" : ""} key={option.id} onClick={() => { onChange(option.id); setOpen(false); trigger.current!.focus(); }}>{option.label}</button>
          ))}
        </div>
      ))}
    </div>}
  </div>;
}
