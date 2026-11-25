import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
// components/Notify.jsx
//
// Pretty replacements for the browser's native alert() / confirm() popups
// ("127.0.0.1:8000 says …"). No provider to mount and no App.jsx change: the
// first call creates its own host element, so it works from any component,
// from async handlers, and keeps showing across route changes.
//
//   import { notify, formatApiError } from "../components/Notify";
//
//   notify.success("Draft saved", "Your progress has been saved.");
//   notify.error("Could not save", error.message);
//   notify.info(...) / notify.warning(...)
//
//   const ok = await notify.confirm({
//     title: "Delete this file?",
//     message: "It will be permanently removed.",
//     confirmLabel: "Delete",
//     danger: true,
//   });
//   if (!ok) return;

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./Notify.css";

// ── tiny store ────────────────────────────────────────────────────────────────
let toasts = [];            // [{ id, kind, title, message }]
let dialog = null;          // { title, message, confirmLabel, cancelLabel, danger, resolve }
let uid = 0;
let host = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

function ensureHost() {
    if (host || typeof document === "undefined") return;
    const el = document.createElement("div");
    el.id = "notify-root";
    document.body.appendChild(el);
    host = createRoot(el);
    host.render(<NotifyHost />);
}

function dismiss(id) {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}

function push(kind, title, message, duration) {
    ensureHost();
    const id = ++uid;
    toasts = [...toasts, { id, kind, title, message }];
    emit();
    const ms = duration ?? (kind === "error" ? 7000 : 4000);
    if (ms > 0) setTimeout(() => dismiss(id), ms);
    return id;
}

export const notify = {
    success: (title, message, opts) => push("success", title, message, opts?.duration),
    error: (title, message, opts) => push("error", title, message, opts?.duration),
    info: (title, message, opts) => push("info", title, message, opts?.duration),
    warning: (title, message, opts) => push("warning", title, message, opts?.duration),
    dismiss,
    /** Resolves true (confirmed) or false (cancelled / Esc / click outside). */
    confirm({ title = "Are you sure?", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
        ensureHost();
        return new Promise((resolve) => {
            if (dialog) dialog.resolve(false);      // only one dialog at a time
            dialog = { title, message, confirmLabel, cancelLabel, danger, resolve };
            emit();
        });
    },
};

/** FastAPI errors come as a string, or as a list of {loc, msg} (422). Make either readable. */
export function formatApiError(data, fallback = "Something went wrong.") {
    const d = data && typeof data === "object" && "detail" in data ? data.detail : data;
    if (typeof d === "string" && d.trim()) return d;
    if (Array.isArray(d) && d.length) {
        return d
            .map((e) => {
                const where = (e?.loc || []).filter((x) => x !== "body").join(" › ");
                return where ? `${where}: ${e.msg}` : e?.msg || String(e);
            })
            .join("\n");
    }
    return fallback;
}

// ── UI ────────────────────────────────────────────────────────────────────────
const ICONS = {
    success: <path d="M5 13l4 4L19 7" />,
    error: <path d="M12 8v5m0 3.5v.01M10.3 3.9L2.5 17.5A2 2 0 004.2 20.5h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
    warning: <path d="M12 8v5m0 3.5v.01M10.3 3.9L2.5 17.5A2 2 0 004.2 20.5h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
    info: <path d="M12 11v5m0-8.5v.01M12 21a9 9 0 100-18 9 9 0 000 18z" />,
};

function Icon({ kind }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[kind]}
        </svg>
    );
}

function ConfirmDialog({ d }) {
  useInterfaceLanguage();
    const finish = (value) => {
        dialog = null;
        emit();
        d.resolve(value);
    };

    useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") finish(false); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="nf-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) finish(false); }}>
            <div className="nf-dialog" role="alertdialog" aria-modal="true" aria-labelledby="nf-dialog-title">
                <h3 id="nf-dialog-title" className="nf-dialog-title">{__msg(d.title)}</h3>
                {d.message && <p className="nf-dialog-message">{__msg(d.message)}</p>}
                <div className="nf-dialog-actions">
                    <button type="button" className="nf-btn nf-btn-secondary" autoFocus={d.danger}
                        onClick={() => finish(false)}>
                        {__msg(d.cancelLabel)}
                    </button>
                    <button type="button" className={`nf-btn ${d.danger ? "nf-btn-danger" : "nf-btn-primary"}`}
                        autoFocus={!d.danger} onClick={() => finish(true)}>
                        {__msg(d.confirmLabel)}
                    </button>
                </div>
            </div>
        </div>
    );
}

function NotifyHost() {
  useInterfaceLanguage();
    const [, force] = useState(0);
    useEffect(() => {
        const fn = () => force((n) => n + 1);
        listeners.add(fn);
        fn(); // pick up anything pushed before this effect subscribed
        return () => listeners.delete(fn);
    }, []);

    return (
        <>
            <div className="nf-toasts" aria-live="polite">
                {toasts.map((t) => (
                    <div key={t.id} className={`nf-toast nf-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
                        <span className="nf-toast-icon"><Icon kind={t.kind} /></span>
                        <div className="nf-toast-body">
                            <strong>{__msg(t.title)}</strong>
                            {t.message && <p>{__msg(t.message)}</p>}
                        </div>
                        <button type="button" className="nf-toast-close" aria-label={__msg("Dismiss")} onClick={() => dismiss(t.id)}>×</button>
                    </div>
                ))}
            </div>
            {dialog && <ConfirmDialog d={dialog} />}
        </>
    );
}
