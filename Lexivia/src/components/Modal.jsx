import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useRef } from "react";
import "../styles/Modal.css";

/**
 * Shared modal: overlay + panel + title + close (✕ / Esc / click outside).
 * Used by the join dialog and the organizer dashboard's detail views.
 */
export default function Modal({ title, subtitle, onClose, dismissible = true, wide = false, children, footer = null, className = "" }) {
  useInterfaceLanguage();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = () => { if (dismissible) onClose(); };
  useEffect(() => {
    const previousFocus = document.activeElement;
    const focusables = () => Array.from(panelRef.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(el => el.getClientRects().length);
    panelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); }
      if (e.key === "Tab") {
        const list = focusables();
        const first = list[0], last = list[list.length - 1];
        if (!first) { e.preventDefault(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div ref={panelRef} tabIndex={-1} className={`modal-panel ${wide ? "modal-wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>{__msg(title)}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={!dismissible} aria-label={__msg("Close")}>✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
