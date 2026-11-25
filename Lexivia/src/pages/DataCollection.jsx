import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * DataCollection.jsx — Create Sample
 *
 * This page does exactly one thing: collect one new sample and submit it.
 *
 *     Create Sample  →  Submit
 *
 * The form is generated from the competition's DataComponent[] (returned by
 * GET /competitions/{id} as `assets`). There is no competition type and no
 * task-specific form; no annotation happens here.
 *
 *     DataComponent = defines the expected asset (type + constraints)
 *     SampleAsset   = the actual asset collected in the sample
 *
 * Each DataComponent renders one field, validated against its own constraints:
 *     TEXT   → text box        (min_words / max_words)
 *     AUDIO  → record / upload (min/max duration, allowed formats)
 * A new asset type needs one entry in ASSET_FIELDS below, nothing else.
 *
 * Submission → POST /competitions/{id}/samples (multipart). The server checks
 * the same constraints again and stores one Sample with one SampleAsset per
 * collected component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CompetitionSidebar from "../components/CompetitionSidebar";
import { withPhaseGate } from "../components/PhaseGate";
import CompetitionTopbar from "../components/CompetitionTopbar";
import "../styles/DataCollection.css";
import "../styles/dataCollectionRefresh.css";
import { ArrowUpRight, ArrowRight, Database, FilePlus2, FileText, Mic, UploadCloud, ShieldCheck, Sparkles } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const countWords = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
const fileExt = (name) => (name?.split(".").pop() || "").toLowerCase();

function parseConfig(c) {
  if (!c) return {};
  if (c.task_config && typeof c.task_config === "object") return c.task_config;
  try {
    const raw = typeof c.dataset_config === "string" ? JSON.parse(c.dataset_config) : c.dataset_config;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Human-readable summary of a component's constraints, e.g. "max 10 s · wav, mp3". */
function describeConstraints(kind, c = {}) {
  const parts = [];
  if (kind === "text") {
    if (c.min_words != null) parts.push(`min ${c.min_words} words`);
    if (c.max_words != null) parts.push(`max ${c.max_words} words`);
    if (c.language) parts.push(c.language);
  } else if (kind === "audio") {
    if (c.min_duration_seconds != null) parts.push(`min ${c.min_duration_seconds} s`);
    if (c.max_duration_seconds != null) parts.push(`max ${c.max_duration_seconds} s`);
    if ((c.allowed_formats || []).length) parts.push(c.allowed_formats.join(", "));
    if (c.language) parts.push(c.language);
  }
  return parts.join(" · ");
}

/** Mirrors services/sample_service.check_assets. Returns an error message or "". */
export function validateAsset(asset, kind, value) {
  const c = asset.constraints || {};
  const label = asset.name || asset.key;

  if (kind === "text") {
    const text = (value?.text || "").trim();
    if (!text) return asset.required ? `${label} is required.` : "";
    const words = countWords(text);
    if (c.max_words != null && words > c.max_words) return `${label} has ${words} words; the maximum is ${c.max_words}.`;
    if (c.min_words != null && words < c.min_words) return `${label} has ${words} words; the minimum is ${c.min_words}.`;
    return "";
  }

  if (kind === "audio") {
    if (!value?.blob) return asset.required ? `${label} is required.` : "";
    const allowed = (c.allowed_formats || []).map((f) => f.toLowerCase());
    const ext = fileExt(value.filename);
    if (allowed.length && !allowed.includes(ext)) return `${label}: .${ext || "?"} is not allowed (allowed: ${allowed.join(", ")}).`;
    if (!value.duration || value.duration <= 0) return `${label}: could not read the duration of this audio.`;
    if (c.max_duration_seconds != null && value.duration > c.max_duration_seconds + 0.05)
      return `${label} is ${value.duration.toFixed(1)}s; the maximum is ${c.max_duration_seconds}s.`;
    if (c.min_duration_seconds != null && value.duration < c.min_duration_seconds - 0.05)
      return `${label} is ${value.duration.toFixed(1)}s; the minimum is ${c.min_duration_seconds}s.`;
    return "";
  }

  return `${label}: unsupported asset type.`;
}

const hasContent = (kind, value) =>
  kind === "text" ? Boolean((value?.text || "").trim()) : Boolean(value?.blob);

// ── Audio: decode whatever the browser recorded and re-encode as real WAV ────
function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const x = Math.max(-1, Math.min(1, s));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  });
  return new Blob([buf], { type: "audio/wav" });
}

