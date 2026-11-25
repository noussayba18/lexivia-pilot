import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * DataAnnotation.jsx — Data Annotation workspace
 *
 *   Enter page → automatically receive a sample → fill the annotation form
 *   → Submit & Next → automatically receive the next sample
 *
 * What is on screen is driven entirely by the server's assignment:
 *   - sample.assets  = the already-collected SampleAsset[] (read-only context)
 *   - tasks          = the CompetitionTask[] this annotator must fill on this sample
 *   - mode           = REGULAR | CONFLICT_RESOLUTION (extra annotator added to break a tie)
 *
 * Nothing here chooses the number of annotators, the task types or the labels: the
 * organizer's "annotators per sample" is applied by the server, and every field is
 * generated from the task's type and config. Partial submissions are always allowed.
 *
 * Each annotator's answers are stored separately by the server; this page can never
 * create or change the original sample data.
 *
 * "My answers" lists the samples this annotator already answered and lets them change their OWN
 * answers while the competition is open (e.g. to settle a tie). Nobody else's answers are editable.
 *
 * Team-wide statistics (sample statuses, conflicts, who annotated what) are NOT shown
 * here — they live on the Team Dataset page. Only the annotator's own progress remains.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CompetitionSidebar from "../components/CompetitionSidebar";
import { withPhaseGate } from "../components/PhaseGate";
import CompetitionTopbar from "../components/CompetitionTopbar";
import "../styles/DataCollection.css";
import "../styles/DataAnnotation.css";
import "../styles/dataCollectionRefresh.css";
import "../styles/annotationRefresh.css";
import { ArrowRight, ArrowUpRight, BookOpen, CheckCircle2, CircleHelp, Database, FileText, ListChecks, PenLine, ShieldCheck, Sparkles } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const STATUS_LABEL = {
  NOT_STARTED: "Not started",
  PARTIAL: "Partial",
  COMPLETED: "Completed",
  CONFLICT: "Conflict",
  CONFLICT_RESOLUTION: "Conflict resolution",
};

const PALETTE = ["#2BB8BF", "#F8B321", "#F26461", "#211F54", "#167985", "#B77C12", "#B94E50", "#7069A2"];
const colorFor = (labels, label) => PALETTE[Math.max(0, labels.indexOf(label)) % PALETTE.length];

const countWords = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;

