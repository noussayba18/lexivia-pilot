import '../styles/DatasetHubglobal.theme.css';
import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * Global Datasets Hub — /datasets
 *
 * Lists the datasets of CLOSED competitions only (the backend enforces this).
 * A dataset is described by its sample structure: asset slots (text / audio)
 * and annotation tasks. Clicking a card opens /datasets/:competitionId.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/directoryRefresh.css";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

import {
  Database,
  FileText,
  Headphones,
  Layers3,
  RefreshCcw,
  Tags,
  ArrowRight,
  Lock,
} from "lucide-react";

import {
  apiGet,
  formatNumber,
  formatDuration,
  formatDate,
  timeAgo,
  taskLabel,
} from "./datasetHubShared";

// ── Small pieces ─────────────────────────────────────────────────────────────

function Chip({ children, Icon, bg = "var(--lx-teal-soft, #f1f5f9)", color = "var(--lx-muted, #475569)" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 9px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: 700,
        background: bg,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

function DatasetCard({ dataset, navigate }) {
  useInterfaceLanguage();
  const hasAudio = dataset.assets.some((a) => a.kind === "audio");
  const HeaderIcon = hasAudio ? Headphones : FileText;

  const annotatedPct =
    dataset.total_samples > 0
      ? Math.round((dataset.annotated_samples / dataset.total_samples) * 100)
      : 0;

  const shownTasks = dataset.tasks.slice(0, 3);
  const extraTasks = dataset.tasks.length - shownTasks.length;

  const open = () => navigate(`/datasets/${dataset.id}`);

  const stats = [
    { label: "Samples", value: formatNumber(dataset.total_samples) },
    { label: "Contributors", value: formatNumber(dataset.contributors) },
    { label: "Annotations", value: formatNumber(dataset.annotations) },
    hasAudio
      ? { label: "Audio", value: formatDuration(dataset.audio_seconds) }
      : { label: "Annotated", value: `${annotatedPct}%` },
  ];

  return (
    <div
      className="ds-card"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div className="ds-card-icon">
          <HeaderIcon size={18} strokeWidth={2.3} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="ds-card-title" dir="auto">{dataset.title}</h3>
          <p className="ds-card-desc" dir="auto">
            {dataset.description || __msg("No description provided.")}
          </p>
        </div>
      </div>

      {/* Sample structure */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {dataset.assets.map((a) => (
          <Chip
            key={a.key}
            Icon={a.kind === "audio" ? Headphones : FileText}
            bg={a.kind === "audio" ? "#edf8f6" : "#eef8f6"}
            color={a.kind === "audio" ? "#398c92" : "#398c92"}
          >
            {a.name}
          </Chip>
        ))}
        {shownTasks.map((t) => (
          <Chip key={t.key} Icon={Tags} bg={"var(--lx-teal-soft, #fff6df)"} color={"var(--lx-ink, #a38645)"}>
            {__msg(taskLabel(t.type, t.label))}
          </Chip>
        ))}
        {extraTasks > 0 && <Chip>+{extraTasks}{" "}{__msg("more")}</Chip>}
      </div>

      {/* Source */}
      <div
        className="ds-card-source" role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); navigate(`/competitions/${dataset.source_competition_id}`); } }}
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/competitions/${dataset.source_competition_id}`);
        }}
      >{" "}{__msg("Source:")}{" "}{dataset.source_competition_title}
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
        {stats.map(({ label, value }) => (
          <div key={label} className="ds-stat">
            <div className="ds-stat-value">{value}</div>
            <div className="ds-stat-label">{__msg(label)}</div>
          </div>
        ))}
      </div>

      {/* Annotation progress */}
      <div>
        <div className="ds-progress-head">
          <span>{__msg("Samples with annotations")}</span>
          <span>{annotatedPct}%</span>
        </div>
        <div className="ds-progress">
          <div style={{ width: `${annotatedPct}%` }} />
        </div>
      </div>

      <div className="ds-card-footer">
        <span>{" "}{__msg("Closed")}{" "}{formatDate(dataset.ended_at)}{" "}{__msg("· Updated")}{" "}{timeAgo(dataset.last_updated)}
        </span>
        <span className="ds-card-open">{" "}{__msg("View dataset")}{" "}<ArrowRight size={13} strokeWidth={2.5} />
        </span>
      </div>
    </div>
  );
}

function EmptyState({ navigate }) {
  useInterfaceLanguage();
  return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--lx-muted, #94a3b8)" }}>
      <div
        style={{
          width: 56,
          height: 56,
          margin: "0 auto 16px",
          borderRadius: 14,
          background: "var(--lx-teal-soft, #eef8f6)",
          color: "var(--lx-ink, #211f54)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Lock size={24} strokeWidth={2.2} />
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--lx-ink, #374151)", margin: "0 0 8px" }}>{" "}{__msg("No datasets published yet")}{" "}</h3>

      <p style={{ fontSize: 14, margin: "0 auto 24px", maxWidth: 420 }}>{" "}{__msg("A competition's dataset appears here once the competition closes. Datasets of competitions that are still running stay private.")}{" "}</p>

      <button
        onClick={() => navigate("/competitions")}
        style={{
          padding: "10px 20px",
          borderRadius: 8,
          border: "none",
          background: "#211f54",
          color: "#fff",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
        }}
      >{" "}{__msg("Browse Competitions")}{" "}</button>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DatasetHubGlobal() {
  const navigate = useNavigate();

  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet("/datasets/hub");
      setDatasets(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return <DatasetHubGlobalView datasets={datasets} loading={loading} error={error} load={load}/>;
}

export function DatasetHubGlobalView({datasets, loading=false, error=null, load=()=>{}}) {
  useInterfaceLanguage();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filterTask, setFilterTask] = useState("all");
  const taskOptions = useMemo(() => {
    const map = new Map();
    datasets.forEach((d) =>
      d.tasks.forEach((t) => map.set(t.type, taskLabel(t.type, t.label)))
    );
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [datasets]);

  const filtered = datasets.filter((d) => {
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      String(d.title || "").toLowerCase().includes(q) ||
      String(d.source_competition_title || "").toLowerCase().includes(q) ||
      String(d.description || "").toLowerCase().includes(q);
    const matchTask =
      filterTask === "all" || d.tasks.some((t) => t.type === filterTask);
    return matchSearch && matchTask;
  });

  const totalSamples = datasets.reduce((s, d) => s + Number(d.total_samples || 0), 0);
  const totalAnnotations = datasets.reduce((s, d) => s + Number(d.annotations || 0), 0);

  return (
    <>
      

      <div className="dataset-directory" style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Topbar />
          <main className="directory-main">
            <header className="directory-heading"><div><p className="directory-eyebrow">{__msg("DATASETS · EXPLORE & REUSE")}</p><h1>{__msg("Good data. New possibilities")}<span>.</span></h1><p>{__msg("Explore the language datasets our community has collected and annotated.")}</p></div><span className="directory-mark"><Database size={29}/></span></header>
            <div className="directory-notice"><Lock size={15}/><span>{__msg("Datasets become available here after their competition closes.")}</span></div>
            {/* Summary */}
            {!loading && !error && datasets.length > 0 && (
              <div className="directory-summary"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "14px",
                  marginBottom: "28px",
                }}
              >
                {[
                  { label: "Published Datasets", value: datasets.length, Icon: Layers3 },
                  { label: "Total Samples", value: formatNumber(totalSamples), Icon: Database },
                  { label: "Total Annotations", value: formatNumber(totalAnnotations), Icon: Tags },
                ].map(({ label, value, Icon }) => (
                  <div
                    key={label}
                    style={{
                      background: "var(--lx-surface, #fff)",
                      border: "1px solid var(--lx-line, #e9ecef)",
                      borderRadius: 12,
                      padding: "18px 22px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 9,
                        background: "var(--lx-teal-soft, #eef8f6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--lx-ink, #211f54)",
                      }}
                    >
                      <Icon size={18} strokeWidth={2.3} />
                    </div>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--lx-ink, #211f54)" }}>{value}</div>
                      <div style={{ fontSize: 12, color: "var(--lx-muted, #94a3b8)", fontWeight: 600 }}>{__msg(label)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search + filter */}
            <div className="directory-toolbar" style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                <svg
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--lx-muted, #94a3b8)",
                  }}
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  aria-label={__msg("Search datasets")} value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={__msg("Search datasets…")}
                  style={{
                    width: "100%",
                    padding: "9px 12px 9px 36px",
                    border: "1px solid var(--lx-line, #e2e8f0)",
                    borderRadius: 9,
                    fontSize: 13,
                    outline: "none",
                    background: "var(--lx-surface, #fff)",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <select
                aria-label={__msg("Filter annotation task")} value={filterTask}
                onChange={(e) => setFilterTask(e.target.value)}
                style={{
                  padding: "9px 14px",
                  border: "1px solid var(--lx-line, #e2e8f0)",
                  borderRadius: 9,
                  fontSize: 13,
                  background: "var(--lx-surface, #fff)",
                  color: "var(--lx-ink, #374151)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="all">{__msg("All annotation tasks")}</option>
                {taskOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {__msg(label)}
                  </option>
                ))}
              </select>

              <button
                onClick={load}
                style={{
                  padding: "9px 14px",
                  border: "1px solid var(--lx-line, #e2e8f0)",
                  borderRadius: 9,
                  fontSize: 13,
                  background: "var(--lx-surface, #fff)",
                  color: "var(--lx-ink, #374151)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RefreshCcw
                  size={13}
                  strokeWidth={2.5}
                  style={loading ? { animation: "spin 1s linear infinite" } : {}}
                />{" "}{__msg("Refresh")}{" "}</button>
            </div>

            {loading && (
              <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--lx-muted, #94a3b8)" }}>
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#211f54"
                  strokeWidth="2"
                  style={{ animation: "spin 1s linear infinite", marginBottom: 12 }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <div style={{ fontSize: 14 }}>{__msg("Loading datasets…")}</div>
              </div>
            )}

            {error && !loading && (
              <div
                style={{
                  background: "var(--lx-coral-soft, #fef2f2)",
                  border: "1px solid var(--lx-line, #fecaca)",
                  borderRadius: 10,
                  padding: "16px 20px",
                  color: "var(--lx-coral, #dc2626)",
                  fontSize: 14,
                }}
              >{" "}{__msg("Failed to load datasets:")}{" "}{__msg(error)}
                <button
                  onClick={load}
                  style={{
                    marginLeft: 12,
                    background: "none",
                    border: "none",
                    color: "var(--lx-coral, #dc2626)",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >{" "}{__msg("Retry")}{" "}</button>
              </div>
            )}

            {!loading && !error && datasets.length === 0 && <EmptyState navigate={navigate} />}

            {!loading && !error && datasets.length > 0 && filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 24px", color: "var(--lx-muted, #94a3b8)", fontSize: 14 }}>{" "}{__msg("No datasets match your search.")}{" "}<button
                  onClick={() => {
                    setSearch("");
                    setFilterTask("all");
                  }}
                  style={{
                    marginLeft: 8,
                    background: "none",
                    border: "none",
                    color: "var(--lx-ink, #211f54)",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >{" "}{__msg("Clear filters")}{" "}</button>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: "var(--lx-muted, #94a3b8)", fontWeight: 600, marginBottom: 14 }}>
                  {filtered.length}{" "}{__msg("dataset")}{filtered.length !== 1 ? "s" : ""}
                  {filterTask !== "all" || search ? __msg(" (filtered from {value0})", {value0: datasets.length}) : ""}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 370px), 1fr))",
                    gap: 16,
                  }}
                >
                  {filtered.map((d, i) => (
                    <div key={d.id} className="ds-card-enter" style={{ animationDelay: `${i * 40}ms` }}>
                      <DatasetCard dataset={d} navigate={navigate} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