async function blobToWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
    }
    return { blob: encodeWav(mono, audio.sampleRate), duration: audio.duration };
  } finally {
    ctx.close();
  }
}

function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(a.duration) ? a.duration : 0); };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    a.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset fields — one per DataComponent kind
// ─────────────────────────────────────────────────────────────────────────────

function FieldShell({ asset, kind, error, children }) {
  useInterfaceLanguage();
  const hint = describeConstraints(kind, asset.constraints);
  return (
    <div className={`dc-field dc-asset-card ${error ? "dc-field-invalid" : ""}`}>
      <div className="dc-field-heading"><span className={`dc-kind-icon ${kind}`} aria-hidden="true">{kind === "audio" ? <Mic size={18}/> : <FileText size={18}/>}</span><div><label className="dc-field-label" htmlFor={`dc-asset-${asset.key}`}>{asset.name || asset.key}<span className="dc-optional">{asset.required ? __msg("Required") : __msg("Optional")}</span></label><p className="dc-field-hint">{hint || (kind === "text" ? __msg("Add the text for this sample.") : __msg("Record a clip or choose an audio file."))}</p></div></div>
      {children}
      {error && <p id={`dc-error-${asset.key}`} role="alert" className="dc-over-limit">{__msg(error)}</p>}
    </div>
  );
}

function TextAssetField({ asset, value, onChange, error, prompt }) {
  useInterfaceLanguage();
  const text = value?.text || "";
  const words = countWords(text);
  const max = asset.constraints?.max_words;
  return (
    <FieldShell asset={asset} kind="text" error={error}>
      <textarea
        className="dc-textarea"
        id={`dc-asset-${asset.key}`}
        aria-invalid={!!error}
        aria-describedby={error ? `dc-error-${asset.key}` : undefined}
        rows={4}
        value={text}
        placeholder={__msg("Enter {value0}…", {value0: asset.name || __msg("text")})}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      <div className="dc-textarea-footer">
        <span className={max != null && words > max ? "dc-over-limit" : ""}>
          {words}{max != null ? ` / ${max}` : ""}{" "}{__msg("words")}{" "}</span>
        {prompt && (
          <button type="button" className="dc-label-tag" onClick={() => onChange({ text: prompt.content })}>{" "}{__msg("↓ Use prompt")}{" "}</button>
        )}
      </div>
    </FieldShell>
  );
}