/** Has the annotator filled this task's field (completely)? Mirrors the server. */
export function isAnswered(task, v) {
  if (!v) return false;
  switch (task.answer) {
    case "labels": return (v.labels || []).length > 0;
    case "spans": return (v.spans || []).length > 0 || !!v.none;
    case "qa": return !!(v.question || "").trim() && !!(v.answer || "").trim();
    default: return !!(v.text || "").trim();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only collected data
// ─────────────────────────────────────────────────────────────────────────────

function CollectedAsset({ asset }) {
  useInterfaceLanguage();
  return (
    <div className="da-asset">
      <p className="dc-field-label">{asset.name || asset.key} <span className="da-asset-kind">{asset.type}</span></p>
      {asset.kind === "audio" ? (
        asset.audio_url
          ? <audio controls aria-label={__msg("Listen to {value0}", {value0: asset.name || __msg("audio sample")})} src={asset.audio_url} style={{ width: "100%" }} />
          : <p className="da-muted">{__msg("Audio unavailable.")}</p>
      ) : (
        <div className="da-asset-text">{asset.text}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer fields — one per answer shape, configured by the task's config
// ─────────────────────────────────────────────────────────────────────────────

function LabelsField({ task, value, onChange }) {
  useInterfaceLanguage();
  const cfg = task.config || {};
  const selected = value?.labels || [];
  const multi = !!cfg.multi_label;
  const toggle = (l) => {
    if (!multi) return onChange({ labels: selected[0] === l ? [] : [l] });
    onChange({ labels: selected.includes(l) ? selected.filter((x) => x !== l) : [...selected, l] });
  };
  const hint = multi
    ? [cfg.min_labels != null && `at least ${cfg.min_labels}`, cfg.max_labels != null && `at most ${cfg.max_labels}`]
        .filter(Boolean).join(", ")
    : "choose one";
  return (
    <>
      <div className="dc-label-row" role="group" aria-label={task.name}>
        {(cfg.labels || []).map((l) => (
          <button key={l} type="button" className={`dc-label-tag ${selected.includes(l) ? "active" : ""}`} aria-pressed={selected.includes(l)} onClick={() => toggle(l)}>
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="da-muted" style={{ marginTop: 6 }}>{__msg(hint)}</p>}
    </>
  );
}

function TextField({ task, value, onChange }) {
  useInterfaceLanguage();
  const cfg = task.config || {};
  const text = value?.text || "";
  const words = countWords(text);
  const over = cfg.max_words != null && words > cfg.max_words;
  return (
    <>
      <textarea
        className="dc-textarea" aria-label={task.name} aria-invalid={over} rows={4} value={text}
        placeholder={cfg.language ? __msg("Write here ({value0})…", {value0: cfg.language}) : __msg("Write here…")}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      <div className="dc-textarea-footer">
        <span className={over ? "dc-over-limit" : ""}>
          {words}{cfg.max_words != null ? ` / ${cfg.max_words}` : ""}{" "}{__msg("words")}{" "}{cfg.min_words != null ? __msg(" · min {value0}", {value0: cfg.min_words}) : ""}
        </span>
      </div>
    </>
  );
}

function QaField({ task, value, onChange }) {
  useInterfaceLanguage();
  const fieldId = useId();
  const cfg = task.config || {};
  const v = value || {};
  const set = (k, x) => onChange({ ...v, [k]: x });
  return (
    <div className="cognitive-row">
      <div className="cognitive-field">
        <label htmlFor={`${fieldId}-question`} className="dc-field-label">{__msg("Question")}</label>
        <input id={`${fieldId}-question`} className="dc-input" type="text" value={v.question || ""} onChange={(e) => set("question", e.target.value)} />
      </div>
      <div className="cognitive-field">
        <label htmlFor={`${fieldId}-answer`} className="dc-field-label">{__msg("Answer")}{cfg.max_words != null ? __msg(" · max {value0} words", {value0: cfg.max_words}) : ""}</label>
        <input id={`${fieldId}-answer`} className="dc-input" type="text" value={v.answer || ""} onChange={(e) => set("answer", e.target.value)} />
      </div>
    </div>
  );
}

function SpansField({ task, value, onChange, targetAsset, targetText }) {
  useInterfaceLanguage();
  const cfg = task.config || {};
  const labels = cfg.span_labels || [];
  const spans = value?.spans || [];
  const none = !!value?.none;
  const [active, setActive] = useState(labels[0]);
  const [note, setNote] = useState("");
  const [markStart, setMarkStart] = useState(null);
  const textRef = useRef(null);
  const audioRef = useRef(null);
  const isAudio = targetAsset?.kind === "audio";
  const [k1, k2] = isAudio ? ["start_time", "end_time"] : ["start", "end"];

  const commit = (next) => { setNote(""); onChange({ spans: next, none: false }); };
  const overlaps = (a, b) => spans.some((s) => !(b <= s[k2] || a >= s[k1]));

  const addTextSpan = () => {
    const sel = window.getSelection();
    const box = textRef.current;
    if (!sel || sel.isCollapsed || !box) return;
    const range = sel.getRangeAt(0);
    if (!box.contains(range.commonAncestorContainer)) return;
    const pre = range.cloneRange();
    pre.selectNodeContents(box);
    pre.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString();
    const start = pre.toString().length + (raw.length - raw.trimStart().length);
    const end = start + raw.trim().length;
    if (end <= start) return;
    if (!cfg.allow_overlap && overlaps(start, end)) { setNote("Spans cannot overlap."); return; }
    commit([...spans, { start, end, label: active, text: targetText.slice(start, end) }]);
    sel.removeAllRanges();
  };

  const addAudioSpan = () => {
    const t = audioRef.current?.currentTime ?? 0;
    if (markStart == null) return setMarkStart(t);
    if (t <= markStart) { setNote("The end must be after the start."); return; }
    const a = +markStart.toFixed(2), b = +t.toFixed(2);
    setMarkStart(null);
    if (!cfg.allow_overlap && overlaps(a, b)) { setNote("Spans cannot overlap."); return; }
    commit([...spans, { start_time: a, end_time: b, label: active }]);
  };

  const remove = (i) => onChange({ spans: spans.filter((_, j) => j !== i), none: false });

  // Text with highlighted spans. The label badge is CSS-only, so the element's
  // text content stays identical to the source text and character offsets are exact.
  const renderText = () => {
    const parts = [];
    let cursor = 0;
    [...spans].sort((a, b) => a.start - b.start).forEach((s, i) => {
      const from = Math.max(cursor, s.start);
      if (from > cursor) parts.push(<span key={`p${i}`}>{targetText.slice(cursor, from)}</span>);
      if (s.end > from)
        parts.push(
          <mark key={`m${i}`} className="da-mark" data-label={s.label}
            style={{ background: `${colorFor(labels, s.label)}26`, borderBottomColor: colorFor(labels, s.label) }}>
            {targetText.slice(from, s.end)}
          </mark>
        );
      cursor = Math.max(cursor, s.end);
    });
    if (cursor < targetText.length) parts.push(<span key="tail">{targetText.slice(cursor)}</span>);
    return parts;
  };

  if (!targetAsset && targetText == null) return <p className="da-muted">{__msg("Nothing to annotate yet.")}</p>;

  return (
    <>
      <div className="dc-label-row" style={{ marginBottom: 10 }}>
        {labels.map((l) => (
          <button key={l} type="button" className="dc-label-tag" aria-pressed={active === l}
            style={active === l ? { background: `${colorFor(labels, l)}26`, border: `1.5px solid ${colorFor(labels, l)}` } : {}}
            onClick={() => setActive(l)}>
            {l}
          </button>
        ))}
      </div>

      {isAudio ? (
        <>
          {targetAsset.audio_url && <audio ref={audioRef} controls src={targetAsset.audio_url} style={{ width: "100%", marginBottom: 8 }} />}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <button type="button" className="dc-label-tag active" onClick={addAudioSpan}>
              {markStart == null ? __msg("▶ Mark start") : __msg("■ Mark end (started @ {value0}s)", {value0: markStart.toFixed(1)})}
            </button>
            {markStart != null && <button type="button" className="dc-label-tag" onClick={() => setMarkStart(null)}>{__msg("Cancel")}</button>}
          </div>
          <div className="da-timeline">
            {spans.map((s, i) => (
              <div key={i} className="da-timeline-span" title={`${s.label} ${s.start_time}s–${s.end_time}s`}
                style={{
                  left: `${(s.start_time / Math.max(targetAsset.duration || 1, 0.1)) * 100}%`,
                  width: `${Math.max(1, ((s.end_time - s.start_time) / Math.max(targetAsset.duration || 1, 0.1)) * 100)}%`,
                  background: `${colorFor(labels, s.label)}66`, borderColor: colorFor(labels, s.label),
                }} />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="da-muted" style={{ marginBottom: 6 }}>{__msg("Highlight a passage with the mouse to label it as “")}{active}”.</p>
          <div ref={textRef} className="da-asset-text da-selectable" onMouseUp={addTextSpan}>{renderText()}</div>
        </>
      )}

      {note && <p className="dc-over-limit" style={{ marginTop: 6 }}>{__msg(note)}</p>}

      {spans.length > 0 && (
        <div className="dc-label-row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {spans.map((s, i) => (
            <span key={i} className="da-chip" style={{ borderColor: colorFor(labels, s.label) }}>
              <b>{__msg(s.label)}</b>{" "}
              {isAudio ? `${s.start_time}s → ${s.end_time}s` : `“${s.text}”`}
              <button type="button" onClick={() => remove(i)} aria-label={__msg("Remove span")}>×</button>
            </span>
          ))}
        </div>
      )}

      <label className="dc-license-check" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={none} disabled={spans.length > 0}
          onChange={(e) => onChange({ spans: [], none: e.target.checked })} />{" "}{__msg("Nothing to mark here")}{" "}</label>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One task
// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({ task, assets, tasks, values, error, onChange }) {
  useInterfaceLanguage();
  const { target } = task;
  const targetAsset = target.type === "ASSET" ? assets.find((a) => a.key === target.ref) : null;
  const producer = target.type === "TASK_OUTPUT" ? tasks.find((t) => t.key === target.ref) : null;
  const producerText = producer ? values[producer.key]?.text || "" : null;

  // A task that works on another task's output waits until that output exists.
  const blocked = producer && !producerText.trim();

  const targetLabel = target.type === "SAMPLE" ? "the whole sample"
    : producer ? `the output of “${producer.name}”`
    : targetAsset ? targetAsset.name : "";

  let field;
  if (blocked) field = <p className="da-muted">{__msg("Complete “")}{producer.name}{__msg("” first.")}</p>;
  else if (task.answer === "labels") field = <LabelsField task={task} value={values[task.key]} onChange={onChange} />;
  else if (task.answer === "spans")
    field = (
      <SpansField task={task} value={values[task.key]} onChange={onChange}
        targetAsset={targetAsset}
        targetText={producer ? producerText : targetAsset?.text ?? null} />
    );
  else if (task.answer === "qa") field = <QaField task={task} value={values[task.key]} onChange={onChange} />;
  else field = <TextField task={task} value={values[task.key]} onChange={onChange} />;

  return (
    <div className={`da-task ${task.conflict ? "da-task-conflict" : ""}`}>
      <div className="da-task-head">
        <span className="da-task-name">{task.name}</span>
        {task.conflict && <span className="da-badge da-badge-conflict">{__msg("Conflict")}</span>}
        {isAnswered(task, values[task.key]) && <span className="da-badge da-badge-done"><CheckCircle2 size={12}/>{" "}{__msg("Filled")}</span>}
      </div>
      <p className="da-muted" style={{ margin: "0 0 10px" }}>
        {task.type.replace(/_/g, " ").toLowerCase()}{" "}{__msg("· applies to")}{" "}{targetLabel}
      </p>
      {task.instructions && <p className="da-instructions">{task.instructions}</p>}
      {field}
      {error && <p role="alert" className="dc-over-limit" style={{ marginTop: 8 }}>{__msg(error)}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────────────

function SidePanel({ stats }) {
  useInterfaceLanguage();
  const me = stats?.me;
  const total = stats?.totals?.total;
  const pct = total ? Math.min(100, Math.round(((me?.annotated || 0) / total) * 100)) : 0;
  return <aside className="dc-right-panel" aria-label={__msg("Annotation guidance and progress")}>
    <section className="dc-panel-card da-progress-card"><div className="dc-panel-header"><span className="dc-panel-label">{__msg("Your progress")}</span><Sparkles size={16}/></div>{me ? <><div className="da-progress-summary"><div className="da-progress-ring" style={{'--progress': `${pct}%`}} aria-label={__msg("{value0} of {value1} samples annotated", {value0: me.annotated, value1: total ?? __msg("unknown")})}><span><strong>{me.annotated ?? "—"}</strong><small>{__msg("annotated")}</small></span></div><div><strong>{me.remaining_for_me ?? "—"}</strong><span>{__msg("left for you")}</span></div></div><div className="da-mini-grid"><span>{__msg("Completed")}<b>{me.completed ?? "—"}</b></span><span>{__msg("Partial")}<b>{me.partial ?? "—"}</b></span><span>{__msg("Conflicts handled")}<b>{me.conflicts_handled ?? "—"}</b></span><span>{__msg("Conflicts resolved")}<b>{me.conflicts_resolved ?? "—"}</b></span></div></> : <p className="da-muted">{__msg("Your progress will appear when it is available.")}</p>}</section>
    <div className="da-privacy-note"><ShieldCheck size={17}/><span>{__msg("Your answers are saved separately. The original sample stays unchanged.")}</span></div>
  </aside>;
}

function Toast({ message, onDone }) {
  useInterfaceLanguage();
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  return <div className="dc-toast" role="status">{__msg(message)}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// My answers — revise what I already submitted
// ─────────────────────────────────────────────────────────────────────────────

export function RevisableSample({ item, editable, competitionId, onSaved, notify }) {
  useInterfaceLanguage();
  const [values, setValues] = useState(item.values || {});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const tasks = item.tasks;
  const assets = item.sample.assets;
  const conflict = item.sample.status === "CONFLICT" || item.sample.status === "CONFLICT_RESOLUTION";
  const changed = JSON.stringify(values) !== JSON.stringify(item.values || {});

  const setValue = (key, v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => { if (!prev[key]) return prev; const n = { ...prev }; delete n[key]; return n; });
  };

  const save = async () => {
    if (saving || !editable || !changed) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/competitions/${competitionId}/annotation/revise/${item.sample.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.detail?.errors) { setErrors(data.detail.errors); notify("⚠ Fix the highlighted answers."); return; }
        throw new Error(typeof data.detail === "string" ? data.detail : "Could not save your changes");
      }
      notify("✓ Your answers were updated");
      setOpen(false);
      onSaved();
    } catch (e) {
      notify(`⚠ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dc-widget" style={{ marginBottom: 16 }}>
      <div className="dc-widget-header">
        <div className="dc-doc-badge">
          <span className="dc-doc-icon"><PenLine size={20}/></span>
          <div><h2>{__msg("Sample #")}{item.sample.number}</h2><p>{__msg("Your saved annotations")}</p></div>
        </div>
        <span className={`da-status da-status-${item.sample.status}`}>{STATUS_LABEL[item.sample.status]}</span>
      </div>

      {conflict && (
        <div className="da-conflict">
          <p className="da-conflict-title"><CircleHelp size={17}/>{" "}{__msg("This sample is in conflict")}</p>
          <p>{__msg("The annotators ended in a tie. Changing your answer can settle it.")}</p>
        </div>
      )}

      <p className="da-section"><BookOpen size={14}/>{" "}{__msg("SOURCE MATERIAL")}{" "}<span>{__msg("Read only")}</span></p>
      {assets.map((a) => <CollectedAsset key={a.key} asset={a} />)}

      <p className="da-section"><ListChecks size={14}/>{" "}{__msg("YOUR ANSWERS")}</p>
      {tasks.map((t) => (
        open && editable ? (
          <TaskCard key={t.key} task={t} tasks={tasks} assets={assets} values={values}
            error={errors[t.key]} onChange={(v) => setValue(t.key, v)} />
        ) : (
          <div key={t.key} className="da-task">
            <div className="da-task-head"><span className="da-task-name">{t.name}</span></div>
            <p style={{ margin: 0 }}>{summarize(t, item.values?.[t.key])}</p>
          </div>
        )
      ))}
      {errors._form && <p role="alert" className="dc-over-limit">{errors._form}</p>}

      <div className="dc-widget-actions da-actions">
        {!editable && <span className="da-muted">{__msg("The competition is closed — answers can no longer be changed.")}</span>}
        {editable && !open && (
          <button type="button" className="dc-label-tag active" onClick={() => setOpen(true)}>{__msg("Revise my answer")}</button>
        )}
        {editable && open && (
          <>
            <button type="button" className="dc-label-tag" disabled={saving}
              onClick={() => { setValues(item.values || {}); setErrors({}); setOpen(false); }}>{__msg("Cancel")}</button>
            <button type="button" className="dc-commit-btn" disabled={saving || !changed} onClick={save}>
              {saving ? __msg("Saving…") : __msg("Save changes")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function summarize(task, value) {
  if (!value) return "—";
  if (task.answer === "labels") return (value.labels || []).join(", ") || "—";
  if (task.answer === "spans") return value.none ? "No spans" : `${(value.spans || []).length} span(s)`;
  if (task.answer === "qa") return `Q: ${value.question || ""} — A: ${value.answer || ""}`;
  return value.text || "—";
}

function MyAnswers({ competitionId, onChanged, notify }) {
  useInterfaceLanguage();
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/competitions/${competitionId}/annotation/mine?page=${page}&page_size=5`, { headers: authHeader() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Could not load your answers");
      setData(j);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [competitionId, page]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="dc-widget dc-placeholder">{__msg("Loading your answers…")}</div>;
  if (error) return <div className="dc-widget dc-placeholder da-empty"><p>{__msg(error)}</p></div>;
  if (data?.state && data.state !== "ok") return <div className="dc-widget dc-placeholder da-empty"><p>{__msg(data.message)}</p></div>;
  if (!data?.items?.length) {
    return <div className="dc-widget dc-placeholder da-empty"><p className="da-empty-title">{__msg("Nothing yet")}</p><p>{__msg("Samples you annotate will appear here so you can revise them.")}</p></div>;
  }

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {data.items.map((it) => (
        <RevisableSample key={`${it.sample.id}-${JSON.stringify(it.values)}`} item={it} editable={data.editable}
          competitionId={competitionId} notify={notify} onSaved={() => { load(); onChanged(); }} />
      ))}
      {data.pages > 1 && (
        <div className="da-actions" style={{ justifyContent: "center", gap: 12 }}>
          <button type="button" className="dc-label-tag" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>{__msg("Previous")}</button>
          <span className="da-muted">{__msg("Page")}{" "}{data.page}{" "}{__msg("of")}{" "}{data.pages}</span>
          <button type="button" className="dc-label-tag" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>{__msg("Next")}</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function DataAnnotation() {
  const params = useParams();
  const competitionId = params.id ?? params.competitionId;
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [assignment, setAssignment] = useState(null);   // server payload, or {state: ...}
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [values, setValues] = useState({});             // { [task.key]: answer }
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState("annotate");          // "annotate" | "mine"

  const loadStats = useCallback(() => {
    fetch(`${API}/competitions/${competitionId}/annotation/stats`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null)).then((s) => s && setStats(s)).catch(() => {});
  }, [competitionId]);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setValues({});
    setErrors({});
    try {
      const res = await fetch(`${API}/competitions/${competitionId}/annotation/next`, { headers: authHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setAssignment({ state: "error", message: typeof data.detail === "string" ? data.detail : "Could not load a sample." });
      else setAssignment(data);
    } catch {
      setAssignment({ state: "error", message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    if (!competitionId) return;
    fetch(`${API}/competitions/${competitionId}`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null)).then((c) => c && setTitle(c.title)).catch(() => {});
    loadNext();
    loadStats();
    const iv = setInterval(loadStats, 15_000);
    return () => clearInterval(iv);
  }, [competitionId, loadNext, loadStats]);

  const tasks = useMemo(() => assignment?.tasks || [], [assignment]);
  const assets = useMemo(() => assignment?.sample?.assets || [], [assignment]);
  const answered = tasks.filter((t) => isAnswered(t, values[t.key])).length;

  const setValue = (key, v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => { if (!prev[key]) return prev; const n = { ...prev }; delete n[key]; return n; });
  };

  const submit = async () => {
    if (submitting || loading || assignment?.state !== "assigned") return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/competitions/${competitionId}/annotation/${assignment.assignment_id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.detail?.errors) { setErrors(data.detail.errors); setToast("⚠ Fix the highlighted answers, or clear them to submit."); return; }
        if (res.status === 409) { setToast("This sample was already submitted."); await loadNext(); return; }
        throw new Error(typeof data.detail === "string" ? data.detail : "Submission failed");
      }
      setToast(
        data.status === "SKIPPED" ? "Nothing was filled in — the sample was released."
          : data.status === "PARTIAL" ? `Saved as partial — ${data.missing_fields.length} field(s) left empty.`
          : "✓ Annotation saved"
      );
      loadStats();
      await loadNext();
    } catch (e) {
      setToast(`⚠ ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return <DataAnnotationView model={{ competitionId, title, assignment, loading, stats, values, errors, submitting, toast, view, tasks, assets, answered }} actions={{ navigate, setView, setValue, submit, loadNext, loadStats, notify: setToast, clearToast: () => setToast(null) }} />;
}

export function DataAnnotationView({ model, actions, sidebar = null, answersPanel = null }) {
  useInterfaceLanguage();
  const { competitionId, title, assignment, loading, stats, values, errors, submitting, toast, view, tasks, assets, answered } = model;
  const { navigate, setView, setValue, submit, loadNext, loadStats, notify, clearToast } = actions;
  // ── main column ────────────────────────────────────────────────────────────
  const renderMain = () => {
    if (view === "mine") {
      return answersPanel || <MyAnswers competitionId={competitionId} onChanged={loadStats} notify={notify} />;
    }
    if (loading && !assignment) return <div role="status" className="dc-widget dc-placeholder da-empty"><ListChecks size={28}/><h2>{__msg("Finding a sample for you…")}</h2><p>{__msg("A fresh perspective is on its way.")}</p></div>;
    const s = assignment?.state;

    if (s === "assigned") {
      const resolving = assignment.mode === "CONFLICT_RESOLUTION";
      return (
        <div className="dc-widget">
          <div className="dc-widget-header">
            <div className="dc-doc-badge">
              <span className="dc-doc-icon"><PenLine size={20}/></span>
              <div><h2>{__msg("Sample #")}{assignment.sample.number}</h2><p>{__msg("Read closely. Add your perspective.")}</p></div>
            </div>
            <span className={`da-status da-status-${resolving ? "CONFLICT_RESOLUTION" : assignment.sample.status}`}>
              {resolving ? STATUS_LABEL.CONFLICT_RESOLUTION : STATUS_LABEL[assignment.sample.status]}
            </span>
          </div>

          {resolving && (
            <div className="da-conflict">
              <p className="da-conflict-title"><CircleHelp size={17}/>{" "}{__msg("Help resolve a disagreement")}</p>
              <p>{__msg("This sample has conflicting annotations.")}</p>
              {assignment.conflicts.map((c) => (
                <div key={c.task_key} className="da-conflict-task">
                  <p className="da-conflict-task-name">{__msg("Previous results —")}{" "}{c.task_name}</p>
                  {c.results.map((r, i) => (
                    <p key={i} className="da-conflict-row">
                      {r.summary} — {r.annotator}{r.name ? ` (${r.name})` : ""}
                    </p>
                  ))}
                </div>
              ))}
              <p>{__msg("Your annotation is required to help resolve this conflict.")}</p>
            </div>
          )}

          <p className="da-section"><BookOpen size={14}/>{" "}{__msg("SOURCE MATERIAL")}{" "}<span>{__msg("Read only")}</span></p>
          {assets.map((a) => <CollectedAsset key={a.key} asset={a} />)}

          <p className="da-section"><ListChecks size={14}/>{" "}{__msg("YOUR ANNOTATION")}</p>
          {assignment.tasks_already_covered > 0 && (
            <p className="da-muted" style={{ marginBottom: 10 }}>
              {__msg("Other tasks already covered: {count}",{count:assignment.tasks_already_covered})}{" "}</p>
          )}
          {tasks.map((t) => (
            <TaskCard key={t.key} task={t} tasks={tasks} assets={assets} values={values}
              error={errors[t.key]} onChange={(v) => setValue(t.key, v)} />
          ))}
          {errors._form && <p role="alert" className="dc-over-limit">{errors._form}</p>}

          <div className="dc-widget-actions da-actions">
            <span className="da-muted">
              {__msg("Fields completed: {done} of {total}",{done:answered,total:tasks.length})}{" "}{answered < tasks.length && __msg(" — you can still submit; it will be saved as partial.")}
            </span>
            <button type="button" className="dc-commit-btn" disabled={submitting || loading} onClick={submit}>
              {submitting ? __msg("Submitting…") : __msg("Submit & next")}<ArrowRight size={15}/>
            </button>
          </div>
        </div>
      );
    }

    const messages = {
      empty: ["You're all caught up", "There are no samples available for you right now. Samples may be waiting on other annotators, or already reserved."],
      not_configured: ["Annotation isn't set up yet", assignment?.message],
      no_tasks: ["No annotation tasks", assignment?.message],
      error: ["Something went wrong", assignment?.message],
    }[s] || ["Nothing to show", ""];
    return (
      <div className="dc-widget dc-placeholder da-empty">
        <span className="da-empty-icon"><CheckCircle2 size={28}/></span><h2 className="da-empty-title">{messages[0]}</h2>
        <p>{messages[1]}</p>
        {(s === "empty" || s === "error") && (
          <button type="button" className="dc-label-tag active" onClick={loadNext}>{__msg("Check again")}</button>
        )}
      </div>
    );
  };

  return (
    <div className="dc-shell dc-collection da-workspace">
      {sidebar || <CompetitionSidebar competitionId={competitionId} competitionTitle={title} />}

      <div className="dc-main">
        <CompetitionTopbar competitionId={competitionId} competitionTitle={title || "Competition"} status="LAB ACTIVE" showDatasetHub={false} />

        <main className="dc-body">
          <div className="dc-header"><div><span className="dc-eyebrow">{__msg("DATA LAB / ANNOTATE")}</span><h1 className="dc-title">{__msg("Give every sample meaning")}<span>.</span></h1><p className="dc-subtitle">{__msg("Read between the lines. Help build a dataset that understands.")}<br/>{assignment?.required_annotators ? __msg("Independent perspectives per sample: {count}", {count:assignment.required_annotators}) : __msg("Your own perspective makes a difference.")}</p></div><button type="button" className="dc-dataset-hub-btn" onClick={() => navigate(`/competitions/${competitionId}/team-dataset`)}><Database size={15}/>{__msg("Team Dataset")}<ArrowUpRight size={14}/></button></div>
          <div className="da-view-bar"><nav className="da-view-tabs" aria-label={__msg("Annotation views")}><button type="button" aria-current={view === "annotate" ? "page" : undefined} className={view === "annotate" ? "active" : ""} onClick={() => setView("annotate")}><PenLine size={14}/>{__msg("Annotate")}</button><button type="button" aria-current={view === "mine" ? "page" : undefined} className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}><FileText size={14}/>{__msg("My answers")}</button></nav><span className="da-view-hint">{view === "mine" ? __msg("Review and revise your saved answers") : __msg("One sample. Your perspective.")}</span></div>
          <div className="dc-content">
            <div className="dc-left">{renderMain()}</div>
            <SidePanel stats={stats?.configured ? stats : null} />
          </div>
        </main>
      </div>

      {toast && <Toast message={toast} onDone={clearToast} />}
    </div>
  );
}

export default withPhaseGate(DataAnnotation, "data-annotation");
