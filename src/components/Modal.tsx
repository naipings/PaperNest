import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className={`modal ${wide ? "modal-wide" : ""}`} onMouseDown={e => e.stopPropagation()}>
    <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>{children}
  </section></div>;
}
