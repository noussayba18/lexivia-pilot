import { t, getLanguage } from '../i18n/index.js';
import { relativeTime, duration } from '../i18n/format.js';
/**
 * Shared helpers for the Dataset Hub (list page + dataset detail page).
 */

export const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet(path) {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    let msg = `Server returned ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
    } catch {
      /* keep default message */
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function saveResponse(res, fallbackName) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const cd = res.headers.get("content-disposition") || "";
  const match = cd.match(/filename="?([^"]+)"?/);

  a.href = url;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportError(res) {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    /* keep default message */
  }
  return "Export failed";
}

/**
 * Global hub export (closed competitions).
 * includeAudio → the server answers with a .zip: the data file + the audio files it points to.
 */
export async function downloadExport(competitionId, format, { includeAudio = false } = {}) {
  const qs = new URLSearchParams({ format });
  if (includeAudio) qs.set("include_audio", "true");
  const res = await fetch(`${API}/datasets/hub/${competitionId}/export?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await exportError(res));
  await saveResponse(res, includeAudio ? "dataset.zip" : `dataset.${format}`);
}

/**
 * Team / solo dataset export (the live dataset of a running competition).
 * samples: "final" (completed samples only, default) | "all"
 */
export async function downloadTeamExport(
  competitionId,
  format,
  { includeAudio = false, samples = "final", view = null } = {}
) {
  const qs = new URLSearchParams({ format, samples });
  if (includeAudio) qs.set("include_audio", "true");
  if (view) qs.set("view", view);
  const res = await fetch(`${API}/competitions/${competitionId}/dataset/export?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await exportError(res));
  await saveResponse(res, includeAudio ? "dataset.zip" : `dataset.${format}`);
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function formatDuration(sec) { return duration(sec); }

export function formatClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${r}`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(document.documentElement.lang, { year: "numeric", month: "short", day: "numeric" });
}

export function timeAgo(iso) { return relativeTime(iso); }

// ── Task / asset display metadata ────────────────────────────────────────────

export const TASK_LABELS = {
  TRANSCRIPTION: "Transcription",
  CLASSIFICATION: "Classification",
  SPAN_ANNOTATION: "Span annotation",
  TRANSLATION: "Translation",
  SUMMARIZATION: "Summarization",
  QUESTION_ANSWERING: "Question answering",
  FREE_TEXT: "Free-text annotation",
};

export function taskLabel(type, fallback) {
  return (
    (TASK_LABELS[type] && t(TASK_LABELS[type])) ||
    fallback ||
    String(type || "")
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

// Stable colour per label so the same label looks the same everywhere.
const LABEL_COLORS = [
  { bg: "var(--lx-navy-soft, #eef2ff)", text: "var(--lx-ink, #4338ca)", solid: "#6366f1" },
  { bg: "var(--lx-coral-soft, #fff0f6)", text: "var(--lx-coral, #be185d)", solid: "#ec4899" },
  { bg: "var(--lx-teal-soft, #e6fcf5)", text: "var(--lx-ink, #047857)", solid: "#10b981" },
  { bg: "var(--lx-teal-soft, #fff7ed)", text: "var(--lx-gold, #c2410c)", solid: "#f97316" },
  { bg: "var(--lx-teal-soft, #ecfeff)", text: "var(--lx-ink, #0e7490)", solid: "#06b6d4" },
  { bg: "var(--lx-teal-soft, #f5f3ff)", text: "var(--lx-coral, #6d28d9)", solid: "#8b5cf6" },
  { bg: "var(--lx-teal-soft, #fefce8)", text: "var(--lx-gold, #a16207)", solid: "#eab308" },
  { bg: "var(--lx-coral-soft, #fef2f2)", text: "var(--lx-coral, #b91c1c)", solid: "#ef4444" },
];

export function labelColor(label) {
  let h = 0;
  for (const ch of String(label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}