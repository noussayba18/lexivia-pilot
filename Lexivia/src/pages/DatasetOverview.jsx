import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * DatasetOverview.jsx — the team's live view of its dataset
 *
 *   Overview  → how much was collected, how far annotation is, conflicts,
 *               and WHO collected / annotated WHAT
 *   Samples   → every sample with its collected assets and, per task, the answer
 *               of EACH annotator (several people can answer the same task)
 *
 * Read-only. Data comes from routes/dataset_overview.py:
 *   GET /competitions/{id}/dataset/overview
 *   GET /competitions/{id}/dataset/samples?page=&page_size=&status=
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import CompetitionSidebar from "../components/CompetitionSidebar";
import { withPhaseGate } from "../components/PhaseGate";
import { downloadTeamExport } from "./Datasethubshared.js";
import CompetitionTopbar from "../components/CompetitionTopbar";
import "../styles/DataCollection.css";
import "../styles/DatasetOverview.css";
import "../styles/dataCollectionRefresh.css";
import "../styles/datasetOverviewRefresh.css";
import { BarChart3, BookOpen, ChevronDown, Database, Download, FileText, Layers3, ListChecks, RefreshCw, ShieldCheck, Users } from "lucide-react";

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
const FILTERS = [
  ["all", "All"],
  ["completed", "Completed"],
  ["partial", "Partial"],
  ["not_started", "Not started"],
  ["conflict", "Conflicts"],
];

const fmtSeconds = (s) => {
  const n = Math.round(s || 0);
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};
const fmtDate = (iso) => { const date = iso ? new Date(iso) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(document.documentElement.lang, { dateStyle: "medium", timeStyle: "short" }) : "—"; };

// ─────────────────────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────────────────────