function AudioAssetField({ asset, value, onChange, error }) {
  useInterfaceLanguage();
  const c = asset.constraints || {};
  const allowed = (c.allowed_formats || []).map((f) => f.toLowerCase());
  const maxSeconds = c.max_duration_seconds;

  // Live recording produces genuine WAV, so it is only offered when WAV is allowed.
  const canRecord = (allowed.length === 0 || allowed.includes("wav")) &&
    typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof MediaRecorder !== "undefined";
  const [mode, setMode] = useState(canRecord ? "record" : "upload");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);

  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const startedRef = useRef(0);
  const fileRef = useRef(null);

  const previewUrl = useMemo(() => (value?.blob ? URL.createObjectURL(value.blob) : null), [value?.blob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const stop = useCallback(() => {
    clearInterval(timerRef.current);
    setRecording(false);
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }, []);

  const start = async () => {
    setLocalError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setBusy(true);
        try {
          const { blob, duration } = await blobToWav(new Blob(chunksRef.current));
          onChange({ blob, duration, filename: `${asset.key}.wav` });
        } catch {
          setLocalError("Could not process the recording. Please try again.");
        } finally {
          setBusy(false);
        }
      };
      recRef.current = mr;
      startedRef.current = Date.now();
      setElapsed(0);
      mr.start();
      setRecording(true);
      timerRef.current = setInterval(() => {
        const t = (Date.now() - startedRef.current) / 1000;
        setElapsed(t);
        if (maxSeconds && t >= maxSeconds) stop();       // never record past the limit
      }, 100);
    } catch {
      setLocalError("Microphone access was denied or is unavailable.");
    }
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setLocalError("");
    setBusy(true);
    const duration = await readDuration(f);
    setBusy(false);
    onChange({ blob: f, duration, filename: f.name });
  };

  const modeBtn = (m, label) => (
    <button type="button" className={`dc-label-tag ${mode === m ? "active" : ""}`}
      aria-pressed={mode === m} disabled={recording || busy}
      onClick={() => { if (!recording) setMode(m); }}>
      {__msg(label)}
    </button>
  );

  return (
    <FieldShell asset={asset} kind="audio" error={error || localError}>
      {canRecord && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {modeBtn("record", "Record audio")}
          {modeBtn("upload", "Upload file")}
        </div>
      )}

      {!value?.blob && mode === "record" && (
        <div className="dc-audio-recorder"><div className={`dc-wave-art ${recording ? "dc-wave-live" : ""}`} aria-hidden="true">{[12,25,38,20,46,32,55,28,40,18,30,12].map((h,i)=><span key={i} style={{height:h}}/>)}</div><p>{recording ? __msg("Recording in progress…") : __msg("Every voice adds something new.")}</p>
          {!recording ? (
            <button type="button" className="dc-record-btn" onClick={start} disabled={busy}>{__msg("● Start recording")}</button>
          ) : (
            <button type="button" className="dc-record-btn recording" onClick={stop}>{" "}{__msg("■ Stop (")}{elapsed.toFixed(1)}s{maxSeconds ? ` / ${maxSeconds}s` : ""})
            </button>
          )}
        </div>
      )}

      {!value?.blob && mode === "upload" && (
        <div className="dc-upload-wrap"><button type="button" className="dc-upload-zone" disabled={busy} onClick={() => fileRef.current?.click()}><span className="dc-upload-icon"><UploadCloud size={25}/></span><strong>{busy ? __msg("Reading file…") : __msg("Choose an audio file")}</strong><span>{allowed.length ? allowed.map((f) => `.${f}`).join(" · ") : __msg("Any audio format")}</span></button><input id={`dc-asset-${asset.key}`} ref={fileRef} type="file" hidden accept={allowed.length ? allowed.map((f) => `.${f}`).join(",") : "audio/*"} onChange={handleFile}/></div>
      )}

      {value?.blob && (
        <div className="dc-audio-preview">
          <audio controls aria-label={__msg("Preview {value0}", {value0: asset.name || __msg("audio")})} src={previewUrl} />
          <span className={maxSeconds && value.duration > maxSeconds ? "dc-over-limit" : ""}>
            {value.duration ? value.duration.toFixed(1) : "?"}s{maxSeconds ? ` / ${maxSeconds}s` : ""} · {value.filename}
          </span>
          <button type="button" className="dc-remove-btn" onClick={() => onChange(null)}>{__msg("Remove")}</button>
        </div>
      )}
      {busy && value?.blob == null && mode === "record" && <p className="bulk-drop-sub">{__msg("Processing…")}</p>}
    </FieldShell>
  );
}

/** kind → renderer. Add a new asset kind here and it works everywhere. */
const ASSET_FIELDS = { text: TextAssetField, audio: AudioAssetField };

// ─────────────────────────────────────────────────────────────────────────────
// Side panel + toast
// ─────────────────────────────────────────────────────────────────────────────

