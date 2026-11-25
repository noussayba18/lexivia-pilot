import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * RawSamplesTable.jsx — updated
 *
 * Changes:
 *  1. isOrganizer gate REMOVED — all team members see all action buttons
 *  2. Un-reject: rejected samples show a "↩ Restore" button to move back to pending
 *  3. "validated" status shows an un-validate button (→ pending) so mistakes are fixable
 *  4. Score breakdown popover, approval audit trail, dynamic task-type columns preserved
 *  5. Status guide updated to reflect open permissions
 *  6. 2-annotator error surfaced clearly when backend returns 422
 */

import { useState, useCallback, useEffect, useRef } from "react";

const API      = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const REQUIRED = 2;   // must match backend REQUIRED_APPROVALS

function authHeader() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Score breakdown popover ──────────────────────────────────────────────────
function ScoreBreakdownPopover({ score, breakdown }) {
  useInterfaceLanguage();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    if (!breakdown || breakdown.length === 0) {
        if (score == null) return <span style={{ fontSize:12, color:"var(--lx-muted, #9ca3af)" }}>—</span>;
        const pct   = Math.round(score * 100);
        const color = pct >= 70 ? "#398C92" : pct >= 40 ? "#B49146" : "#B96864";
        return <span style={{ fontSize:12, fontWeight:500, color }}>{pct}%</span>;
    }

    const pct   = Math.round((score || 0) * 100);
    const color = pct >= 70 ? "#398C92" : pct >= 40 ? "#B49146" : "#B96864";
    const sevColor = { ok:"#398C92", warn:"#B49146", error:"#B96864", info:"#6b7280" };

    return (
        <span ref={ref} style={{ position:"relative", display:"inline-flex", alignItems:"center", gap:4 }}>
            <button onClick={() => setOpen(o => !o)} style={{
                background:"none", border:"none", cursor:"pointer", padding:0,
                display:"flex", alignItems:"center", gap:4,
            }}>
                <span style={{ fontSize:12, fontWeight:500, color }}>{pct}%</span>
                <span style={{ fontSize:9, fontWeight:500, color:"#fff", background:color,
                    borderRadius:99, padding:"1px 5px" }}>{__msg("WHY?")}</span>
            </button>
            {open && (
                <div style={{
                    position:"fixed",
                    top: ref.current ? (() => {
                        const r = ref.current.getBoundingClientRect();
                        return window.innerHeight - r.bottom > 400 ? r.bottom + 6 : Math.max(10, r.top - 406);
                    })() : 200,
                    left: ref.current
                        ? Math.max(12, Math.min(ref.current.getBoundingClientRect().left, window.innerWidth - 430))
                        : 100,
                    minWidth:"min(320px, calc(100vw - 24px))", maxWidth:"min(420px, calc(100vw - 24px))", background:"var(--lx-surface, #fff)",
                    border:"1.5px solid var(--lx-line, #e8edf8)", borderRadius:12,
                    boxShadow:"0 8px 32px rgba(0,0,0,.18)", zIndex:9999,
                    padding:"14px 16px", maxHeight:"80vh", overflowY:"auto",
                }}>
                    <div style={{ display:"flex", alignItems:"center",
                        justifyContent:"space-between", marginBottom:10 }}>
                        <p style={{ margin:0, fontSize:11, fontWeight:500,
                            letterSpacing:".08em", textTransform:"uppercase", color:"var(--lx-muted, #4f586f)" }}>{" "}{__msg("Score Breakdown")}{" "}</p>
                        <span style={{ fontSize:18, fontWeight:600, color }}>{pct}%</span>
                    </div>
                    <div style={{ height:5, background:"var(--lx-teal-soft, #eef3ff)", borderRadius:99,
                        overflow:"hidden", marginBottom:12 }}>
                        <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:99 }} />
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        {breakdown.map((rule, i) => (
                            <div key={i} style={{
                                background: rule.passed ? "rgba(43,184,191,.04)" : "color-mix(in srgb, var(--lx-coral-soft, #f26461) 3.92%, transparent)",
                                border:`1px solid ${rule.passed ? "color-mix(in srgb, var(--lx-line, #2bb8bf) 14.9%, transparent)" : "color-mix(in srgb, var(--lx-line, #f26461) 14.9%, transparent)"}`,
                                borderRadius:8, padding:"8px 10px",
                            }}>
                                <div style={{ display:"flex", alignItems:"center",
                                    justifyContent:"space-between", marginBottom:3 }}>
                                    <span style={{ fontSize:11, fontWeight:500,
                                        color:sevColor[rule.severity]||"var(--lx-muted, #4f586f)" }}>
                                        {rule.passed ? "✓" : "✗"} {__msg(rule.label)}
                                    </span>
                                    <span style={{ fontSize:11, fontWeight:500,
                                        color:sevColor[rule.severity]||"var(--lx-muted, #4f586f)" }}>{rule.score_pct}%</span>
                                </div>
                                <div style={{ height:3, background:"var(--lx-teal-soft, #eef3ff)", borderRadius:99,
                                    overflow:"hidden", marginBottom:5 }}>
                                    <div style={{ width:`${rule.score_pct}%`, height:"100%",
                                        background:sevColor[rule.severity]||"#9ca3af", borderRadius:99 }} />
                                </div>
                                <p style={{ margin:0, fontSize:10, color:"var(--lx-muted, #6b7280)", lineHeight:1.5 }}>
                                    {(rule.explanation||"").replace(/\s*\[contributes.*?\]/g,"")}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </span>
    );
}

// ── Approval progress dots ───────────────────────────────────────────────────
function ApprovalProgress({ approvalCount, needed, approvals }) {
  useInterfaceLanguage();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    const done  = approvalCount || 0;
    const color = done >= REQUIRED ? "#398C92" : "#B49146";

    return (
        <span ref={ref} style={{ position:"relative", display:"inline-flex", alignItems:"center", gap:4 }}>
            <button onClick={() => setOpen(o => !o)} style={{
                background:"none", border:"none", cursor:"pointer", padding:0,
                display:"flex", alignItems:"center", gap:4,
            }}>
                {Array.from({ length: REQUIRED }).map((_, i) => (
                    <span key={i} style={{
                        width:8, height:8, borderRadius:"50%",
                        background: i < done ? color : "var(--lx-raised, #e5e7eb)",
                        border:`1px solid ${i < done ? color : "var(--lx-line, #d1d5db)"}`,
                    }} />
                ))}
                <span style={{ fontSize:10, fontWeight:500, color }}>{done}/{REQUIRED}</span>
            </button>

            {open && approvals && approvals.length > 0 && (
                <div style={{
                    position:"fixed",
                    top: ref.current ? (() => {
                        const r = ref.current.getBoundingClientRect();
                        return window.innerHeight - r.bottom > 200 ? r.bottom + 6 : Math.max(10, r.top - 206);
                    })() : 200,
                    left: ref.current
                        ? Math.min(ref.current.getBoundingClientRect().left, window.innerWidth - 270)
                        : 100,
                    minWidth:250, background:"var(--lx-surface, #fff)",
                    border:"1.5px solid var(--lx-line, #e8edf8)", borderRadius:10,
                    boxShadow:"0 6px 24px rgba(0,0,0,.15)", zIndex:9999, padding:"12px 14px",
                }}>
                    <p style={{ margin:"0 0 8px", fontSize:10, fontWeight:500,
                        letterSpacing:".08em", textTransform:"uppercase", color:"var(--lx-muted, #4f586f)" }}>{" "}{__msg("Annotator Actions")}{" "}</p>
                    {approvals.map((a, i) => {
                        const ac = a.action==="approve" ? "#398C92" : a.action==="reject" ? "#B96864" : "#B49146";
                        const ai = a.action==="approve" ? "✓" : a.action==="reject" ? "✗" : "△";
                        return (
                            <div key={i} style={{
                                display:"flex", gap:8, alignItems:"flex-start",
                                paddingBottom:6, marginBottom: i < approvals.length-1 ? 6 : 0,
                                borderBottom: i < approvals.length-1 ? "1px solid var(--lx-line, #f0f3fb)" : "none",
                            }}>
                                <span style={{ fontSize:12, color:ac, fontWeight:500,
                                    width:16, flexShrink:0, paddingTop:1 }}>{ai}</span>
                                <div>
                                    <p style={{ margin:0, fontSize:12, fontWeight:500 }}>{a.name}</p>
                                    <p style={{ margin:"1px 0 0", fontSize:10, color:"var(--lx-muted, #6b7280)" }}>
                                        {a.timestamp ? new Date(a.timestamp).toLocaleString(document.documentElement.lang) : ""}
                                    </p>
                                    {a.note && (
                                        <p style={{ margin:"2px 0 0", fontSize:11,
                                            color:"var(--lx-muted, #4f586f)", fontStyle:"italic" }}>"{a.note}"</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </span>
    );
}

// ── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status, flags, score, approvalCount }) {
  useInterfaceLanguage();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    const palette = {
        validated:        { bg:"rgba(43,184,191,.13)",  color:"var(--lx-teal, #398C92)", label:"Validated" },
        can_be_validated: { bg:"rgba(33,31,84,.13)",  color:"var(--lx-ink, #211F54)", label:"Ready" },
        scored:           { bg:"rgba(33,31,84,.13)", color:"var(--lx-muted, #777193)", label:"Scored" },
        flagged:          { bg:"rgba(248,179,33,.13)", color:"var(--lx-gold, #BB8B51)", label:"Flagged" },
        rejected:         { bg:"color-mix(in srgb, var(--lx-coral-soft, #f26461) 12.94%, transparent)",  color:"var(--lx-coral, #B96864)", label:"Rejected" },
        pending:          { bg:"rgba(248,179,33,.13)", color:"var(--lx-ink, #B49146)", label:"Pending" },
    };
    const p = palette[status] || palette.pending;

    const getMsg = () => {
        if (status === "validated")
            return { title:"Validated ✓", body:"In the dataset. Use ↩ Restore to move back to pending if needed." };
        if (status === "can_be_validated")
            return { title:"Ready to Validate", body:`Got ${REQUIRED}/${REQUIRED} approvals. Click ✓ Validate to add to the dataset.` };
        if (status === "scored")
            return { title:"Awaiting Approvals", body:`Scored (${Math.round((score||0)*100)}%). Needs ${Math.max(0, REQUIRED-(approvalCount||0))} more approval(s). Click ✓ Approve below.` };
        if (status === "flagged")
            return { title:"Flagged for Review", body: flags?.length ? flags.join(" • ") : "Flagged by automated checks or an annotator." };
        if (status === "rejected")
            return { title:"Rejected", body: (flags?.length ? flags.join(" • ") : "Failed validation.") + " — click ↩ Restore to un-reject." };
        return { title:"Pending", body:"Submitted, awaiting automated scoring." };
    };

    const msg = getMsg();

    return (
        <span ref={ref} style={{ position:"relative", display:"inline-flex", alignItems:"center", gap:3 }}>
            <span style={{ ...p, fontSize:11, fontWeight:500, padding:"3px 10px",
                borderRadius:99, whiteSpace:"nowrap", letterSpacing:".02em" }}>{__msg(p.label)}</span>
            <button onClick={() => setOpen(o => !o)} style={{
                fontSize:9, fontWeight:500, padding:"1px 5px", borderRadius:99,
                border:`1px solid ${p.color}`, background:"transparent",
                cursor:"pointer", color:p.color, lineHeight:1.4, flexShrink:0,
            }}>?</button>
            {open && (
                <div style={{
                    position:"fixed",
                    top: ref.current ? (() => {
                        const r = ref.current.getBoundingClientRect();
                        return window.innerHeight - r.bottom > 160 ? r.bottom + 6 : r.top - 146;
                    })() : 200,
                    left: ref.current
                        ? Math.max(12, Math.min(ref.current.getBoundingClientRect().left, window.innerWidth - 310))
                        : 200,
                    minWidth:240, maxWidth:310, background:"var(--lx-surface, #fff)",
                    border:`1.5px solid ${p.color}`, borderRadius:10, padding:"12px 14px",
                    boxShadow:"0 8px 32px rgba(0,0,0,.18)", zIndex:9999,
                }}>
                    <p style={{ margin:"0 0 6px", fontSize:11, fontWeight:500,
                        color:p.color, letterSpacing:".05em", textTransform:"uppercase" }}>
                        {msg.title}
                    </p>
                    <p style={{ margin:0, fontSize:12, color:"var(--lx-ink, #1d2333)", lineHeight:1.6 }}>{msg.body}</p>
                </div>
            )}
        </span>
    );
}

// ── Approve/Flag/Reject actions (for scored/flagged/can_be_validated samples) ─
function ApproveActions({ sample, onAction, updating }) {
  useInterfaceLanguage();
    const [showNoteFor, setShowNoteFor] = useState(null);
    const [note, setNote] = useState("");

    const canApprove = ["scored", "flagged", "can_be_validated"].includes(sample.status);
    if (!canApprove) return null;

    const doAction = (action) => {
        onAction(sample.id, action, note);
        setShowNoteFor(null);
        setNote("");
    };

    return (
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                <button onClick={() => doAction("approve")} disabled={updating} style={{
                    fontSize:10, padding:"3px 8px", borderRadius:5, fontWeight:500,
                    border:"0.5px solid #398C92", color:"var(--lx-teal, #398C92)",
                    background:"rgba(43,184,191,.08)", cursor:"pointer",
                }}>{__msg("✓ Approve")}</button>
                <button onClick={() => setShowNoteFor(showNoteFor==="flag" ? null : "flag")}
                    disabled={updating} style={{
                    fontSize:10, padding:"3px 8px", borderRadius:5, fontWeight:500,
                    border:"0.5px solid var(--lx-line, #BB8B51)", color:"var(--lx-gold, #BB8B51)",
                    background:"rgba(248,179,33,.08)", cursor:"pointer",
                }}>{__msg("△ Flag")}</button>
                <button onClick={() => setShowNoteFor(showNoteFor==="reject" ? null : "reject")}
                    disabled={updating} style={{
                    fontSize:10, padding:"3px 8px", borderRadius:5, fontWeight:500,
                    border:"0.5px solid var(--lx-line, #B96864)", color:"var(--lx-coral, #B96864)",
                    background:"color-mix(in srgb, var(--lx-coral-soft, #f26461) 7.84%, transparent)", cursor:"pointer",
                }}>{__msg("✕ Reject")}</button>
            </div>
            {showNoteFor && (
                <div style={{ display:"flex", gap:4 }}>
                    <input
                        style={{ fontSize:11, padding:"3px 7px", borderRadius:5, flex:1,
                            border:"1px solid var(--lx-line, #e8edf8)", outline:"none" }}
                        placeholder={__msg("Reason for {value0}…", {value0: showNoteFor})}
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && doAction(showNoteFor)}
                        autoFocus
                    />
                    <button onClick={() => doAction(showNoteFor)} style={{
                        fontSize:10, padding:"3px 8px", borderRadius:5, fontWeight:500,
                        border:"1px solid #211F54", color:"var(--lx-ink, #211F54)",
                        background:"rgba(33,31,84,.08)", cursor:"pointer",
                    }}>{__msg("Send")}</button>
                </div>
            )}
        </div>
    );
}

// ── Universal status action buttons (all members, all statuses) ───────────────
// Replaces the old OrgActions (organizer-only validate button).
// Everyone can: validate ready samples, restore rejected, un-validate, re-flag.
function StatusActions({ sample, onStatusChange, updating }) {
  useInterfaceLanguage();
    const { status } = sample;

    const btn = (label, newStatus, opts = {}) => (
        <button
            onClick={() => onStatusChange(sample.id, newStatus)}
            disabled={updating}
            style={{
                fontSize:10, padding:"3px 9px", borderRadius:5, fontWeight:500,
                border:`0.5px solid ${opts.border || "var(--lx-line, #6b7280)"}`,
                color: opts.color || "var(--lx-muted, #6b7280)",
                background: opts.bg || "rgba(107,114,128,.07)",
                cursor:"pointer", whiteSpace:"nowrap",
                ...(opts.solid ? { background: opts.border, color:"#fff" } : {}),
            }}
        >{__msg(label)}</button>
    );

    if (status === "can_be_validated") {
        return (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {btn("✓ Validate", "validated",
                    { border:"#398C92", color:"#fff", bg:"#398C92", solid:true })}
                {btn("△ Flag", "flagged",
                    { border:"var(--lx-line, #BB8B51)", color:"var(--lx-gold, #BB8B51)", bg:"rgba(248,179,33,.08)" })}
            </div>
        );
    }

    if (status === "validated") {
        return btn("↩ Restore", "pending",
            { border:"#B49146", color:"var(--lx-ink, #B49146)", bg:"rgba(248,179,33,.08)" });
    }

    if (status === "rejected") {
        return (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {btn("↩ Restore", "pending",
                    { border:"#211F54", color:"var(--lx-ink, #211F54)", bg:"rgba(33,31,84,.08)" })}
                {btn("✓ Validate", "validated",
                    { border:"#398C92", color:"var(--lx-teal, #398C92)", bg:"rgba(43,184,191,.08)" })}
            </div>
        );
    }

    if (status === "flagged") {
        return (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {btn("↩ Restore", "pending",
                    { border:"#211F54", color:"var(--lx-ink, #211F54)", bg:"rgba(33,31,84,.08)" })}
                {btn("⊘ Reject", "rejected",
                    { border:"var(--lx-line, #B96864)", color:"var(--lx-coral, #B96864)", bg:"color-mix(in srgb, var(--lx-coral-soft, #f26461) 7.84%, transparent)" })}
            </div>
        );
    }

    // pending / scored — no direct override needed here; ApproveActions handles scoring flow
    return null;
}

// ── Dynamic cell renderer ────────────────────────────────────────────────────
function CellValue({ colKey, sample }) {
  useInterfaceLanguage();
    const DATA_KEY_MAP = {
        "content":  "content_snippet",
        "document": "document",
        "source":   "source",
        "context":  "context",
        "prompt":   "prompt",
    };
    const dataKey = DATA_KEY_MAP[colKey] || colKey;
    const val     = sample[dataKey] !== undefined ? sample[dataKey] : sample[colKey];

    if (colKey === "score") {
        return <ScoreBreakdownPopover score={sample.agreement} breakdown={sample.score_breakdown} />;
    }
    if (colKey === "approvals") {
        return (
            <ApprovalProgress
                approvalCount={sample.approval_count}
                needed={sample.approvals_needed}
                approvals={sample.approvals}
            />
        );
    }
    if (colKey === "status") {
        return (
            <StatusPill
                status={sample.status}
                flags={sample.flags}
                score={sample.agreement}
                approvalCount={sample.approval_count}
            />
        );
    }
    if (colKey === "annotator") {
        return (
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                <div style={{
                    width:26, height:26, borderRadius:"50%", flexShrink:0,
                    background:"var(--color-background-info,var(--lx-teal-soft, #e6f1fb))",
                    color:"var(--color-text-info,var(--lx-teal, #185fa5))",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:10, fontWeight:500,
                }}>{sample.annotator?.initials || "?"}</div>
                <span style={{ fontSize:12, overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {sample.annotator?.name || __msg("Unknown")}
                </span>
            </div>
        );
    }
    if (colKey === "id") {
        return (
            <span style={{ fontFamily:"monospace", fontSize:11,
                color:"var(--color-text-secondary)" }}>{sample.uid}</span>
        );
    }
    if (colKey === "actions") return null;

    const display = val != null && val !== "" && val !== "—" ? String(val) : null;
    return display
        ? <span style={{ fontSize:12 }} title={display}>{display.slice(0,60)}{display.length>60?"…":""}</span>
        : <span style={{ color:"var(--lx-muted, #9ca3af)", fontSize:12 }}>—</span>;
}

// ── Main table ───────────────────────────────────────────────────────────────
export default function RawSamplesTable({ competitionId, isOrganizer, version }) {
    const [samples,      setSamples]      = useState([]);
    const [columns,      setColumns]      = useState([]);
    const [taskType,     setTaskType]     = useState("");
    const [total,        setTotal]        = useState(0);
    const [page,         setPage]         = useState(1);
    const [pageCount,    setPageCount]    = useState(1);
    const [status,       setStatus]       = useState("all");
    const [search,       setSearch]       = useState("");
    const [loading,      setLoading]      = useState(false);
    const [updating,     setUpdating]     = useState(null);
    const [revalidating, setRevalidating] = useState(false);
    const [revalMsg,     setRevalMsg]     = useState(null);
    const [error, setError] = useState("");

    const load = useCallback(() => {
        setLoading(true);
        const params = new URLSearchParams({ page, page_size: 20 });
        if (status !== "all") params.set("status", status);
        if (search)           params.set("search", search);
        if (version)          params.set("version", version);

        fetch(`${API}/competitions/${competitionId}/samples?${params}`, { headers: authHeader() })
            .then(r => { if (!r.ok) throw new Error("Could not load samples. Please try again."); return r.json(); })
            .then(d => {
                setError("");
                setSamples(d.items || []);
                setTotal(d.total || 0);
                setPageCount(d.pages || 1);
                if (d.columns)   setColumns(d.columns);
                if (d.task_type) setTaskType(d.task_type);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [competitionId, page, status, search, version]);

    useEffect(() => { load(); }, [load]);

    // Annotator vote: approve / flag / reject
    const handleApprove = async (sampleId, action, note) => {
        setUpdating(sampleId);
        try {
            await fetch(`${API}/data-samples/${sampleId}/approve`, {
                method: "POST",
                headers: { "Content-Type":"application/json", ...authHeader() },
                body: JSON.stringify({ action, note }),
            });
            load();
        } catch (e) { console.error(e); }
        finally { setUpdating(null); }
    };

    // Direct status override — any member, any transition
    const handleStatusChange = async (sampleId, newStatus) => {
        setUpdating(sampleId);
        try {
            const res = await fetch(`${API}/data-samples/${sampleId}/status`, {
                method: "PATCH",
                headers: { "Content-Type":"application/json", ...authHeader() },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                // Surface the 2-annotator error message clearly
                alert(d.detail || "Could not update status.");
                return;
            }
            load();
        } catch (e) { console.error(e); }
        finally { setUpdating(null); }
    };

    const triggerRevalidate = async () => {
        setRevalidating(true); setRevalMsg(null);
        try {
            const res = await fetch(`${API}/competitions/${competitionId}/revalidate`,
                { method:"POST", headers:authHeader() });
            const d = await res.json();
            setRevalMsg(`✓ ${d.message}`);
            setTimeout(() => { load(); setRevalMsg(null); }, 3500);
        } catch {
            setRevalMsg("⚠ Revalidation request failed");
        } finally { setRevalidating(false); }
    };

    return <RawSamplesTableView model={{ samples, columns, taskType, total, page, pageCount, status, search, loading, updating, revalidating, revalMsg, error }} actions={{ setSearch, setStatus, setPage, triggerRevalidate, handleApprove, handleStatusChange, load }} />;
}

export function RawSamplesTableView({ model, actions }) {
  useInterfaceLanguage();
    const { samples, columns, taskType, total, page, pageCount, status, search, loading, updating, revalidating, revalMsg, error } = model;
    const { setSearch, setStatus, setPage, triggerRevalidate, handleApprove, handleStatusChange, load } = actions;
    const visibleCols = columns.filter(c => c.key !== "actions");
    const hasActions  = true; // always show actions column — no organizer gate

    return (
        <div className="raw-samples" style={{
            background:"var(--color-background-primary,var(--lx-surface, #fff))",
            border:"0.5px solid var(--color-border-tertiary)",
            borderRadius:12, display:"flex", flexDirection:"column",
        }}>
            {/* Toolbar */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                flexWrap:"wrap", gap:10, padding:"14px 18px",
                borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:11, fontWeight:500, letterSpacing:".08em",
                        textTransform:"uppercase", color:"var(--color-text-secondary)" }}>
                        {taskType.replace(/_/g," ")}{" "}{__msg("Samples")}{" "}</span>
                    <span style={{ fontSize:11, fontWeight:500, padding:"1px 8px",
                        background:"var(--color-background-secondary)",
                        border:"0.5px solid var(--color-border-tertiary)",
                        borderRadius:99, color:"var(--color-text-secondary)" }}>
                        {total.toLocaleString(document.documentElement.lang)}
                    </span>
                </div>

                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <input
                        style={{ fontSize:13, padding:"5px 10px", borderRadius:7,
                            border:"0.5px solid var(--color-border-tertiary)",
                            background:"var(--color-background-secondary)",
                            color:"var(--color-text-primary)", width:170, outline:"none" }}
                        aria-label={__msg("Search samples")} placeholder={__msg("Search samples…")}
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                    />
                    <select aria-label={__msg("Filter sample status")}
                        style={{ fontSize:13, padding:"5px 10px", borderRadius:7,
                            border:"0.5px solid var(--color-border-tertiary)",
                            background:"var(--color-background-secondary)",
                            color:"var(--color-text-primary)", cursor:"pointer" }}
                        value={status}
                        onChange={e => { setStatus(e.target.value); setPage(1); }}
                    >
                        {["all","pending","scored","can_be_validated","validated","flagged","rejected"].map(s => (
                            <option key={s} value={s}>
                                {s==="all" ? __msg("All statuses")
                                    : s==="can_be_validated" ? __msg("Ready to validate")
                                    : s==="scored" ? __msg("Scored (needs approval)")
                                    : s.charAt(0).toUpperCase()+s.slice(1)}
                            </option>
                        ))}
                    </select>

                    <button onClick={triggerRevalidate} disabled={revalidating} style={{
                        fontSize:12, padding:"5px 12px", borderRadius:7,
                        border:"0.5px solid var(--color-border-tertiary)",
                        background: revalidating
                            ? "var(--color-background-secondary)"
                            : "var(--color-background-info,var(--lx-teal-soft, #e6f1fb))",
                        color: revalidating
                            ? "var(--color-text-secondary)"
                            : "var(--color-text-info,var(--lx-teal, #185fa5))",
                        cursor: revalidating ? "not-allowed" : "pointer",
                        fontWeight:500, whiteSpace:"nowrap",
                    }}>
                        {revalidating ? __msg("Running…") : __msg("⟳ Re-score All")}
                    </button>
                </div>
            </div>

            {/* Status legend */}
            <div style={{ display:"flex", gap:14, padding:"7px 18px",
                borderBottom:"0.5px solid var(--color-border-tertiary)",
                background:"var(--color-background-secondary)", flexWrap:"wrap" }}>
                {[
                    { s:"pending",          color:"var(--lx-ink, #B49146)", t:"Awaiting scoring" },
                    { s:"scored",           color:"var(--lx-muted, #777193)", t:"Ready for approval" },
                    { s:"can_be_validated", color:"var(--lx-ink, #211F54)", t:"2 approvals — click Validate" },
                    { s:"validated",        color:"var(--lx-teal, #398C92)", t:"In dataset" },
                    { s:"flagged",          color:"var(--lx-gold, #BB8B51)", t:"Needs review" },
                    { s:"rejected",         color:"var(--lx-coral, #B96864)", t:"Failed — restorable" },
                ].map(({ s, color, t }) => (
                    <span key={s} style={{ fontSize:10, display:"flex", alignItems:"center", gap:4 }}>
                        <span style={{ width:7, height:7, borderRadius:"50%",
                            background:color, flexShrink:0 }} />
                        <b style={{ color }}>
                            {s === "can_be_validated" ? __msg("Ready") : s.charAt(0).toUpperCase()+s.slice(1)}
                        </b>
                        {" — "}{t}
                    </span>
                ))}
            </div>

            {revalMsg && (
                <div style={{ padding:"8px 18px", fontSize:12,
                    background:"var(--color-background-success,var(--lx-teal-soft, #eaf3de))",
                    color:"var(--color-text-success,var(--lx-ink, #3b6d11))",
                    borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
                    {revalMsg}
                </div>
            )}

            {/* Table */}
            <div className="raw-table-scroll" role="region" aria-label={__msg("Validation samples table")} tabIndex={0} style={{ overflowX:"auto" }}>
                <table aria-label={__msg("Validation samples")} style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead>
                        <tr style={{ borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
                            {visibleCols.map(c => (
                                <th key={c.key} style={{ padding:"10px 14px", textAlign:"left",
                                    fontSize:10, fontWeight:500, letterSpacing:".07em",
                                    color:"var(--color-text-secondary)", textTransform:"uppercase",
                                    whiteSpace:"nowrap" }}>{__msg(c.label)}</th>
                            ))}
                            <th style={{ padding:"10px 14px", textAlign:"left",
                                fontSize:10, fontWeight:500, letterSpacing:".07em",
                                color:"var(--color-text-secondary)", textTransform:"uppercase",
                                whiteSpace:"nowrap", minWidth:200 }}>{__msg("Actions")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {error && !loading ? <tr><td colSpan={visibleCols.length+1} role="alert" style={{padding:25}}>{__msg(error)} <button type="button" onClick={load}>{__msg("Try again")}</button></td></tr> : loading ? (
                            <tr><td colSpan={visibleCols.length + 1}
                                style={{ padding:"32px 0", textAlign:"center",
                                    color:"var(--color-text-secondary)" }}>{__msg("Loading…")}</td></tr>
                        ) : samples.length === 0 ? (
                            <tr><td colSpan={visibleCols.length + 1}
                                style={{ padding:"40px 0", textAlign:"center",
                                    color:"var(--color-text-secondary)" }}>{" "}{__msg("No samples found.")}{" "}{status !== "all" && (
                                    <span>&nbsp;<button onClick={() => setStatus("all")} style={{
                                        fontSize:12, color:"var(--color-text-info,var(--lx-teal, #185fa5))",
                                        background:"none", border:"none", cursor:"pointer",
                                        textDecoration:"underline" }}>{__msg("Clear filter")}</button></span>
                                )}
                            </td></tr>
                        ) : samples.map((s, i) => (
                            <tr key={s.id} style={{
                                borderBottom:"0.5px solid var(--color-border-tertiary)",
                                background: i%2===0 ? "transparent" : "var(--color-background-secondary)",
                                opacity: updating === s.id ? 0.6 : 1,
                            }}>
                                {visibleCols.map(c => (
                                    <td key={c.key} style={{ padding:"10px 14px",
                                        maxWidth: c.key==="id" ? 90 : 180,
                                        overflow:"hidden", textOverflow:"ellipsis" }}>
                                        <CellValue colKey={c.key} sample={s} />
                                    </td>
                                ))}
                                <td style={{ padding:"10px 14px" }}>
                                    {updating === s.id ? (
                                        <span style={{ fontSize:12,
                                            color:"var(--color-text-secondary)" }}>…</span>
                                    ) : (
                                        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                                            {/* Vote buttons for scored/flagged/ready samples */}
                                            <ApproveActions
                                                sample={s}
                                                onAction={handleApprove}
                                                updating={updating === s.id}
                                            />
                                            {/* Universal status change buttons for all members */}
                                            <StatusActions
                                                sample={s}
                                                onStatusChange={handleStatusChange}
                                                updating={updating === s.id}
                                            />
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"12px 18px", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
                <button disabled={page<=1 || loading} onClick={() => setPage(p => p-1)} style={{
                    fontSize:13, padding:"5px 14px", borderRadius:7,
                    border:"0.5px solid var(--color-border-tertiary)",
                    background:"var(--color-background-secondary)",
                    color: page<=1 ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                    cursor: page<=1 ? "not-allowed" : "pointer",
                }}>{__msg("← Prev")}</button>
                <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{" "}{__msg("Page")}{" "}{page} / {pageCount}
                </span>
                <button disabled={page>=pageCount || loading} onClick={() => setPage(p => p+1)} style={{
                    fontSize:13, padding:"5px 14px", borderRadius:7,
                    border:"0.5px solid var(--color-border-tertiary)",
                    background:"var(--color-background-secondary)",
                    color: page>=pageCount ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                    cursor: page>=pageCount ? "not-allowed" : "pointer",
                }}>{__msg("Next →")}</button>
            </div>
        </div>
    );
}