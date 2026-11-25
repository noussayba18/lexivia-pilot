import '../styles/DatasetDetails.theme.css';
import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * Dataset detail — /datasets/:competitionId
 *
 * One dataset = the samples collected in a CLOSED competition. Shows
 *   - statistics (samples, contributors, annotation coverage, audio hours, per-task distributions)
 *   - the sample structure (asset slots + annotation tasks)
 *   - a paginated sample browser: every asset of a sample (text, playable audio)
 *     together with its annotations, rendered according to each task's answer shape
 *     (labels, text/audio spans, text, question/answer).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../styles/directoryRefresh.css";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

import {
  ArrowLeft,
  Database,
  Download,
  FileText,
  Headphones,
  Tags,
  UsersRound,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Lock,
} from "lucide-react";

import {
  apiGet,
  downloadExport,
  formatNumber,
  formatDuration,
  formatClock,
  formatDate,
  taskLabel,
  labelColor,
} from "./Datasethubshared";

// ── Styles ───────────────────────────────────────────────────────────────────



// ── Pieces ───────────────────────────────────────────────────────────────────

function Spinner({ size = 28 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#211f54"
      strokeWidth="2"
      style={{ animation: "dsd-spin 1s linear infinite" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function StatCard({ Icon, value, label }) {
  useInterfaceLanguage();
  return (
    <div className="dsd-stat">
      <div className="dsd-stat-icon">
        <Icon size={17} strokeWidth={2.3} />
      </div>
      <div>
        <div className="dsd-stat-value">{value}</div>
        <div className="dsd-stat-label">{__msg(label)}</div>
      </div>
    </div>
  );
}

function DistBars({ items }) {
  useInterfaceLanguage();
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="dsd-dist">
      {items.map((it) => {
        const c = labelColor(it.label);
        return (
          <div className="dsd-dist-row" key={it.label}>
            <span className="dsd-dist-label" style={{ color: c.text }} title={it.label}>
              {__msg(it.label)}
            </span>
            <div className="dsd-dist-track">
              <div style={{ width: `${(it.count / max) * 100}%`, background: c.solid }} />
            </div>
            <span className="dsd-dist-count">{formatNumber(it.count)}</span>
          </div>
        );
      })}
    </div>
  );
}

function constraintText(a) {
  const c = a.constraints || {};
  const parts = [];
  if (a.kind === "text") {
    if (c.min_words) parts.push(`min ${c.min_words} words`);
    if (c.max_words) parts.push(`max ${c.max_words} words`);
  } else if (a.kind === "audio") {
    if (c.min_duration_seconds) parts.push(`min ${c.min_duration_seconds}s`);
    if (c.max_duration_seconds) parts.push(`max ${c.max_duration_seconds}s`);
    if (c.allowed_formats?.length) parts.push(c.allowed_formats.join("/").toUpperCase());
  }
  if (c.language) parts.push(c.language);
  return parts.join(" · ");
}

function targetLabel(task, assetsByKey, tasksByKey) {
  const t = task.target || {};
  if (t.type === "ASSET") return `on ${assetsByKey[t.ref]?.name || t.ref}`;
  if (t.type === "TASK_OUTPUT") return `on the output of ${tasksByKey[t.ref]?.name || t.ref}`;
  return "on the whole sample";
}

// ── Audio with annotation timeline ───────────────────────────────────────────

function AudioAsset({ asset, lanes }) {
  useInterfaceLanguage();
  const ref = useRef(null);
  const [time, setTime] = useState(0);
  const [metaDur, setMetaDur] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!asset.audio_url || failed) {
    return <div className="dsd-empty-ann">{__msg("Audio file unavailable.")}</div>;
  }

  const total = asset.duration || metaDur || 0;

  const seek = (t) => {
    if (!ref.current) return;
    ref.current.currentTime = t;
    ref.current.play().catch(() => {});
  };

  return (
    <div className="dsd-audio">
      <audio
        ref={ref}
        controls
        preload="none"
        src={asset.audio_url}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setMetaDur(e.currentTarget.duration || 0)}
        onError={() => setFailed(true)}
      />

      {lanes?.length > 0 && total > 0 && (
        <div className="dsd-lanes">
          {lanes.map((lane, li) => (
            <div key={li}>
              <div className="dsd-lane-label">{__msg(lane.label)}</div>
              <div className="dsd-lane-track">
                {lane.spans.map((s, i) => {
                  const c = labelColor(s.label);
                  const left = Math.min(100, (s.start_time / total) * 100);
                  const width = Math.max(1.2, ((s.end_time - s.start_time) / total) * 100);
                  return (
                    <button
                      key={i}
                      className="dsd-seg"
                      title={`${s.label} · ${formatClock(s.start_time)}–${formatClock(s.end_time)}`}
                      style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: c.solid, color: "#fff" }}
                      onClick={() => seek(s.start_time)}
                    >
                      {__msg(s.label)}
                    </button>
                  );
                })}
                <div className="dsd-playhead" style={{ left: `${Math.min(100, (time / total) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Text with highlighted spans ──────────────────────────────────────────────

function HighlightedText({ text, spans }) {
  useInterfaceLanguage();
  const sorted = [...spans]
    .filter((s) => typeof s.start === "number" && typeof s.end === "number")
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const parts = [];
  let cursor = 0;
  sorted.forEach((s, i) => {
    const start = Math.max(s.start, cursor);
    const end = Math.min(s.end, text.length);
    if (end <= start) return;
    if (start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, start)}</span>);
    const c = labelColor(s.label);
    parts.push(
      <mark key={`m${i}`} style={{ background: c.bg, color: c.text, boxShadow: `inset 0 -2px 0 ${c.solid}` }}>
        {text.slice(start, end)}
        <em>{__msg(s.label)}</em>
      </mark>
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

  return (
    <p dir="auto" className="dsd-text">
      {parts}
    </p>
  );
}

// ── Annotations ──────────────────────────────────────────────────────────────

function AnswerView({ task, value, targetText }) {
  useInterfaceLanguage();
  const v = value || {};

  if (task.answer === "labels") {
    return (
      <div className="dsd-chips">
        {(v.labels || []).map((l) => {
          const c = labelColor(l);
          return (
            <span key={l} className="dsd-chip" style={{ background: c.bg, color: c.text }}>
              {l}
            </span>
          );
        })}
      </div>
    );
  }

  if (task.answer === "spans") {
    const spans = v.spans || [];
    if (v.none || spans.length === 0) return <div className="dsd-muted">{__msg("No spans marked.")}</div>;

    if (spans[0].start_time !== undefined) {
      // audio spans: also drawn on the player's timeline
      return (
        <div className="dsd-chips">
          {spans.map((s, i) => {
            const c = labelColor(s.label);
            return (
              <span key={i} className="dsd-chip" style={{ background: c.bg, color: c.text }}>
                {__msg(s.label)} <small>{formatClock(s.start_time)}–{formatClock(s.end_time)}</small>
              </span>
            );
          })}
        </div>
      );
    }

    if (targetText) return <HighlightedText text={targetText} spans={spans} />;

    return (
      <div className="dsd-chips">
        {spans.map((s, i) => {
          const c = labelColor(s.label);
          return (
            <span key={i} className="dsd-chip" style={{ background: c.bg, color: c.text }}>
              {__msg(s.label)} {s.text && <small>“{s.text}”</small>}
            </span>
          );
        })}
      </div>
    );
  }

  if (task.answer === "qa") {
    return (
      <div className="dsd-qa" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div>
          <b>{__msg("Question")}</b>
          <p dir="auto" className="dsd-answer">{v.question}</p>
        </div>
        <div>
          <b>{__msg("Answer")}</b>
          <p dir="auto" className="dsd-answer">{v.answer}</p>
        </div>
      </div>
    );
  }

  return (
    <p dir="auto" className="dsd-answer">
      {v.text}
    </p>
  );
}

function entryLabel(e) {
  if (e.basis === "majority_vote")
    return e.votes != null && e.of > 1
      ? `Final decision · ${e.votes} of ${e.of} annotators agree`
      : e.of > 1 ? `Final decision · majority of ${e.of} annotators` : "Final decision";
  if (e.basis === "first_submitted")
    return e.of > 1 ? `Final answer · first submitted (of ${e.of})` : "Final answer";
  return e.annotator;
}

function AnnotationBlock({ task, entries, sample, assetsByKey, tasksByKey }) {
  useInterfaceLanguage();
  const targetAsset = task.target?.type === "ASSET" ? sample.assets.find((a) => a.key === task.target.ref) : null;
  const targetText = targetAsset?.kind === "text" ? targetAsset.text : null;

  return (
    <div className="dsd-ann">
      <div className="dsd-ann-head">
        <span className="dsd-ann-name">{task.name}</span>
        <span className="dsd-ann-type">{taskLabel(task.type, task.label).toUpperCase()}</span>
        <span className="dsd-ann-target">{targetLabel(task, assetsByKey, tasksByKey)}</span>
      </div>

      {entries.map((e, i) => (
        <div className="dsd-entry" key={i}>
          {(entries.length > 1 || e.basis || "agrees_with_final" in e) && (
            <div className="dsd-entry-who">
              {entryLabel(e)}
              {e.agrees_with_final === true && __msg(" · matches the final decision")}
              {e.agrees_with_final === false && __msg(" · differs from the final decision")}
            </div>
          )}
          <AnswerView task={task} value={e.value} targetText={targetText} />
        </div>
      ))}
    </div>
  );
}

// ── One sample ───────────────────────────────────────────────────────────────

function SampleCard({ sample, tasks, assetsByKey, tasksByKey, competitionId }) {
  useInterfaceLanguage();
  // Each annotator's own answers are only fetched when "Details" is pressed.
  const [showDetails, setShowDetails] = useState(false);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(null);

  async function toggleDetails() {
    if (showDetails) return setShowDetails(false);
    setShowDetails(true);
    if (details) return;
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      setDetails(await apiGet(`/datasets/hub/${competitionId}/samples/${sample.id}/annotations`));
    } catch (e) {
      setDetailsError(e.message);
    } finally {
      setDetailsLoading(false);
    }
  }

  // audio-span annotations are drawn on the matching player
  const lanes = {};
  tasks.forEach((t) => {
    if (t.answer !== "spans" || t.target?.type !== "ASSET") return;
    const asset = sample.assets.find((a) => a.key === t.target.ref);
    if (!asset || asset.kind !== "audio") return;
    (sample.annotations[t.key] || []).forEach((e) => {
      const spans = (e.value?.spans || []).filter((s) => s.start_time !== undefined);
      if (!spans.length) return;
      (lanes[asset.key] = lanes[asset.key] || []).push({ label: `${t.name} · ${e.annotator}`, spans });
    });
  });

  const annotatedTasks = tasks.filter((t) => (sample.annotations[t.key] || []).length > 0);

  return (
    <div className="dsd-sample">
      <div className="dsd-sample-head">
        <span className="dsd-sample-num">{__msg("Sample #")}{sample.number}</span>
        <span className="dsd-mono">{sample.id.slice(0, 8)}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--lx-muted, #94a3b8)", fontWeight: 600 }}>
          {annotatedTasks.length > 0
            ? __msg("Final decision · {value0}/{value1} tasks", {value0: annotatedTasks.length, value1: tasks.length})
            : __msg("No final decision")}
        </span>
      </div>

      <div className="dsd-sample-body">
        <div className="dsd-col">
          <div className="dsd-col-title">{__msg("Data")}</div>
          {sample.assets.length === 0 && <div className="dsd-muted">{__msg("No assets stored for this sample.")}</div>}
          {sample.assets.map((a) => (
            <div key={a.key}>
              <div className="dsd-asset-name">
                {a.kind === "audio" ? <Headphones size={13} /> : <FileText size={13} />}
                {a.name}
                <small>
                  {a.kind === "audio"
                    ? formatDuration(a.duration)
                    : __msg("{value0} words", {value0: (a.text || "").trim().split(/\s+/).filter(Boolean).length})}
                  {a.language ? ` · ${a.language}` : ""}
                </small>
              </div>
              {a.kind === "audio" ? (
                <AudioAsset asset={a} lanes={lanes[a.key]} />
              ) : (
                <p dir="auto" className="dsd-text">{a.text}</p>
              )}
            </div>
          ))}
        </div>

        <div className="dsd-col">
          <div className="dsd-col-title">{__msg("Final annotation")}</div>
          {tasks.length === 0 && <div className="dsd-muted">{__msg("This dataset has no annotation tasks.")}</div>}
          {tasks.length > 0 && annotatedTasks.length === 0 && (
            <div className="dsd-empty-ann">{__msg("This sample has no final decision (annotation unfinished, or an unresolved tie).")}</div>
          )}
          {annotatedTasks.map((t) => (
            <AnnotationBlock
              key={t.key}
              task={t}
              entries={sample.annotations[t.key]}
              sample={sample}
              assetsByKey={assetsByKey}
              tasksByKey={tasksByKey}
            />
          ))}
          {annotatedTasks.length > 0 && (
            <button type="button" className="dsd-btn" style={{ marginTop: 10 }} onClick={toggleDetails}>
              {showDetails ? __msg("Hide details") : __msg("Details")}
            </button>
          )}
        </div>
      </div>

      {showDetails && (
        <div className="dsd-sample-body" style={{ borderTop: "1px solid var(--lx-line, #e2e8f0)" }}>
          <div className="dsd-col" style={{ gridColumn: "1 / -1" }}>
            <div className="dsd-col-title">{__msg("What each annotator wrote")}</div>
            {detailsLoading && <div className="dsd-muted">{__msg("Loading…")}</div>}
            {detailsError && <div className="dsd-error">{__msg("Failed to load details:")}{" "}{detailsError}</div>}
            {details && details.tasks.filter((d) => d.entries.length > 0).map((d) => {
              const task = tasksByKey[d.task_key];
              return task ? (
                <AnnotationBlock key={d.task_key} task={task} entries={d.entries}
                  sample={sample} assetsByKey={assetsByKey} tasksByKey={tasksByKey} />
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Statistics ───────────────────────────────────────────────────────────────

function Statistics({ detail }) {
  useInterfaceLanguage();
  const { stats } = detail;
  const days = stats.samples_per_day.slice(-60);
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const finalCount = stats.final_samples ?? stats.annotated_samples;
  const coverage = stats.total_samples ? Math.round((finalCount / stats.total_samples) * 100) : 0;
  const hasAudio = stats.assets.some((a) => a.kind === "audio");

  return (
    <>
      <div className="dsd-stats">
        <StatCard Icon={Database} value={formatNumber(stats.total_samples)} label={__msg("Samples")} />
        <StatCard Icon={UsersRound} value={formatNumber(stats.contributors)} label={__msg("Contributors")} />
        <StatCard Icon={CheckCircle2} value={`${coverage}%`} label={__msg("Final decision ({value0})", {value0: formatNumber(finalCount)})} />
        <StatCard Icon={Tags} value={formatNumber(stats.annotations)} label={__msg("Annotations · {value0} annotators", {value0: stats.annotators})} />
        {hasAudio && <StatCard Icon={Clock} value={formatDuration(stats.audio_seconds)} label={__msg("Total audio")} />}
      </div>

      {/* Structure */}
      <div className="dsd-section">
        <h2 className="dsd-h2">{__msg("Sample structure")}</h2>
        <div className="dsd-grid2">
          <div className="dsd-card">
            <div className="dsd-card-title" style={{ marginBottom: 10 }}>{__msg("Assets in each sample")}</div>
            <div className="dsd-struct">
              {detail.assets.map((a) => (
                <div className="dsd-struct-row" key={a.key}>
                  {a.kind === "audio" ? <Headphones size={15} color={"var(--lx-teal, #1565c0)"} /> : <FileText size={15} color={"var(--lx-teal, #3b5bdb)"} />}
                  <b>{a.name}</b>
                  <small>{constraintText(a) || a.type}</small>
                </div>
              ))}
              {detail.assets.length === 0 && <span className="dsd-muted">{__msg("No assets defined.")}</span>}
            </div>
          </div>

          <div className="dsd-card">
            <div className="dsd-card-title" style={{ marginBottom: 10 }}>{__msg("Annotation tasks")}</div>
            <div className="dsd-struct">
              {detail.tasks.map((t) => (
                <div className="dsd-struct-row" key={t.key}>
                  <Tags size={15} color={"var(--lx-coral, #6d28d9)"} />
                  <b>{t.name}</b>
                  <small>
                    {__msg(taskLabel(t.type, t.label))}
                    <br />
                    {targetLabel(t, Object.fromEntries(detail.assets.map((a) => [a.key, a])), Object.fromEntries(detail.tasks.map((x) => [x.key, x])))}
                  </small>
                </div>
              ))}
              {detail.tasks.length === 0 && <span className="dsd-muted">{__msg("No annotation tasks defined.")}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Data statistics */}
      <div className="dsd-section">
        <h2 className="dsd-h2">{__msg("Data statistics")}</h2>
        <div className="dsd-grid2">
          {stats.assets.map((a) => (
            <div className="dsd-card" key={a.key}>
              <div className="dsd-card-head">
                <div>
                  <div className="dsd-card-title">{a.name}</div>
                  <div className="dsd-card-note">{a.kind === "audio" ? __msg("Audio clips") : __msg("Text")}</div>
                </div>
              </div>
              {a.kind === "audio" ? (
                <div className="dsd-kv">
                  <div><b>{formatNumber(a.count)}</b><span>{__msg("Clips")}</span></div>
                  <div><b>{formatDuration(a.total_seconds)}</b><span>{__msg("Total")}</span></div>
                  <div><b>{formatDuration(a.avg_seconds)}</b><span>{__msg("Average")}</span></div>
                </div>
              ) : (
                <div className="dsd-kv">
                  <div><b>{formatNumber(a.count)}</b><span>{__msg("Texts")}</span></div>
                  <div><b>{a.avg_words ?? "—"}</b><span>{__msg("Avg words")}</span></div>
                  <div><b>{formatNumber(a.max_words)}</b><span>{__msg("Longest (words)")}</span></div>
                </div>
              )}
            </div>
          ))}

          {days.length > 1 && (
            <div className="dsd-card">
              <div className="dsd-card-head">
                <div>
                  <div className="dsd-card-title">{__msg("Contributions over time")}</div>
                  <div className="dsd-card-note">
                    {formatDate(stats.first_submitted)} → {formatDate(stats.last_submitted)}
                  </div>
                </div>
              </div>
              <div className="dsd-spark">
                {days.map((d) => (
                  <div key={d.date} title={`${d.date}: ${d.count}`} style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: 2 }} />
                ))}
              </div>
            </div>
          )}

          {stats.top_contributors.length > 0 && (
            <div className="dsd-card">
              <div className="dsd-card-title" style={{ marginBottom: 12 }}>{__msg("Top contributors")}</div>
              <DistBars items={stats.top_contributors.map((c) => ({ label: c.name, count: c.count }))} />
            </div>
          )}
        </div>
      </div>

      {/* Annotation statistics */}
      {stats.tasks.length > 0 && (
        <div className="dsd-section">
          <h2 className="dsd-h2">{__msg("Annotation statistics")}</h2>
          <div className="dsd-grid2">
            {stats.tasks.map((t) => (
              <div className="dsd-card" key={t.key}>
                <div className="dsd-card-head">
                  <div>
                    <div className="dsd-card-title">{t.name}</div>
                    <div className="dsd-card-note">{__msg(taskLabel(t.type, t.label))}</div>
                  </div>
                </div>

                <div className="dsd-kv" style={{ marginBottom: t.distribution.length || t.avg_words != null ? 14 : 0 }}>
                  <div><b>{formatNumber(t.annotations)}</b><span>{__msg("Annotations")}</span></div>
                  <div><b>{formatNumber(t.samples)}</b><span>{__msg("Samples")}</span></div>
                  {t.total_spans != null ? (
                    <div><b>{formatNumber(t.total_spans)}</b><span>{__msg("Spans")}</span></div>
                  ) : t.avg_words != null ? (
                    <div><b>{t.avg_words}</b><span>{__msg("Avg words")}</span></div>
                  ) : (
                    <div><b>{formatNumber(t.annotators)}</b><span>{__msg("Annotators")}</span></div>
                  )}
                </div>

                {t.distribution.length > 0 && <DistBars items={t.distribution} />}
                {t.annotations === 0 && <div className="dsd-muted">{__msg("No annotations yet.")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Sample browser ───────────────────────────────────────────────────────────

function SampleBrowser({ detail }) {
  useInterfaceLanguage();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("yes");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const topRef = useRef(null);
  const firstRender = useRef(true);

  const assetsByKey = Object.fromEntries(detail.assets.map((a) => [a.key, a]));
  const tasksByKey = Object.fromEntries(detail.tasks.map((t) => [t.key, t]));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet(`/datasets/hub/${detail.id}/samples?page=${page}&page_size=8&annotated=${filter}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [detail.id, page, filter]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page, filter]);

  return (
    <div className="dsd-section" ref={topRef} style={{ scrollMarginTop: 70 }}>
      <div className="dsd-toolbar">
        <h2 className="dsd-h2">{" "}{__msg("Samples")}{" "}{data && <small>{formatNumber(data.total)} {filter === "all" ? __msg("total") : __msg("matching")}</small>}
        </h2>
        <select
          className="dsd-select"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="yes">{__msg("With a final decision (the dataset)")}</option>
          <option value="no">{__msg("No final decision")}</option>
          <option value="all">{__msg("All samples")}</option>
        </select>
      </div>

      {error && <div className="dsd-error">{__msg("Failed to load samples:")}{" "}{__msg(error)}</div>}

      {loading && !data && (
        <div className="dsd-loading"><Spinner /></div>
      )}

      {data && data.items.length === 0 && !loading && (
        <div className="dsd-card dsd-muted" style={{ textAlign: "center" }}>{__msg("No samples match this filter.")}</div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
          {data.items.map((s) => (
            <SampleCard key={s.id} sample={s} tasks={detail.tasks} assetsByKey={assetsByKey} tasksByKey={tasksByKey} competitionId={detail.id} />
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="dsd-pager">
          <button className="dsd-btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={14} />{" "}{__msg("Previous")}{" "}</button>
          <span>{__msg("Page")}{" "}{data.page}{" "}{__msg("of")}{" "}{data.pages}</span>
          <button className="dsd-btn" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>{" "}{__msg("Next")}{" "}<ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DatasetDetail() {
  const { competitionId } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [includeAudio, setIncludeAudio] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiGet(`/datasets/hub/${competitionId}`));
    } catch (e) {
      setError({ message: e.message, status: e.status });
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleExport(format) {
    setExporting(format);
    try {
      await downloadExport(competitionId, format, { includeAudio });
    } catch (e) {
      alert("Export failed: " + e.message);
    } finally {
      setExporting(null);
    }
  }

  return <DatasetDetailView detail={detail} loading={loading} error={error} exporting={exporting} handleExport={handleExport} load={load} competitionId={competitionId} includeAudio={includeAudio} setIncludeAudio={setIncludeAudio}/>;
}

export function DatasetDetailView({detail, loading=false, error=null, exporting=null, handleExport=()=>{}, load=()=>{}, competitionId, includeAudio=false, setIncludeAudio=()=>{}}) {
  useInterfaceLanguage();
  const navigate = useNavigate();
  return (
    <>
      

      <div className="dataset-detail-refresh" style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Topbar title={__msg("Datasets")} subtitle={detail ? detail.title : __msg("Dataset details")} />

          <main className="dsd-page">
            <button className="dsd-back" onClick={() => navigate("/datasets")}>
              <ArrowLeft size={14} strokeWidth={2.5} />{" "}{__msg("All datasets")}{" "}</button>

            {loading && <div className="dsd-loading"><Spinner /><div style={{ marginTop: 12 }}>{__msg("Loading dataset…")}</div></div>}

            {error && !loading && (
              <div className="dsd-error">
                {error.status === 403 && <Lock size={14} style={{ marginRight: 8, verticalAlign: "-2px" }} />}
                {__msg(error.message)}
              </div>
            )}

            {detail && !loading && (
              <>
                <div className="dsd-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h1 className="dsd-title">{detail.title}</h1>
                    <p className="dsd-sub">{detail.description || __msg("No description provided.")}</p>
                    <div className="dsd-meta">
                      <span className="dsd-badge"><Lock size={11} />{" "}{__msg("Competition closed")}{" "}{formatDate(detail.ended_at)}</span>
                      <span>{" "}{__msg("Source:")}{" "}
                        <span className="dsd-link" onClick={() => navigate(`/competitions/${detail.source_competition_id}`)}>
                          {detail.source_competition_title}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="dsd-actions" style={{ flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
                    {detail.stats?.assets?.some((a) => a.kind === "audio" && a.count > 0) && (
                      <label className="dsd-audio-opt" title={__msg("Download a .zip with the audio files and the data file")}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--lx-muted, #64748b)", cursor: "pointer" }}>
                        <input type="checkbox" checked={includeAudio} disabled={!!exporting}
                          onChange={(e) => setIncludeAudio(e.target.checked)} />
                        {__msg("Include audio (ZIP)")}
                      </label>
                    )}
                    <button className="dsd-btn" disabled={!!exporting} onClick={() => handleExport("jsonl")}>
                      <Download size={13} strokeWidth={2.5} /> {exporting === "jsonl" ? __msg("Exporting…") : "JSONL"}
                    </button>
                    <button className="dsd-btn" disabled={!!exporting} onClick={() => handleExport("csv")}>
                      <Download size={13} strokeWidth={2.5} /> {exporting === "csv" ? __msg("Exporting…") : "CSV"}
                    </button>
                  </div>
                </div>

                <Statistics detail={detail} />
                <SampleBrowser detail={detail} />
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}