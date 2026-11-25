import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * DatasetHub.jsx — updated
 *
 * Changes:
 *  1. Versioning now reads from / writes to the `dataset_versions` SQL table
 *     (via updated backend endpoints) — no more JSON blob in datasets_json.
 *  2. "Snapshot Dataset" button visible to ALL team members (no organizer gate).
 *  3. Delete button also open to all members (your dataset, your call).
 *  4. All other version UI preserved: pinning, edit modal, changelog, diff badges,
 *     label distribution mini-bars, active-version filter on the samples table.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import CompetitionSidebar from "../components/CompetitionSidebar";
import CompetitionTopbar from "../components/CompetitionTopbar";
import DataHealthPanel from "../components/DataHealthPanel";
import RawSamplesTable from "../components/RawSamplesTable";
import "../styles/DatasetHub.css";
import "../styles/validationRefresh.css";
import Modal from "../components/Modal";
import { ArrowRight, Download, Layers3, Lightbulb, Pencil, Pin, RefreshCw, ShieldCheck, X } from "lucide-react";
import { withPhaseGate } from "../components/PhaseGate";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
function authHeader() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}


// ─── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  useInterfaceLanguage();
    return (
        <div className="dh-stat-card">
            <span className="dh-stat-val" style={accent ? { color: accent } : {}}>{value}</span>
            <span className="dh-stat-label">{__msg(label)}</span>
            {sub && <span className="dh-stat-sub">{sub}</span>}
        </div>
    );
}

// ─── Diff badge ────────────────────────────────────────────────────────────────
function DiffBadge({ value, label }) {
  useInterfaceLanguage();
    if (!value) return null;
    return (
        <span className={`dh-diff-badge ${value > 0 ? "pos" : "neg"}`}>
            {value > 0 ? "+" : ""}{value} {__msg(label)}
        </span>
    );
}

// ─── Label mini-bars ───────────────────────────────────────────────────────────
function VersionLabelBars({ distribution, total }) {
    if (!distribution || !total) return null;
    const COLORS = ["#2BB8BF", "#F8B321", "#F26461", "#211F54", "#7BB9B2"];
    return (
        <div className="dh-ver-label-bars">
            {Object.entries(distribution).slice(0, 5).map(([lbl, cnt], i) => (
                <div key={lbl} className="dh-ver-label-row">
                    <span className="dh-ver-label-name" title={lbl}>{lbl}</span>
                    <div className="dh-ver-label-bar">
                        <div className="dh-ver-label-fill"
                            style={{
                                width: `${Math.round(cnt / total * 100)}%`,
                                background: COLORS[i % COLORS.length]
                            }} />
                    </div>
                    <span className="dh-ver-label-pct">{Math.round(cnt / total * 100)}%</span>
                </div>
            ))}
        </div>
    );
}