function ContributionPanel({ stats, statsError }) {
  useInterfaceLanguage();
  const totalLabel = stats?.scope?.team_id ? "TEAM TOTAL" : "TOTAL SAMPLES";
  stats = stats || {};
  return (
    <div className="dc-right-panel">
      <div className="dc-panel-card">
        <div className="dc-panel-header"><span className="dc-panel-label">{__msg("Your contributions")}</span><Sparkles size={16}/></div>
        <div className="dc-stat-row">
          <div className="dc-stat-box">
            <span className="dc-stat-num validated">{stats.mine ?? "—"}</span>
            <span className="dc-stat-lbl">{__msg("YOUR SAMPLES")}</span>
          </div>
          <div className="dc-stat-box">
            <span className="dc-stat-num">{stats.total == null ? "—" : Number(stats.total).toLocaleString(document.documentElement.lang)}</span>
            <span className="dc-stat-lbl">{totalLabel}</span>
          </div>
        </div>
      </div>

      {statsError && <p className="dc-stats-note" role="status">{__msg("Contribution counts are temporarily unavailable.")}</p>}
      {(stats.members || []).length > 0 && (
        <div className="dc-panel-card">
          <p className="dc-panel-section-title">{__msg("CONTRIBUTORS")}</p>
          {stats.members.map((m) => (
            <div key={m.id} className="dc-team-member">
              <div className="dc-avatar">{m.initials}</div>
              <div className="dc-member-info"><span className="dc-member-name">{m.name}</span></div>
              <div className="dc-member-count">
                <span className="dc-member-total">{m.count}</span>
                {m.today > 0 && <span className="dc-member-today">+{m.today}{" "}{__msg("today")}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toast({ message, onDone }) {
  useInterfaceLanguage();
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  return <div className="dc-toast" role="status">{__msg(message)}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function DataCollection() {
  const params = useParams();
  const competitionId = params.id ?? params.competitionId;
  const navigate = useNavigate();

  const [competition, setCompetition] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [registry, setRegistry] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [stats, setStats] = useState(null);

  const [statsError, setStatsError] = useState(false);
  const [values, setValues] = useState({});            // { [component.key]: {text} | {blob, duration, filename} }
  const [details, setDetails] = useState({ sourceUrl: "" });
  const [errors, setErrors] = useState({});
  const [formKey, setFormKey] = useState(0);           // remounts fields after a successful submit
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const cfg = useMemo(() => parseConfig(competition), [competition]);
  const assets = useMemo(() => competition?.assets || [], [competition]);
  const kindOf = useCallback(
    (a) => registry?.asset_types.find((t) => t.value === a.type)?.kind || a.type.toLowerCase(),
    [registry]
  );

  // The wizard saves allowed_source_types ("public_platform" | "self_recorded" | "existing_dataset") and a
  // require_public_source_provenance flag. A source link applies when that flag is on and some allowed source
  // is not self-recorded; it can only be enforced for every sample when self-recorded isn't an allowed source.
  const dcCfg = cfg.data_collection || {};
  const sourceTypes = dcCfg.allowed_source_types || [];
  const needsSourceLink = !!dcCfg.require_public_source_provenance && sourceTypes.some((s) => s !== "self_recorded");
  const sourceLinkRequired = needsSourceLink && !sourceTypes.includes("self_recorded");

  // ── loading ────────────────────────────────────────────────────────────────
  const loadPrompt = useCallback(() => {
    fetch(`${API}/competitions/${competitionId}/prompts/next`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null)).then((p) => setPrompt(p ?? null)).catch(() => setPrompt(null));
  }, [competitionId]);

  const loadStats = useCallback(() => {
    fetch(`${API}/competitions/${competitionId}/samples/stats`, { headers: authHeader() })
      .then((r) => { if (!r.ok) throw new Error("Counts unavailable"); return r.json(); }).then((s) => { setStats(s); setStatsError(false); }).catch(() => setStatsError(true));
  }, [competitionId]);

  useEffect(() => {
    if (!competitionId) return;
    const h = authHeader();
    fetch(`${API}/competitions/${competitionId}`, { headers: h })
      .then((r) => { if (!r.ok) throw new Error(`Could not load competition (${r.status})`); return r.json(); })
      .then((c) => { setCompetition(c); loadPrompt(); })
      .catch((e) => setLoadError(e.message));
    fetch(`${API}/competition-schema`, { headers: h })
      .then((r) => (r.ok ? r.json() : null)).then(setRegistry).catch(() => {});
  }, [competitionId, loadPrompt]);

  useEffect(() => {
    loadStats();
    const iv = setInterval(loadStats, 15_000);
    return () => clearInterval(iv);
  }, [loadStats]);

  // ── form state ─────────────────────────────────────────────────────────────
  const setValue = (key, v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => { if (!prev[key]) return prev; const n = { ...prev }; delete n[key]; return n; });
  };

  const validateAll = () => {
    const next = {};
    assets.forEach((a) => {
      const msg = validateAsset(a, kindOf(a), values[a.key]);
      if (msg) next[a.key] = msg;
    });
    if (sourceLinkRequired && !details.sourceUrl.trim()) next._source = "A source link is required.";
    if (!assets.some((a) => hasContent(kindOf(a), values[a.key]))) next._form = "Add at least one asset to create a sample.";
    return next;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const found = validateAll();
    setErrors(found);
    if (Object.keys(found).length) return;

    const texts = {}, durations = {};
    const fd = new FormData();
    assets.forEach((a) => {
      const v = values[a.key];
      if (!hasContent(kindOf(a), v)) return;
      if (kindOf(a) === "text") texts[a.key] = v.text.trim();
      else {
        fd.append(`asset__${a.key}`, v.blob, v.filename || `${a.key}.wav`);
        durations[a.key] = v.duration;
      }
    });
    fd.append("texts", JSON.stringify(texts));
    fd.append("durations", JSON.stringify(durations));
    const meta = {};
    if (details.sourceUrl.trim()) meta.source_url = details.sourceUrl.trim();
    if (prompt?.id) meta.prompt_id = prompt.id;
    fd.append("meta", JSON.stringify(meta));

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/competitions/${competitionId}/samples`, { method: "POST", body: fd, headers: authHeader() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.detail?.errors) { setErrors(err.detail.errors); throw new Error("Some assets did not pass validation."); }
        throw new Error(typeof err.detail === "string" ? err.detail : "Submission failed — please retry.");
      }
      setValues({});
      setErrors({});
      setDetails((d) => ({ ...d, sourceUrl: "" }));
      setFormKey((k) => k + 1);
      setToast("✓ Sample submitted");
      loadStats();
      loadPrompt();
    } catch (e) {
      setToast(`⚠ ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return <DataCollectionView model={{ competitionId, competition, loadError, assets, prompt, stats, statsError, values, details, errors, formKey, submitting, toast, needsSourceLink, sourceLinkRequired }} actions={{ navigate, kindOf, setValue, setDetails, setErrors, handleSubmit, clearToast: () => setToast(null) }} />;
}

export function DataCollectionView({ model, actions, sidebar = null }) {
  useInterfaceLanguage();
  const { competitionId, competition, loadError, assets, prompt, stats, statsError, values, details, errors, formKey, submitting, toast, needsSourceLink, sourceLinkRequired } = model;
  const { navigate, kindOf, setValue, setDetails, setErrors, handleSubmit, clearToast } = actions;
  // ── render ─────────────────────────────────────────────────────────────────
  const renderForm = () => {
    if (loadError) return <div role="alert" className="dc-widget dc-placeholder"><FilePlus2 size={30}/><h2>{__msg("We couldn’t load this challenge.")}</h2><p>{loadError}</p><button type="button" className="dc-label-tag" onClick={() => window.location.reload()}>{__msg("Try again")}</button></div>;
    if (!competition) return <div role="status" className="dc-widget dc-placeholder"><FilePlus2 size={30}/><h2>{__msg("Preparing your collection space…")}</h2></div>;
    if (competition.is_draft) return <div className="dc-widget dc-placeholder">{__msg("This competition isn't open for submissions yet.")}</div>;
    if (!assets.length)
      return (
        <div className="dc-widget dc-placeholder">{" "}{__msg("This competition has no sample structure yet. The organizer needs to define its Sample Assets.")}{" "}</div>
      );

    return (
      <div className="dc-widget">
        <div className="dc-widget-header">
          <div className="dc-doc-badge"><span className="dc-doc-icon"><FilePlus2 size={21}/></span><div><h2>{__msg("Create a sample")}</h2><p>{__msg("A small contribution. A stronger dataset.")}</p></div></div>
          <span className="dc-lang-tag">{assets.length}{" "}{__msg("field")}{assets.length === 1 ? "" : "s"}</span>
        </div>

        {prompt && (
          <div className="audio-prompt-card" style={{ marginBottom: 16 }}>
            <span className="audio-prompt-label"><Sparkles size={12}/>{" "}{__msg("YOUR PROMPT")}</span>
            <p className="audio-prompt-text">"{prompt.content}"</p>
          </div>
        )}

        <div key={formKey}>
          {assets.map((a) => {
            const kind = kindOf(a);
            const Field = ASSET_FIELDS[kind];
            if (!Field)
              return (
                <div key={a.key} className="dc-field">
                  <label className="dc-field-label">{a.name} · {a.type}</label>
                  <p className="dc-over-limit">{__msg("This asset type isn't supported on this page yet.")}</p>
                </div>
              );
            return (
              <Field
                key={a.key}
                asset={a}
                value={values[a.key]}
                error={errors[a.key]}
                onChange={(v) => setValue(a.key, v)}
                prompt={kind === "text" ? prompt : null}
              />
            );
          })}
        </div>

        {needsSourceLink && (
          <div style={{ marginTop: 8 }}>
            <div className="dc-field">
              <label htmlFor="dc-source-url" className="dc-field-label">{__msg("Source link")}{" "}{sourceLinkRequired ? __msg("(required)") : __msg("(required unless you recorded or wrote this yourself)")}</label>
              <input id="dc-source-url" className="dc-input" type="text" aria-invalid={!!errors._source} placeholder="https://… (with timestamp if applicable)"
                value={details.sourceUrl}
                onChange={(e) => { setDetails((d) => ({ ...d, sourceUrl: e.target.value })); setErrors((x) => ({ ...x, _source: undefined })); }} />
              {errors._source && <p className="dc-over-limit" role="alert">{errors._source}</p>}
            </div>
          </div>
        )}

        {errors._form && <p role="alert" className="dc-over-limit" style={{ marginTop: 10 }}>{errors._form}</p>}

        <div className="dc-widget-actions"><span className="dc-save-note"><ShieldCheck size={16}/>{__msg("Checked against the challenge requirements")}</span>
          <button type="button" className="dc-commit-btn" disabled={submitting} onClick={handleSubmit}>
            {submitting ? __msg("Submitting…") : __msg("Submit sample")}<ArrowRight size={15}/>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="dc-shell dc-collection">
      {sidebar || <CompetitionSidebar competitionId={competitionId} competitionTitle={competition?.title} />}

      <div className="dc-main">
        <CompetitionTopbar competitionId={competitionId} competitionTitle={competition?.title || "Competition"} status="LAB ACTIVE" showDatasetHub={false} />

        <main className="dc-body">
          <div className="dc-header"><div><span className="dc-eyebrow">{__msg("DATA LAB / COLLECT")}</span><h1 className="dc-title">{__msg("Great data starts with you")}<span>.</span></h1><p className="dc-subtitle">{__msg("Bring a new sample to the collection.")}<br/>{__msg("Write, record, or upload — one thoughtful contribution at a time.")}</p></div><button type="button" className="dc-dataset-hub-btn" onClick={() => navigate(`/competitions/${competitionId}/dataset-hub`)}><Database size={15}/>{__msg("Dataset Hub")}<ArrowUpRight size={14}/></button></div>

          <div className="dc-content">
            <div className="dc-left">{renderForm()}</div>
            <ContributionPanel stats={stats} statsError={statsError} />
          </div>
        </main>
      </div>

      {toast && <Toast message={toast} onDone={clearToast} />}
    </div>
  );
}

export default withPhaseGate(DataCollection, "data-collection");