function Person({ p, me, sub }) {
  useInterfaceLanguage();
  return (
    <div className="ds-person">
      <div className="dc-avatar">{p.initials}</div>
      <div className="ds-person-text">
        <span className="dc-member-name">{p.name}{p.id === me ? __msg(" (you)") : ""}</span>
        {sub && <span className="ds-sub">{sub}</span>}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  useInterfaceLanguage();
  return (
    <div className={`ds-stat ${tone ? `ds-stat-${tone}` : ""}`}>
      <span className="ds-stat-dot" aria-hidden="true"/><span className="ds-stat-num">{value == null ? "—" : Number(value).toLocaleString(document.documentElement.lang)}</span>
      <span className="ds-stat-lbl">{__msg(label)}</span>
    </div>
  );
}

function ProgressBar({ done, total }) {
  useInterfaceLanguage();
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="ds-bar-wrap" title={`${pct}%`} role="img" aria-label={__msg("{value0} of {value1} completed, {value2}%", {value0: done, value1: total, value2: pct})}>
      <div className="dc-progress-bar" style={{ margin: 0 }}>
        <div className="dc-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ds-sub">{done} / {total} · {pct}%</span>
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`ds-status ds-status-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview tab
// ─────────────────────────────────────────────────────────────────────────────

export function DatasetOverviewContent({ data }) {
  useInterfaceLanguage();
  const t = data.totals;
  const done = t.completed;
  const annotatedPct = t.total ? Math.round((done / t.total) * 100) : 0;
  const maxDay = Math.max(1, ...data.samples_per_day.slice(-30).map((d) => d.count));

  return (
    <>
      <div className="ds-stats">
        <StatCard label={__msg("Samples collected")} value={t.total} />
        <StatCard label={__msg("Completed")} value={t.completed} tone="ok" />
        <StatCard label={__msg("Partial")} value={t.partial} tone="warn" />
        <StatCard label={__msg("Not started")} value={t.not_started} />
        <StatCard label={__msg("Conflicts to resolve")} value={t.conflicts_to_resolve} tone="bad" />
        <StatCard label={__msg("Conflicts resolved")} value={t.resolved_conflicts} tone="ok" />
      </div>

      {data.configured ? (
        <div className="dc-panel-card ds-card">
          <div className="ds-card-head">
            <h2 className="dc-panel-section-title"><ListChecks size={17}/>{__msg("Annotation progress")}</h2>
            <span className="ds-sub">
              {__msg("Annotators per sample: {count}",{count:data.required_annotators})}{" "}{data.adjudication ? __msg(" · extra annotator breaks ties") : ""}
            </span>
          </div>
          <ProgressBar done={done} total={t.total} />
          <p className="ds-sub" style={{ marginTop: 6 }}>{annotatedPct}{__msg("% of samples are fully annotated.")}</p>
        </div>
      ) : (
        <div className="dc-panel-card ds-card">
          <p className="ds-sub">{__msg("Annotation isn't configured yet (annotators per sample or tasks are missing), so only collected data is shown.")}</p>
        </div>
      )}

      <div className="ds-grid">
        {/* Collected data */}
        <div className="dc-panel-card ds-card">
          <h2 className="dc-panel-section-title"><Layers3 size={17}/>{__msg("Inside the collection")}</h2>
          {data.assets.length === 0 && <p className="ds-sub">{__msg("No assets defined.")}</p>}
          {data.assets.map((a) => (
            <div key={a.key} className="ds-row">
              <div>
                <span className="ds-row-title">{a.name}</span>
                <span className="ds-sub">{a.type}</span>
              </div>
              <div className="ds-row-right">
                <b>{a.count.toLocaleString(document.documentElement.lang)}</b>
                <span className="ds-sub">
                  {a.kind === "audio" && __msg("{value0} total{value1}", {value0: fmtSeconds(a.total_seconds), value1: a.avg_seconds ? ` · avg ${a.avg_seconds}s` : ""})}
                  {a.kind === "text" && __msg("{value0} words{value1}", {value0: (a.total_words || 0).toLocaleString(document.documentElement.lang), value1: a.avg_words ? ` · avg ${a.avg_words}` : ""})}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Contributors */}
        <div className="dc-panel-card ds-card">
          <h2 className="dc-panel-section-title"><Users size={17}/>{__msg("The people behind the data")}</h2>
          {data.contributors.length === 0 && <p className="ds-sub">{__msg("No samples yet.")}</p>}
          {data.contributors.map((c) => (
            <div key={c.id} className="ds-row">
              <Person p={c} me={data.me} />
              <div className="ds-row-right"><b>{c.samples}</b><span className="ds-sub">{__msg("Samples")}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-day */}
      {data.samples_per_day.length > 0 && (
        <div className="dc-panel-card ds-card">
          <div className="ds-card-head"><h2 className="dc-panel-section-title"><BarChart3 size={17}/>{__msg("A little progress, every day")}</h2><span className="ds-sub">{__msg("Samples collected")}</span></div>
          <div className="ds-days" role="img" aria-label={data.samples_per_day.slice(-30).map(d => `${d.date}: ${d.count} samples`).join("; ")}>
            {data.samples_per_day.slice(-30).map((d) => (
              <div key={d.date} className="ds-day" title={`${d.date}: ${d.count}`}>
                <div className="ds-day-bar" style={{ height: `${Math.max(0, (d.count / maxDay) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="ds-chart-axis"><span>{data.samples_per_day.slice(-30)[0]?.date}</span><span>{__msg("Last")}{" "}{Math.min(30, data.samples_per_day.length)}{" "}{__msg("active days")}</span><span>{data.samples_per_day.at(-1)?.date}</span></div>
        </div>
      )}

      {/* Tasks */}
      {data.tasks.length > 0 && (
        <>
          <div className="ds-section-heading"><h2>{__msg("Every task, a clearer picture.")}</h2><p>{__msg("Follow annotation coverage and answer distributions.")}</p></div>
          <div className="ds-grid">
            {data.tasks.map((task) => {
              const maxCount = Math.max(1, ...task.distribution.map((d) => d.count));
              return (
                <div key={task.key} className="dc-panel-card ds-card">
                  <div className="ds-card-head">
                    <span className="ds-row-title">{task.name}</span>
                    <span className="ds-sub">{__msg(task.label)}</span>
                  </div>
                  <ProgressBar done={task.samples_satisfied} total={t.total} />
                  <div className="ds-mini">
                    <span>{__msg("Answers")}{" "}<b>{task.answers}</b></span>
                    <span>{__msg("Samples touched")}{" "}<b>{task.samples_with_answers}</b></span>
                    <span>{__msg("Annotators")}{" "}<b>{task.annotators}</b></span>
                    {task.total_spans != null && <span>{__msg("Spans")}{" "}<b>{task.total_spans}</b></span>}
                    {task.avg_words != null && <span>{__msg("Avg words")}{" "}<b>{task.avg_words}</b></span>}
                  </div>
                  {task.distribution.length > 0 && (
                    <div className="ds-dist">
                      {task.distribution.map((d) => (
                        <div key={d.label} className="ds-dist-row">
                          <span className="ds-dist-label" title={d.label}>{__msg(d.label)}</span>
                          <div className="ds-dist-track"><div className="ds-dist-fill" style={{ width: `${(d.count / maxCount) * 100}%` }} /></div>
                          <span className="ds-dist-n">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Annotators */}
      <div className="ds-section-heading"><h2>{__msg("Perspectives behind the labels.")}</h2><p>{__msg("See how each annotator has contributed.")}</p></div>
      <div className="dc-panel-card ds-card">
        {data.annotators.length === 0 && <p className="ds-sub">{__msg("Nobody has submitted an annotation yet.")}</p>}
        {data.annotators.map((a) => (
          <div key={a.id} className="ds-annotator">
            <Person
              p={a} me={data.me}
              sub={__msg("{count} samples · {completed} completed · {partial} partial",{count:a.annotated,completed:a.completed,partial:a.partial})
                + (a.conflicts_handled ? __msg(" · conflicts: {value0} handled, {value1} resolved", {value0: a.conflicts_handled, value1: a.conflicts_resolved}) : "")}
            />
            <div className="ds-chips">
              {a.by_task.filter((x) => x.answers > 0).map((x) => (
                <span key={x.key} className="ds-chip">{x.name} <b>{x.answers}</b></span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Samples tab
// ─────────────────────────────────────────────────────────────────────────────

function AnswerValue({ answer, value }) {
  useInterfaceLanguage();
  const v = value || {};
  if (answer === "labels") return <span>{(v.labels || []).map((l) => <span key={l} className="ds-label">{l}</span>)}</span>;
  if (answer === "spans")
    return v.none ? <span className="ds-sub">{__msg("No spans")}</span> : (
      <span>
        {(v.spans || []).map((s, i) => (
          <span key={i} className="ds-label">
            {__msg(s.label)}: {s.text != null ? `“${s.text}”` : `${s.start_time}s–${s.end_time}s`}
          </span>
        ))}
      </span>
    );
  if (answer === "qa") return <span>Q: {v.question} — A: {v.answer}</span>;
  return <span className="ds-text-answer">{v.text}</span>;
}

export function DatasetSampleCard({ item, tasks, me }) {
  useInterfaceLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className={`dc-widget ds-sample ${item.status.startsWith("CONFLICT") ? "ds-sample-conflict" : ""}`}>
      <button type="button" className="ds-sample-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ds-sample-symbol"><FileText size={19}/></span><span className="ds-sample-title">{__msg("Sample #")}{item.number}</span>
        <StatusPill status={item.status} />
        {item.ever_conflict && !item.status.startsWith("CONFLICT") && <span className="ds-status ds-status-RESOLVED">{__msg("Conflict resolved")}</span>}
        <span className="ds-sub ds-grow">{__msg("collected by")}{" "}{item.contributor.name} · {fmtDate(item.submitted_at)}</span>
        <span className="ds-avatars">
          {item.annotators.slice(0, 4).map((a) => <span key={a.id} className="dc-avatar ds-mini-avatar" title={a.name}>{a.initials}</span>)}
          {item.annotators.length > 4 && <span className="ds-sub">+{item.annotators.length - 4}</span>}
        </span>
        <ChevronDown size={16} className={`ds-caret ${open ? "ds-caret-open" : ""}`} aria-hidden="true"/>
      </button>

      {open && (
        <div className="ds-sample-body">
          <p className="ds-section ds-section-first"><BookOpen size={14}/>{__msg("SOURCE MATERIAL")}</p>
          {item.assets.map((a) => (
            <div key={a.key} className="ds-asset">
              <p className="dc-field-label">{a.name || a.key} · {a.type}</p>
              {a.kind === "audio"
                ? (a.audio_url ? <audio controls aria-label={__msg("Listen to {value0}", {value0: a.name || __msg("audio sample")})} src={a.audio_url} style={{ width: "100%" }} /> : <p className="ds-sub">{__msg("Audio unavailable.")}</p>)
                : <div className="ds-asset-text">{a.text}</div>}
            </div>
          ))}

          <p className="ds-section"><ListChecks size={14}/>{__msg("ANNOTATIONS")}</p>
          {tasks.map((t) => {
            const a = item.answers[t.key] || { status: "NOT_STARTED", count: 0, needed_more: 0, entries: [] };
            return (
              <div key={t.key} className="ds-task">
                <div className="ds-task-head">
                  <span className="ds-row-title">{t.name}</span>
                  <span className={`ds-task-state ds-task-${a.status}`}>
                    {a.status === "SATISFIED" ? __msg("Done") : a.status === "CONFLICT" ? __msg("Conflict") : __msg("Answers: {count} · Still needed: {needed}", {count:a.count,needed:a.needed_more})}
                  </span>
                </div>
                {a.entries.length === 0 && <p className="ds-sub">{__msg("No one has answered this yet.")}</p>}
                {a.entries.map((e, i) => (
                  <div key={i} className="ds-entry">
                    <Person p={e.annotator} me={me} sub={`${fmtDate(e.created_at)}${e.complete ? "" : __msg(" · partial")}`} />
                    <div className="ds-entry-value"><AnswerValue answer={t.answer} value={e.value} /></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Samples({ competitionId, me }) {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API}/competitions/${competitionId}/dataset/samples?page=${page}&page_size=10&status=${status}`, { headers: authHeader() })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Could not load samples.");
        return j;
      })
      .then((j) => { if (!cancelled) { setData(j); setError(""); } })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [competitionId, status, page, revision]);

  return <DatasetSamplesView model={{ status, page, data, error, loading, me }} actions={{ setStatus, setPage, retry: () => setRevision(v => v + 1) }} />;
}

export function DatasetSamplesView({ model, actions }) {
  useInterfaceLanguage();
  const { status, page, data, error, loading, me } = model;
  const { setStatus, setPage, retry } = actions;

  return (
    <>
      <div className="ds-filters" role="group" aria-label={__msg("Filter samples by status")}>
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={`dc-label-tag ${status === k ? "active" : ""}`} aria-pressed={status === k} disabled={loading}
            onClick={() => { setStatus(k); setPage(1); }}>
            {__msg(label)}
          </button>
        ))}
        {data && !loading && !error && <span className="ds-sub ds-grow" style={{ textAlign: "right" }}>{__msg("Samples: {count}",{count:data.total.toLocaleString(document.documentElement.lang)})}</span>}
      </div>

      {error && !loading && <div role="alert" className="dc-widget dc-placeholder"><Database size={27}/><p>{__msg(error)}</p><button type="button" className="dc-label-tag" onClick={retry}>{__msg("Try again")}</button></div>}
      {loading && <div role="status" className="dc-widget dc-placeholder"><Layers3 size={28}/><p>{__msg("Finding your samples…")}</p></div>}
      {data && data.items.length === 0 && !loading && !error && <div className="dc-widget dc-placeholder"><Layers3 size={28}/><h2>{__msg("No samples here yet.")}</h2><p>{__msg("Try another status to explore the collection.")}</p></div>}
      {data && !loading && !error && data.items.map((it) => <DatasetSampleCard key={it.id} item={it} tasks={data.tasks} me={me} />)}

      {data && !loading && !error && data.pages > 1 && (
        <div className="ds-pager">
          <button type="button" className="dc-label-tag" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>{__msg("← Previous")}</button>
          <span className="ds-sub">{__msg("Page")}{" "}{data.page}{" "}{__msg("of")}{" "}{data.pages}</span>
          <button type="button" className="dc-label-tag" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>{__msg("Next →")}</button>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function DatasetOverview() {
  const params = useParams();
  const competitionId = params.id ?? params.competitionId;

  const [title, setTitle] = useState("");
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [exportFormat, setExportFormat] = useState("csv");
  const [includeAudio, setIncludeAudio] = useState(false);
  const [exporting, setExporting] = useState(false);

  const exportDataset = useCallback(async () => {
    setExporting(true);
    try {
      await downloadTeamExport(competitionId, exportFormat, { includeAudio });
    } catch (e) {
      alert(__msg("Export failed: ") + e.message);
    } finally {
      setExporting(false);
    }
  }, [competitionId, exportFormat, includeAudio]);

  const load = useCallback(() => {
    setRefreshing(true);
    fetch(`${API}/competitions/${competitionId}/dataset/overview`, { headers: authHeader() })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Could not load the dataset.");
        return j;
      })
      .then((j) => { setOverview(j); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, [competitionId]);

  useEffect(() => {
    if (!competitionId) return;
    fetch(`${API}/competitions/${competitionId}`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null)).then((c) => c && setTitle(c.title)).catch(() => {});
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [competitionId, load]);

  return <DatasetOverviewView model={{ competitionId, title, tab, overview, error, refreshing, exportFormat, includeAudio, exporting }} actions={{ setTab, load, setExportFormat, setIncludeAudio, exportDataset }} />;
}

export function DatasetOverviewView({ model, actions, sidebar = null, samplesPanel = null }) {
  useInterfaceLanguage();
  const { competitionId, title, tab, overview, error, refreshing, exportFormat = "csv", includeAudio = false, exporting = false } = model;
  const { setTab, load, setExportFormat = () => {}, setIncludeAudio = () => {}, exportDataset = () => {} } = actions;
  const hasAudio = !!overview?.assets?.some((a) => a.kind === "audio" && a.count > 0);

  return (
    <div className="dc-shell dc-collection ds-workspace">
      {sidebar || <CompetitionSidebar competitionId={competitionId} competitionTitle={title} />}

      <div className="dc-main">
        <CompetitionTopbar competitionId={competitionId} competitionTitle={title || "Competition"} status="LAB ACTIVE" showDatasetHub={false} />

        <main className="dc-body">
          <div className="dc-header"><div><span className="dc-eyebrow">{__msg("DATA LAB / DATASET")}</span><h1 className="dc-title">{overview?.scope?.kind === "solo" ? __msg("My Dataset") : __msg("Team Dataset")}<span>.</span></h1><p className="dc-subtitle">{__msg("See the collection come together.")}<br/>{__msg("Every sample, every annotation, every contribution in one place.")}</p>{overview?.scope && <div className="ds-scope"><Users size={13}/><span>{overview.scope.kind === "team" ? __msg("{name} · Members: {count}", {name:overview.scope.team_name || __msg("Your team"),count:overview.scope.size}) : overview.scope.kind === "solo" ? __msg("Your personal dataset") : __msg("Organizer view")}</span><span className="ds-readonly"><ShieldCheck size={12}/>{__msg("Read only")}</span></div>}</div><div className="ds-header-actions" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
            {overview && <>
              {hasAudio && <label className="ds-export-audio" title={__msg("Download a .zip with the audio files and the data file")} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><input type="checkbox" checked={includeAudio} disabled={exporting} onChange={(e) => setIncludeAudio(e.target.checked)}/>{__msg("Include audio (ZIP)")}</label>}
              <select aria-label={__msg("Export format")} className="ds-export-format" value={exportFormat} disabled={exporting} onChange={(e) => setExportFormat(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--lx-line, #e2e8f0)", fontSize: 13, background: "var(--lx-surface, #fff)" }}><option value="csv">CSV</option><option value="jsonl">JSONL</option></select>
              <button type="button" className="dc-dataset-hub-btn" disabled={exporting || !overview.totals?.completed} title={overview.totals?.completed ? undefined : __msg("Completed samples will be available to export here.")} onClick={exportDataset}><Download size={14}/>{exporting ? __msg("Exporting…") : __msg("Export dataset")}</button>
            </>}
            <button type="button" className="dc-dataset-hub-btn" disabled={refreshing} onClick={load}><RefreshCw size={14} className={refreshing ? "ds-refreshing" : ""}/>{refreshing ? __msg("Refreshing…") : __msg("Refresh dataset")}</button>
          </div></div>
          <nav className="ds-tabs" aria-label={__msg("Dataset views")}>
            {[["overview", "Overview"], ["samples", "Samples"]].map(([k, label]) => (
              <button key={k} type="button" aria-current={tab === k ? "page" : undefined}
                className={`ds-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
                {k === "overview" ? <BarChart3 size={15}/> : <Layers3 size={15}/>} {__msg(label)}
              </button>
            ))}
          </nav>

          {error && <div role="alert" className="ds-error-banner"><span>{overview ? __msg("Couldn’t refresh the dataset. Showing the last loaded data. ") : ""}{__msg(error)}</span><button type="button" disabled={refreshing} onClick={load}>{__msg("Try again")}</button></div>}
          {!error && !overview && <div role="status" className="dc-widget dc-placeholder"><Database size={28}/><h2>{__msg("Bringing your dataset together…")}</h2></div>}
          {overview && tab === "overview" && <DatasetOverviewContent data={overview} />}
          {overview && tab === "samples" && (samplesPanel || <Samples competitionId={competitionId} me={overview.me} />)}
        </main>
      </div>
    </div>
  );
}

export default withPhaseGate(DatasetOverview, "team-dataset");