// ─── Single version card ───────────────────────────────────────────────────────
function VersionCard({ version, isActive, isLast, onSelect, onEdit, onDelete, onPin, pinning }) {
  useInterfaceLanguage();
    const [expanded, setExpanded] = useState(false);
    const total = version.total_samples || 0;

    const cardClass = [
        "dh-ver-card",
        isActive ? "active" : "",
        version.is_current ? "is-latest" : "",
        version.is_pinned ? "is-pinned" : "",
    ].filter(Boolean).join(" ");

    const statColors = { validated: "#398C92", flagged: "#BA8C42", rejected: "#B96B65", pending: "#9A91AD" };

    return (
        <div className="dh-ver-spine">
            <div className="dh-ver-spine-col">
                <div className={`dh-ver-spine-dot${version.is_current ? " active" : ""}`} />
                {!isLast && <div className="dh-ver-spine-line" />}
            </div>

            <div className="dh-ver-spine-card">
                <div className={cardClass}>

                    {/* Head */}
                    <div className="dh-ver-card-head">
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <button type="button" className="dh-ver-tag dh-ver-select" aria-pressed={isActive} aria-label={__msg("View version {value0}", {value0: version.tag})} onClick={() => onSelect(version.tag)}>{version.tag}<ArrowRight size={12}/></button>
                                {version.is_current && <span className="dh-ver-badge-latest">{__msg("Latest")}</span>}
                                {version.is_pinned && <span className="dh-ver-badge-pinned">{__msg("In use")}</span>}
                                {isActive && !version.is_current && <span className="dh-ver-badge-viewing">{__msg("Viewing")}</span>}
                            </div>
                            {version.label && <p className="dh-ver-label">{__msg(version.label)}</p>}
                            <p className="dh-ver-date">{version.date}</p>
                        </div>

                        <div className="dh-ver-actions" onClick={e => e.stopPropagation()}>
                            <button
                                className={`dh-ver-pin-btn${version.is_pinned ? " pinned" : ""}`}
                                title={version.is_pinned ? __msg("Unpin") : __msg("Pin for experiments")}
                                onClick={() => onPin(version.tag)}
                                disabled={pinning}
                             aria-label={version.is_pinned ? __msg("Unpin {value0}", {value0: version.tag}) : __msg("Pin {value0} for experiments", {value0: version.tag})} aria-pressed={!!version.is_pinned}><Pin size={13}/></button>
                            <button className="dh-ver-edit-btn" title={__msg("Edit label/notes")}
                                onClick={() => onEdit(version)} aria-label={__msg("Edit {value0}", {value0: version.tag})}><Pencil size={13}/></button>
                            {/* All members can delete (except the latest version) */}
                            {!version.is_current && (
                                <button className="dh-ver-del-btn" title={__msg("Delete version")}
                                    onClick={() => onDelete(version.tag)} aria-label={__msg("Delete {value0}", {value0: version.tag})}><X size={13}/></button>
                            )}
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="dh-ver-stats">
                        {[
                            { key: "validated", count: version.validated_samples },
                            { key: "flagged", count: version.flagged_samples },
                            { key: "rejected", count: version.rejected_samples },
                            { key: "pending", count: version.pending_samples },
                        ].filter(s => s.count > 0).map(({ key, count }) => (
                            <span key={key} className="dh-ver-stat" style={{ color: statColors[key] }}>
                                {count?.toLocaleString(document.documentElement.lang)} {key}
                            </span>
                        ))}
                    </div>

                    {/* Diffs */}
                    {version.diff && Object.values(version.diff).some(v => v !== 0) && (
                        <div className="dh-ver-diffs">
                            <DiffBadge value={version.diff.validated_samples} label={__msg("validated")} />
                            <DiffBadge value={version.diff.total_samples} label={__msg("total")} />
                            <DiffBadge value={version.diff.flagged_samples} label={__msg("flagged")} />
                        </div>
                    )}

                    {/* Expand toggle */}
                    <button type="button" aria-expanded={expanded} className="dh-ver-toggle"
                        onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}>
                        {expanded ? __msg("▾ Hide") : __msg("▸ Show")}{" "}{__msg("changelog & labels")}{" "}</button>

                    {expanded && (
                        <div className="dh-ver-expanded" onClick={e => e.stopPropagation()}>
                            {version.changelog?.length > 0 && (
                                <div>
                                    <p className="dh-ver-section-title">{__msg("Changelog")}</p>
                                    <ul className="dh-ver-changelog">
                                        {version.changelog.map((line, i) => <li key={i}>{line}</li>)}
                                    </ul>
                                </div>
                            )}
                            {version.notes && (
                                <div>
                                    <p className="dh-ver-section-title">{__msg("Notes")}</p>
                                    <p className="dh-ver-notes">{version.notes}</p>
                                </div>
                            )}
                            {version.label_distribution && (
                                <div>
                                    <p className="dh-ver-section-title">{__msg("Label distribution")}</p>
                                    <VersionLabelBars
                                        distribution={version.label_distribution}
                                        total={total}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Edit version modal ────────────────────────────────────────────────────────
function EditVersionModal({ version, onSave, onClose }) {
  useInterfaceLanguage();
    const [label, setLabel] = useState(version.label || "");
    const [notes, setNotes] = useState(version.notes || "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const handleSave = async () => {
        if (saving) return;
        setSaving(true); setError("");
        try { const err = await onSave(version.tag, { label, notes }); if (err) setError(err); else onClose(); }
        catch (err) { setError(err.message || "Could not save changes."); }
        finally { setSaving(false); }
    };
    return <Modal className="dh-dialog" title={__msg("Edit {value0}", {value0: version.tag})} subtitle={__msg("Give this snapshot a label and notes. Its samples and counts stay fixed.")} onClose={() => !saving && onClose()} footer={<><button type="button" className="dh-modal-cancel" disabled={saving} onClick={onClose}>{__msg("Cancel")}</button><button type="button" className="dh-modal-confirm" disabled={saving} onClick={handleSave}>{saving ? __msg("Saving…") : "Save changes"}</button></>}>
      {error && <p className="dh-modal-error" role="alert">{__msg(error)}</p>}
      <label htmlFor="edit-version-label" className="dh-modal-label">{__msg("Label")}</label><input id="edit-version-label" className="dh-modal-input" value={label} onChange={e => setLabel(e.target.value)} placeholder={__msg("e.g. Pre-launch freeze")}/>
      <label htmlFor="edit-version-notes" className="dh-modal-label">{__msg("Notes")}</label><textarea id="edit-version-notes" className="dh-modal-input" value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder={__msg("What changed in this version?")}/>
    </Modal>;
}

// ─── Version Control panel ─────────────────────────────────────────────────────
export function VersionControl({ versions, loading, onCreateVersion, onUpdateVersion, onDeleteVersion,
    onSelectVersion, activeVersion, onRefresh, pinnedTag, onPin, pinning }) {
  useInterfaceLanguage();

    const [showModal, setShowModal] = useState(false);
    const [editingVersion, setEditingVersion] = useState(null);
    const [tag, setTag] = useState("");
    const [label, setLabel] = useState("");
    const [notes, setNotes] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);

    const handleCreate = async () => {
        if (creating) return;
        setCreating(true);
        setError(null);
        const err = await onCreateVersion({ tag, label, notes });
        if (err) { setError(err); }
        else { setTag(""); setLabel(""); setNotes(""); setShowModal(false); }
        setCreating(false);
    };

    const handleDelete = async (vTag) => {
        if (!window.confirm(`Delete version ${vTag}? Samples are not lost — they just won't be tagged with this version.`)) return;
        await onDeleteVersion(vTag);
    };

    const visible = versions.filter(v => !v.deleted);

    return (
        <div className="dh-version-panel">
            {/* Header */}
            <div className="dh-version-header">
                <span className="dh-version-title"><Layers3 size={17}/>{__msg("Dataset versions")}</span>
                <div style={{ display: "flex", gap: 6 }}>
                    {activeVersion && (
                        <button className="dh-ver-clear-btn" onClick={() => onSelectVersion(null)}>{" "}{__msg("✕ Clear filter")}{" "}</button>
                    )}
                    <button className="dh-version-icon-btn" onClick={onRefresh} title={__msg("Refresh")} aria-label={__msg("Refresh dataset versions")}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10" />
                            <polyline points="23 20 23 14 17 14" />
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Pinned banner */}
            {pinnedTag && (
                <div className="dh-ver-pinned-bar">
                    <div className="dh-ver-pinned-info">
                        <span className="dh-ver-pinned-icon"><Pin size={17}/></span>
                        <div>
                            <p className="dh-ver-pinned-label">{__msg("PINNED FOR EXPERIMENTS")}</p>
                            <p className="dh-ver-pinned-tag">{pinnedTag}</p>
                        </div>
                    </div>
                    <button className="dh-ver-unpin-btn"
                        onClick={() => onPin(pinnedTag)} disabled={pinning}>{" "}{__msg("Unpin")}{" "}</button>
                </div>
            )}

            {/* Active filter banner */}
            {activeVersion && (
                <div className="dh-ver-filter-banner">
                    <span>{__msg("Viewing")}{" "}{activeVersion}{" "}{__msg("· Samples filtered")}</span>
                    <button className="dh-ver-clear-btn" onClick={() => onSelectVersion(null)}>{" "}{__msg("Show all")}{" "}</button>
                </div>
            )}

            {/* Timeline */}
            {loading ? (
                <div className="dh-version-loading">{__msg("Loading versions…")}</div>
            ) : visible.length === 0 ? (
                <div className="dh-ver-empty">
                    <p className="dh-ver-empty-title">{__msg("No snapshots yet")}</p>
                    <p className="dh-ver-empty-sub">{" "}{__msg("Click")}{" "}<strong>{__msg("\"Snapshot dataset\"")}</strong>{" "}{__msg("to save your validated samples as a fixed version for future experiments.")}{" "}</p>
                </div>
            ) : (
                <div className="dh-ver-timeline">
                    {visible.map((v, i) => (
                        <VersionCard
                            key={v.tag}
                            version={v}
                            isActive={activeVersion === v.tag}
                            isLast={i === visible.length - 1}
                            onSelect={tag => onSelectVersion(activeVersion === tag ? null : tag)}
                            onEdit={setEditingVersion}
                            onDelete={handleDelete}
                            onPin={onPin}
                            pinning={pinning}
                        />
                    ))}
                </div>
            )}

            {/* Snapshot button — ALL members can create snapshots */}
            <button className="dh-snapshot-btn" onClick={() => setShowModal(true)}>{" "}{__msg("Snapshot dataset")}{" "}</button>

            {/* Create modal */}
            {showModal && <Modal className="dh-dialog" title={__msg("Capture a dataset snapshot")} subtitle={__msg("Save the currently validated samples as a fixed version. New submissions won’t change it.")} onClose={() => { if (!creating) { setShowModal(false); setError(null); } }} footer={<><button type="button" className="dh-modal-cancel" disabled={creating} onClick={() => {setShowModal(false); setError(null);}}>{__msg("Cancel")}</button><button type="button" className="dh-modal-confirm" onClick={handleCreate} disabled={creating}>{creating ? "Creating…" : "Create snapshot"}</button></>}>
              {error && <div className="dh-modal-error" role="alert">{__msg(error)}</div>}
              <label htmlFor="snapshot-tag" className="dh-modal-label">{__msg("Version tag")}{" "}<span>{__msg("(optional)")}</span></label><input id="snapshot-tag" className="dh-modal-input" value={tag} onChange={e => setTag(e.target.value)} placeholder={__msg("e.g. v1.3 — leave blank to generate")}/>
              <label htmlFor="snapshot-label" className="dh-modal-label">{__msg("Label")}{" "}<span>{__msg("(optional)")}</span></label><input id="snapshot-label" className="dh-modal-input" value={label} onChange={e => setLabel(e.target.value)} placeholder={__msg("e.g. First training dataset")}/>
              <label htmlFor="snapshot-notes" className="dh-modal-label">{__msg("Notes")}{" "}<span>{__msg("(optional)")}</span></label><textarea id="snapshot-notes" className="dh-modal-input" value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder={__msg("What should your team know about this version?")}/>
            </Modal>}

            {/* Edit modal */}
            {editingVersion && (
                <EditVersionModal
                    version={editingVersion}
                    onSave={onUpdateVersion}
                    onClose={() => setEditingVersion(null)}
                />
            )}
        </div>
    );
}

function SnapshotGuidance() {
  useInterfaceLanguage();
    return <aside className="dh-guidance"><span><Lightbulb size={20}/></span><h3>{__msg("A version worth keeping.")}</h3><p>{__msg("Capture a snapshot when your validated data is ready. Pin a version to keep your experiments working with the same dataset.")}</p><div><ShieldCheck size={15}/>{__msg("A snapshot keeps its samples fixed.")}</div></aside>;
}

// ─── Main DatasetHub page ───────────────────────────────────────────────────────
function DatasetHub() {
    const { competitionId } = useParams();

    const [competition, setCompetition] = useState(null);
    const [health, setHealth] = useState(null);
    const [healthLoading, setHealthLoading] = useState(true);
    const [versions, setVersions] = useState([]);
    const [versionsLoading, setVersionsLoading] = useState(true);
    const [isOrganizer, setIsOrganizer] = useState(false);
    const [activeVersion, setActiveVersion] = useState(null);
    const [pinnedTag, setPinnedTag] = useState(null);
    const [pinning, setPinning] = useState(false);
    const [downloadFormat, setDownloadFormat] = useState("csv");
    const [downloading, setDownloading] = useState(false);
    const [healthError, setHealthError] = useState("");
    const [versionsError, setVersionsError] = useState("");

    // Competition detail
    useEffect(() => {
        fetch(`${API}/competitions/${competitionId}`, { headers: authHeader() })
            .then(r => r.json()).then(setCompetition).catch(console.error);
    }, [competitionId]);

    // Role (for informational use only — does not gate any actions in this page)
    useEffect(() => {
        fetch(`${API}/competitions/${competitionId}/my-role`, { headers: authHeader() })
            .then(r => r.ok ? r.json() : { role: "guest", is_organizer: false })
            .then(d => setIsOrganizer(d.role === "organizer" || d.is_organizer === true))
            .catch(() => setIsOrganizer(false));
    }, [competitionId]);

    // Health — poll every 30s
    useEffect(() => {
        const load = () => {
            setHealthLoading(true);
            fetch(`${API}/competitions/${competitionId}/data-health`, { headers: authHeader() })
                .then(r => { if (!r.ok) throw new Error("Could not refresh dataset health."); return r.json(); })
                .then(d => { setHealth(d); setHealthError(""); })
                .catch(e => setHealthError(e.message))
                .finally(() => setHealthLoading(false));
        };
        load();
        const iv = setInterval(load, 30_000);
        return () => clearInterval(iv);
    }, [competitionId]);

    // Versions from the dataset_versions table
    const loadVersions = useCallback(() => {
        setVersionsLoading(true);
        fetch(`${API}/competitions/${competitionId}/versions`, { headers: authHeader() })
            .then(r => { if (!r.ok) throw new Error("Could not load dataset versions."); return r.json(); })
            .then(d => {
                setVersionsError("");
                const list = Array.isArray(d) ? d : [];
                setVersions(list);
                const pinned = list.find(v => v.is_pinned);
                setPinnedTag(pinned ? pinned.tag : null);
            })
            .catch(e => setVersionsError(e.message))
            .finally(() => setVersionsLoading(false));
    }, [competitionId]);

    useEffect(() => { loadVersions(); }, [loadVersions]);

    // Create snapshot — open to all members
    const handleCreateVersion = async (body) => {
        try {
            const res = await fetch(`${API}/competitions/${competitionId}/versions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify(body),
            });
            if (res.status === 409) return (await res.json()).detail || "Tag already exists.";
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            loadVersions();
            return null;
        } catch (err) { return err.message || "Failed to create version."; }
    };

    // Edit label / notes
    const handleUpdateVersion = async (tag, body) => {
        try {
            const res = await fetch(`${API}/competitions/${competitionId}/versions/${tag}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify(body),
            });
            if (!res.ok) return "Could not save changes. Please try again.";
            loadVersions();
            return null;
        } catch (err) { return err.message || "Could not save changes."; }
    };

    // Soft-delete — open to all members
    const handleDeleteVersion = async (tag) => {
        try {
            const res = await fetch(`${API}/competitions/${competitionId}/versions/${tag}`,
                { method: "DELETE", headers: authHeader() });
            if (res.status === 409) { alert((await res.json()).detail); return; }
            loadVersions();
            if (activeVersion === tag) setActiveVersion(null);
        } catch (err) { console.error(err); }
    };

    // Pin / unpin — open to all members
    const handlePin = async (tag) => {
        setPinning(true);
        try {
            if (pinnedTag === tag) {
                await fetch(`${API}/competitions/${competitionId}/versions/pin`,
                    { method: "DELETE", headers: authHeader() });
                setPinnedTag(null);
            } else {
                await fetch(`${API}/competitions/${competitionId}/versions/${tag}/pin`,
                    { method: "POST", headers: authHeader() });
                setPinnedTag(tag);
            }
            loadVersions();
        } catch (err) { console.error(err); }
        finally { setPinning(false); }
    };

    // Download
    const handleDownload = async () => {
        setDownloading(true);
        try {
            const params = new URLSearchParams({ format: downloadFormat });
            if (activeVersion) params.set("version", activeVersion);
            const res = await fetch(
                `${API}/competitions/${competitionId}/export?${params}`,
                { headers: authHeader() });
            if (!res.ok) {
                alert((await res.json().catch(() => ({}))).detail || "Download failed.");
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `dataset-${competitionId}${activeVersion ? `-${activeVersion}` : ""}.${downloadFormat}`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
        finally { setDownloading(false); }
    };

    return <DatasetHubView model={{competitionId, competition, health, healthLoading, healthError, versions, versionsLoading, versionsError, isOrganizer, activeVersion, pinnedTag, pinning, downloadFormat, downloading}} actions={{handleDownload, setDownloadFormat, handleCreateVersion, handleUpdateVersion, handleDeleteVersion, setActiveVersion, loadVersions, handlePin}}/>;
}

export function DatasetHubView({model, actions, sidebar = null, samplesPanel = null}) {
  useInterfaceLanguage();
    const {competitionId, competition, health, healthLoading, healthError, versions, versionsLoading, versionsError, isOrganizer, activeVersion, pinnedTag, pinning, downloadFormat, downloading} = model;
    const {handleDownload, setDownloadFormat, handleCreateVersion, handleUpdateVersion, handleDeleteVersion, setActiveVersion, loadVersions, handlePin} = actions;
    return (
        <div className="dh-shell dh-refresh">
            {sidebar || <CompetitionSidebar competitionId={competitionId} competitionTitle={competition?.title}/>}

            <div className="dh-main">
                <CompetitionTopbar
    competitionId={competitionId}
    competitionTitle={competition?.title || "Competition"}
    status="LAB ACTIVE"
    showDatasetHub={false}
/>

                <main className="dh-body">
                    {/* Page header */}
                    <div className="dh-page-header">
                        <div className="dh-page-header-left">
                            <div className="dh-breadcrumb">
                                <span className="dh-crumb-tag">{__msg("DATA LAB / VALIDATE")}</span>
                            </div>
                            <h1 className="dh-page-title">{__msg("A stronger dataset starts here")}<span>.</span></h1>
                            <p className="dh-page-desc">{__msg("Review quality, keep the versions that matter, and take your data into the next experiment.")}</p>
                        </div>
                        <div className="dh-page-header-right">
                            <div className="dh-download-group">
                                <select aria-label={__msg("Download format")} className="dh-format-select" value={downloadFormat}
                                    onChange={e => setDownloadFormat(e.target.value)}>
                                    <option value="csv">CSV</option>
                                    <option value="json">JSON</option>
                                    <option value="conll">CoNLL</option>
                                </select>
                                <button className="dh-download-btn" onClick={handleDownload}
                                    disabled={downloading}>
                                    <Download size={15}/>{downloading ? __msg("Downloading…")
                                        : activeVersion ? __msg("Download {value0}", {value0: activeVersion}) : __msg("Download")}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Stats + Health */}
                    {(healthError || versionsError) && <div className="dh-request-error" role="alert">{healthError && <p>{__msg(healthError)}{health ? __msg(" Showing the last loaded counts.") : ""}</p>}{versionsError && <p>{__msg(versionsError)} <button type="button" onClick={loadVersions}>{__msg("Try again")}</button></p>}</div>}
                    <div className="dh-stats-row"><StatCard label={__msg("Samples collected")} value={health?.total?.toLocaleString(document.documentElement.lang) ?? "—"}/><StatCard label={__msg("Validated samples")} value={health?.validated?.toLocaleString(document.documentElement.lang) ?? "—"} accent="#398C92"/><StatCard label={__msg("Average text length")} value={health?.avg_text_length ?? "—"} sub={health ? __msg("words per sample") : undefined}/><StatCard label={__msg("Label categories")} value={health ? Object.keys(health.label_distribution || {}).length : "—"}/></div>

                    {/* Two-column layout */}
                    <div className="dh-content-area">
                        <div className="dh-left-col">
                            <DataHealthPanel health={health} loading={healthLoading && !health} />
                            <VersionControl
                                versions={versions}
                                loading={versionsLoading}
                                onCreateVersion={handleCreateVersion}
                                onUpdateVersion={handleUpdateVersion}
                                onDeleteVersion={handleDeleteVersion}
                                onSelectVersion={setActiveVersion}
                                activeVersion={activeVersion}
                                onRefresh={loadVersions}
                                pinnedTag={pinnedTag}
                                onPin={handlePin}
                                pinning={pinning}
                            />
                            <SnapshotGuidance />
                        </div>

                        <div className="dh-right-col">
                            {/* isOrganizer still passed for informational display in RawSamplesTable
                                but no longer gates any action buttons */}
                            {samplesPanel || <RawSamplesTable
                                competitionId={competitionId}
                                isOrganizer={isOrganizer}
                                version={activeVersion}
                            />}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

export default withPhaseGate(DatasetHub, "dataset-hub");
