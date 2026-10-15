import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLElement>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (Array.from(document.querySelectorAll('.modal[role="dialog"]')).at(-1) !== dialogRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(element => !element.hidden && element.getAttribute("type") !== "hidden");
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={event => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={() => onCloseRef.current()} aria-label="关闭"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body
  );
}
