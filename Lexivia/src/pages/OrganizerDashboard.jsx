import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import Modal from "../components/Modal";
import { notify } from "../components/Notify";
import { ArrowLeft, ArrowUpRight, Users, Database, Trophy, FileCheck2, Pencil, Trash2, ShieldCheck, AlertCircle, LoaderCircle, Layers3 } from "lucide-react";
import { loadOrganizerDashboard } from './organizerDashboardData.js';
import TeamsModal from "../components/organizer/TeamsModal";
import JoinRequestsModal from "../components/organizer/JoinRequestsModal";
import SubmissionsModal from "../components/organizer/SubmissionsModal";
import DataModal from "../components/organizer/DataModal";
import { pretty } from "../components/organizer/format";
import "../styles/OrganizerDashboard.css";

const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

function money(value) {
    if (value === null || value === undefined || value === "") return null;
    return `$${Number(value).toLocaleString(document.documentElement.lang)}`;
}

function getToken() {
    return (
        localStorage.getItem("token") ||
        localStorage.getItem("access_token") ||
        localStorage.getItem("jwt")
    );
}

function authHeader() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtScore(value) {
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    if (Number.isNaN(n)) return "—";
    return n.toFixed(4);
}

function TopPerformersPanel({ competitionId, hasSubmissions }) {
  useInterfaceLanguage();
    const navigate = useNavigate();

    const [leaderboard, setLeaderboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchLeaderboard = useCallback(
        async (silent = false) => {
            if (!silent) setLoading(true);
            setError("");

            try {
                const res = await fetch(`${API}/competitions/${competitionId}/leaderboard-rich`, {
                    headers: authHeader(),
                });

                if (res.status === 401) {
                    setError("Session expired. Please log in again.");
                    return;
                }

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.detail || "Could not load leaderboard.");
                }

                setLeaderboard(data);
            } catch (err) {
                setError(err.message || "Could not load leaderboard.");
            } finally {
                if (!silent) setLoading(false);
            }
        },
        [competitionId]
    );

    useEffect(() => {
        if (!hasSubmissions) return undefined;
        fetchLeaderboard();

        const interval = setInterval(() => {
            fetchLeaderboard(true);
        }, 30000);

        return () => clearInterval(interval);
    }, [fetchLeaderboard, hasSubmissions]);

    const entries = leaderboard?.entries ?? [];
    const topEntries = entries.slice(0, 3);
    const primaryMetric = leaderboard?.primary_metric || "Score";

    if (!hasSubmissions || (!loading && !error && !entries.length)) return null;

    return (
        <div className="panel top-performers-panel">
            <div className="section-row">
                <h2>{__msg("Top Performers")}</h2>
                <span>{entries.length}{" "}{__msg("ranked")}</span>
            </div>

            {loading ? (
                <div className="empty-state">
                    <strong>{__msg("Loading leaderboard...")}</strong>
                    <p>{__msg("Fetching latest validated submissions.")}</p>
                </div>
            ) : error ? (
                <div className="empty-state">
                    <strong>{__msg("Could not load leaderboard")}</strong>
                    <p>{__msg(error)}</p>
                </div>
            ) : topEntries.length === 0 ? (
                <div className="empty-state">
                    <strong>{__msg("No leaderboard yet")}</strong>
                    <p>{__msg("Top teams will appear after model submissions are validated.")}</p>
                </div>
            ) : (
                <div className="top-performers-list">
                    {topEntries.map((entry, index) => {
                        const rank = entry.rank ?? index + 1;
                        const name = entry.team_name || entry.user_name || __msg("Unknown participant");

                        return (
                            <div className="top-performer-card" key={entry.submission_id || rank}>
                                <div className="top-performer-left">
                                    <span className={`top-rank top-rank-${rank}`}>#{rank}</span>

                                    <div>
                                        <strong>{name}</strong>
                                        <p>
                                            {entry.team_name
                                                ? __msg("Submitted by {value0}", {value0: entry.user_name || __msg("Unknown")})
                                                : __msg("Solo participant")}
                                        </p>
                                    </div>
                                </div>

                                <div className="top-performer-score">
                                    <strong>{fmtScore(entry.score)}</strong>
                                    <span>{primaryMetric}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {entries.length > 0 && (
                <div className="leaderboard-mini-footer">
                    <span>{__msg("Best score:")}{" "}{fmtScore(entries[0]?.score)}</span>
                    <span>{__msg("Updated automatically")}</span>
                </div>
            )}

            <button
                className="full-btn"
                type="button"
                onClick={() => navigate(`/competitions/${competitionId}/leaderboard`)}
            >{" "}{__msg("View Full Leaderboard")}{" "}</button>
        </div>
    );
}

function OrganizerDashboard() {
  useInterfaceLanguage();
    const { competitionId } = useParams();
    const navigate = useNavigate();

    const [competition, setCompetition] = useState(null);
    const [monitoring, setMonitoring] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [retry, setRetry] = useState(0);

    const [datasets, setDatasets] = useState([]);
    const [, setDatasetsLoading] = useState(false);

    const [joinRequests, setJoinRequests] = useState([]);
    const [requestsLoading, setRequestsLoading] = useState(false);

    const [teamsData, setTeamsData] = useState(null);
    const [teamsLoading, setTeamsLoading] = useState(false);

    const [submissions, setSubmissions] = useState([]);
    const [submissionsLoading, setSubmissionsLoading] = useState(false);
    const [annotationStats, setAnnotationStats] = useState(null);
    // which detail view is open: teams | people | requests | data | submissions | null
    const [panel, setPanel] = useState(null);

    const token = getToken();

    const fetchTeams = useCallback(async () => {
        if (!token) return;

        setTeamsLoading(true);

        try {
            const res = await fetch(`${API}/competitions/${competitionId}/teams`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                throw new Error("Could not load teams");
            }

            const data = await res.json();
            setTeamsData(data);
        } catch (error) {
            console.error(error);
            setTeamsData(null);
        } finally {
            setTeamsLoading(false);
        }
    }, [competitionId, token]);

    const fetchSubmissions = useCallback(async () => {
        if (!token) return;

        setSubmissionsLoading(true);

        try {
            const res = await fetch(`${API}/competitions/${competitionId}/organizer-submissions`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                throw new Error("Could not load submissions");
            }

            const data = await res.json();
            setSubmissions(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error(error);
            setSubmissions([]);
        } finally {
            setSubmissionsLoading(false);
        }
    }, [competitionId, token]);

    const fetchDatasets = useCallback(async () => {
        if (!token) return;

        setDatasetsLoading(true);

        try {
            const res = await fetch(`${API}/competitions/${competitionId}/datasets`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                throw new Error("Could not load datasets");
            }

            const data = await res.json();
            setDatasets(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error(error);
            setDatasets([]);
        } finally {
            setDatasetsLoading(false);
        }
    }, [competitionId, token]);

    const fetchJoinRequests = useCallback(async () => {
        if (!token) return;

        setRequestsLoading(true);

        try {
            const res = await fetch(`${API}/competitions/${competitionId}/join-requests`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (res.ok) {
                const data = await res.json();
                setJoinRequests(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setRequestsLoading(false);
        }
    }, [competitionId, token]);

    const fetchAnnotationStats = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${API}/competitions/${competitionId}/annotation/stats`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setAnnotationStats(await res.json());
        } catch (error) {
            console.error("Unable to load annotation progress", error);
        }
    }, [competitionId, token]);

    const handleJoinRequestAction = async (requestId, action) => {
        try {
            const res = await fetch(
                `${API}/competitions/${competitionId}/join-requests/${requestId}/${action}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (!res.ok) {
                const e = await res.json();
                throw new Error(e.detail || "Action failed");
            }

            setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
            if (action === "approve") {
                fetchTeams();
                fetch(`${API}/competitions/${competitionId}/monitoring`, { headers: authHeader() })
                    .then((r) => r.json()).then(setMonitoring).catch(() => {});
            }
        } catch (error) {
            notify.error("Could not update request", error.message);
        }
    };

    async function handleDeleteCompetition() {
        try {
            const res = await fetch(`${API}/competitions/${competitionId}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.detail || "Delete failed");
            }

            notify.success("Competition deleted successfully.");
            navigate("/competitions?tab=organizing");
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setLoadError(null);
        setCompetition(null);
        setMonitoring(null);
        setPanel(null);
        if (!token) {
            setLoadError({kind:'session',message:'Session expired. Please log in again.'});
            setLoading(false);
            return () => controller.abort();
        }
        loadOrganizerDashboard((url,options)=>fetch(url,{...options,headers:{Authorization: 'Bearer '+token}}),API,competitionId,controller.signal)
          .then(({competition,monitoring})=>{
            if (controller.signal.aborted) return;
            setCompetition(competition);
            setMonitoring(monitoring);
            fetchDatasets(); fetchJoinRequests(); fetchTeams(); fetchSubmissions();
            if (competition.data_collection_enabled) fetchAnnotationStats();
          }).catch(error=>{
            if (!controller.signal.aborted) setLoadError({kind:error.kind || 'error',message:error.kind ? error.message : 'Could not load organizer dashboard.'});
          }).finally(()=>{if (!controller.signal.aborted) setLoading(false);});
        return () => controller.abort();
    }, [competitionId, token, retry, fetchDatasets, fetchJoinRequests, fetchTeams, fetchSubmissions, fetchAnnotationStats]);

    useEffect(() => {
        if (!token || !competition || loadError) return;
        const controller = new AbortController();
        const interval = setInterval(() => {
            loadOrganizerDashboard((url,options)=>fetch(url,{...options,headers:{Authorization: 'Bearer '+token}}),API,competitionId,controller.signal)
              .then(({monitoring})=>{if (!controller.signal.aborted) setMonitoring(monitoring);})
              .catch(error=>{
                if (!controller.signal.aborted && ['session','access','missing'].includes(error.kind)) {
                    setLoadError({kind:error.kind,message:error.message}); setPanel(null);
                }
              });
        },10000);
        return () => {controller.abort();clearInterval(interval);};
    }, [competitionId, token, competition, loadError]);

    return <OrganizerDashboardView competitionId={competitionId} competition={competition} monitoring={monitoring} loading={loading} loadError={loadError}
      onRetry={()=>setRetry(value=>value+1)} joinRequests={joinRequests} annotationStats={annotationStats} panel={panel} setPanel={setPanel}
      teamsData={teamsData} teamsLoading={teamsLoading} requestsLoading={requestsLoading} datasets={datasets} submissions={submissions} submissionsLoading={submissionsLoading}
      onJoinRequestAction={handleJoinRequestAction} onDelete={handleDeleteCompetition}/>;
}

export function OrganizerDashboardView({competitionId,competition,monitoring,loading=false,loadError=null,onRetry=()=>{},joinRequests=[],annotationStats=null,panel=null,setPanel=()=>{},teamsData=null,teamsLoading=false,requestsLoading=false,datasets=[],submissions=[],submissionsLoading=false,onJoinRequestAction=()=>{},onDelete=async()=>{}}) {
    useInterfaceLanguage();
    const navigate=useNavigate();
    const [deleteOpen,setDeleteOpen]=useState(false);
    const [deleting,setDeleting]=useState(false);
    const [deleteError,setDeleteError]=useState('');
    const closeDelete=()=>{if (!deleting) {setDeleteOpen(false);setDeleteError('');}};
    async function confirmDelete() {
      setDeleting(true);setDeleteError('');
      try {await onDelete();setDeleteOpen(false);}
      catch(error){setDeleteError(error.message || 'Could not delete competition.');}
      finally{setDeleting(false);}
    }
    const timelineItems = useMemo(() => {
        if (!competition) return [];
        const cfg = competition.task_config || {};
        if (competition.phases_enabled && Array.isArray(cfg.phases) && cfg.phases.length) {
            return [...cfg.phases].sort((a, b) => (a.order || 0) - (b.order || 0))
                .filter(p => p.name?.trim())
                .map(p => ({ title: p.name, customTitle: true, detail: p.durationDays ? `${p.durationDays} days` : "" }));
        }
        return [
            { title: "Competition starts", detail: competition.start_date },
            { title: "Validation", detail: competition.validation_date },
            { title: "Leaderboard freeze", detail: competition.freeze_date },
            { title: "Competition ends", detail: competition.end_date },
        ].filter(item => item.detail);
    }, [competition]);

    if (loading || loadError || !competition || !monitoring) {
      const kind=loadError?.kind;
      const title=loading?'Loading organizer dashboard...':kind==='access'?'Organizer access required':kind==='session'?'Please sign in again':kind==='missing'?'Competition not found':'Could not load organizer dashboard';
      return <div className="organizer-layout organizer-refresh"><Sidebar/><div className="organizer-workspace"><Topbar/><main className="organizer-main"><section className="organizer-state" role={loading?'status':'alert'}>
        <span className="organizer-state-icon">{loading?<LoaderCircle className="organizer-spin" size={28}/>:kind==='access'?<ShieldCheck size={28}/>:<AlertCircle size={28}/>}</span>
        <span className="organizer-eyebrow">{__msg('ORGANIZER WORKSPACE')}</span><h1>{__msg(title)}</h1>
        <p>{__msg(loadError?.message || (loading?'Getting your competition workspace ready.':'Could not load organizer dashboard.'))}</p>
        {!loading && <div className="organizer-state-actions">{kind==='session'?<button className="organizer-primary" onClick={()=>navigate('/login')}>{__msg('Log in')}</button>:kind==='error'?<button className="organizer-primary" onClick={onRetry}>{__msg('Try again')}</button>:null}<button onClick={()=>navigate(kind==='access' ? '/competitions/'+competitionId : '/competitions')}>{__msg(kind==='access'?'Public page':'Back to competitions')}</button></div>}
      </section></main></div></div>;
    }

    const manual = competition.join_method === "manual";
    const pending = joinRequests.length;
    const tasks = competition.tasks || [];
    const assets = competition.assets || [];
    const cfg = competition.task_config || {};
    const skills = (() => {
        try { return JSON.parse(competition.required_skills || "[]"); } catch { return []; }
    })();
    const skillRules = cfg.team_requirements?.skill_members || {};
    const targetOf = (t) =>
        t.target?.type === "SAMPLE" ? "the whole sample"
        : t.target?.type === "TASK_OUTPUT" ? `the output of ${tasks.find((x) => x.key === t.target.ref)?.name || "?"}`
        : assets.find((a) => a.key === t.target?.ref)?.name || "an asset";

    const collectionEnabled = !!competition.data_collection_enabled;
    const annotationTotals = annotationStats?.configured ? annotationStats.totals : null;
    const unresolved = annotationTotals?.conflicts_to_resolve || 0;
    const prize = money(competition.prize_pool);
    const cards = [
        { key: "people", label: "Participants", value: monitoring.participants_count ?? 0, note: "View participant roster", open: "people" },
        { key: "teams", label: "Teams", value: monitoring.teams_count ?? 0, note: "View registered teams", open: "teams" },
        ...(manual ? [{ key: "requests", label: "Join requests", value: pending, note: pending ? "Awaiting your review" : "No pending requests", open: "requests", alert: pending > 0 }] : []),
        ...(collectionEnabled ? [{ key: "data", label: "Samples", value: monitoring.samples_count ?? 0, note: "Collection & annotation", open: "data" }] : []),
        ...(monitoring.submissions_count > 0 ? [{ key: "subs", label: "Submissions", value: monitoring.submissions_count, note: "View all model submissions", open: "submissions" }] : []),
        ...(prize !== null ? [{ key: "prize", label: "Prize pool", value: prize, note: "Configured award" }] : []),
    ];
    const showEligibility = manual || competition.min_members != null || competition.max_members != null ||
        skills.length > 0 || (competition.tracks_enabled && (cfg.tracks || []).length > 0);
    const hasStructure = assets.length > 0 || tasks.length > 0;
    const showEvaluation = Boolean(competition.primary_metric || competition.secondary_metric);
    const hasConfiguredOverview = hasStructure || showEligibility || showEvaluation || timelineItems.length > 0;

    return (
        <div className="organizer-layout organizer-refresh">
            <Sidebar />
            <div className="organizer-workspace"><Topbar/>
            <main className="organizer-main">
                <section className="organizer-header">
                    <div>
                        <button className="back-btn" type="button" onClick={() => navigate("/competitions?tab=organizing")}><ArrowLeft size={15}/>{__msg("Back to competitions")}</button>
                        <p className="organizer-eyebrow">{__msg('ORGANIZER WORKSPACE')}</p>
                        <div className="organizer-title-row">
                            <h1>{competition.title}</h1>
                            <span className="badge badge-open">{__msg(competition.status)}</span>
                            <span className="badge badge-organizing">{__msg("ORGANIZING")}</span>
                        </div>
                        <p>{__msg("Manage participants, data and annotation, and track progress.")}</p>
                    </div>

                    <div className="organizer-actions">
                        <button type="button" onClick={() => navigate(`/competitions/${competitionId}`)}>{__msg("Public page")}<ArrowUpRight size={15}/></button>
                        <button type="button" className="organizer-primary" onClick={() => navigate(`/edit-competition/${competitionId}`, { state: { competition } })}><Pencil size={14}/>{__msg("Edit Competition")}</button>
                        <button type="button" className="danger" onClick={()=>setDeleteOpen(true)}><Trash2 size={14}/>{__msg("Delete")}</button>
                    </div>
                </section>

                {(pending > 0 || unresolved > 0) && (
                    <button type="button" className="attention-banner" onClick={() => setPanel(pending > 0 ? "requests" : "data")}>
                        {pending > 0 ? __msg("Join requests awaiting review: {count}", {count:pending}) : __msg("Annotation conflicts to resolve: {count}", {count:unresolved})} →
                    </button>
                )}

                <section className="stat-grid">
                    {cards.map((c) => {
                        const Icon=({people:Users,teams:Layers3,requests:FileCheck2,data:Database,subs:FileCheck2,prize:Trophy})[c.key];
                        return (
                        <button
                            key={c.key}
                            type="button"
                            disabled={!c.open}
                            className={`stat-card ${c.open ? "clickable" : ""} ${c.alert ? "stat-alert" : ""}`}
                            onClick={() => c.open && setPanel(c.open)}
                        >
                            <div className="organizer-stat-head"><span>{__msg(c.label)}</span><span className="organizer-stat-icon"><Icon size={20}/></span></div>
                            <strong>{c.value}</strong>
                            <div className="organizer-stat-foot"><p>{__msg(c.note)}</p>{c.open && <ArrowUpRight size={15}/>}</div>
                        </button>
                    );})}
                </section>

                {collectionEnabled && annotationTotals && (
                    <section className="organizer-progress panel" aria-label={__msg("Annotation progress")}>
                        <div className="organizer-progress-title"><h2>{__msg("Annotation progress")}</h2>
                            <button type="button" onClick={() => setPanel("data")}>{__msg("View details →")}</button></div>
                        <div className="organizer-progress-stats">
                            <span><strong>{annotationTotals.completed}</strong>{" "}{__msg("completed")}</span>
                            <span><strong>{annotationTotals.partial}</strong>{" "}{__msg("partial")}</span>
                            <span><strong>{annotationTotals.not_started}</strong>{" "}{__msg("not started")}</span>
                            {unresolved > 0 && <span className="organizer-progress-warning"><strong>{unresolved}</strong>{" "}{__msg("conflicts to resolve")}</span>}
                        </div>
                        <div className="organizer-progress-track" role="progressbar" aria-label={__msg("Samples completed")}
                            aria-valuenow={annotationTotals.completed} aria-valuemin={0} aria-valuemax={annotationTotals.total || 1}>
                            <div style={{ width: `${annotationTotals.total ? 100 * annotationTotals.completed / annotationTotals.total : 0}%` }} />
                        </div>
                    </section>
                )}

                <section className="organizer-content-grid">
                    <div className="panel large-panel">
                        <div className="organizer-overview-head"><h2>{__msg("Competition overview")}</h2>
                            <button type="button" onClick={() => navigate(`/edit-competition/${competitionId}`, { state: { competition } })}>{__msg("Edit setup →")}</button></div>
                        <p className="overview-text">{competition.description}</p>

                        {!hasConfiguredOverview && <p className="detail-empty">{__msg("Competition configuration can be managed using Edit setup.")}</p>}
                        <div className="setup-sections">
                            {hasStructure && <details className="setup-section" open>
                                <summary>{__msg("Sample structure & tasks")}{" "}<em>{assets.length}{" "}{__msg("asset(s) ·")}{" "}{tasks.length}{" "}{__msg("task(s)")}</em></summary>
                                {assets.length === 0 && tasks.length === 0 ? (
                                    <p className="detail-empty">{__msg("No sample structure defined. Edit the competition to add assets and tasks.")}</p>
                                ) : (
                                    <>
                                        <div className="chip-row">
                                            {assets.map((a) => <span key={a.key} className="chip">{a.name} · {a.type}</span>)}
                                        </div>
                                        <ul className="task-list">
                                            {tasks.map((t) => (
                                                <li key={t.key}>
                                                    <b>{t.name}</b>
                                                    <span>{__msg(pretty(t.type))}{" "}{__msg("· applies to")}{" "}{targetOf(t)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </details>}

                            {showEligibility && <details className="setup-section">
                                <summary>{__msg("Joining & eligibility")}{" "}<em>{manual ? __msg("manual approval") : __msg("automatic")}</em></summary>
                                <ul className="task-list">
                                    {(competition.min_members != null || competition.max_members != null) && <li><b>{__msg("Team size")}</b><span>{competition.min_members || competition.max_members
                                        ? __msg("{value0}–{value1} members", {value0: competition.min_members || 1, value1: competition.max_members || __msg("any")})
                                        : __msg("No requirement")}</span></li>}
                                    {skills.map((s) => (
                                        <li key={s}><b>{s}</b><span>{skillRules[s] === "all" ? __msg("Every member needs it") : skillRules[s] > 1 ? __msg("At least {value0} members need it", {value0: skillRules[s]}) : __msg("At least one member needs it")}</span></li>
                                    ))}
                                    {competition.tracks_enabled && (cfg.tracks || []).length > 0 && (
                                        <li><b>{__msg("Tracks")}</b><span>{(cfg.tracks || []).map((t) => t.name).join(", ") || "None"}{" "}{__msg("— participants must choose one")}</span></li>
                                    )}
                                </ul>
                            </details>}

                            {showEvaluation && <details className="setup-section">
                                <summary>{__msg("Evaluation")}{" "}<em>{competition.primary_metric || __msg("not selected")}</em></summary>
                                <p className="sub">{competition.primary_metric && __msg("Primary: {value0}", {value0: competition.primary_metric})}{competition.secondary_metric && __msg(" · Secondary: {value0}", {value0: competition.secondary_metric})}</p>
                            </details>}

                            {timelineItems.length > 0 && <details className="setup-section">
                                <summary>{competition.phases_enabled ? __msg("Phases") : __msg("Timeline")}</summary>
                                <ul className="task-list">
                                    {timelineItems.map((item, index) => (
                                        <li key={index}><b>{item.customTitle ? item.title : __msg(item.title)}</b><span>{__msg(item.detail)}</span></li>
                                    ))}
                                </ul>
                            </details>}
                        </div>
                    </div>

                    <TopPerformersPanel competitionId={competitionId} hasSubmissions={monitoring.submissions_count > 0} />
                </section>
            </main></div>

            {(panel === "teams" || panel === "people") && (
                <TeamsModal competition={competition} teamsData={teamsData} loading={teamsLoading}
                    initialTab={panel === "people" ? "people" : "teams"} onClose={() => setPanel(null)} />
            )}
            {panel === "requests" && (
                <JoinRequestsModal requests={joinRequests} loading={requestsLoading}
                    onAction={onJoinRequestAction} onClose={() => setPanel(null)} />
            )}
            {panel === "data" && (
                <DataModal competition={competition} competitionId={competitionId} monitoring={monitoring}
                    datasets={datasets} onClose={() => setPanel(null)} />
            )}
            {panel === "submissions" && (
                <SubmissionsModal submissions={submissions} loading={submissionsLoading} onClose={() => setPanel(null)} />
            )}
            {deleteOpen && <Modal className="organizer-dialog" title={__msg('Delete competition?')} onClose={closeDelete} dismissible={!deleting} footer={<><button className="organizer-secondary" disabled={deleting} onClick={closeDelete}>{__msg('Cancel')}</button><button className="organizer-delete-confirm" disabled={deleting} onClick={confirmDelete}>{deleting?__msg('Deleting…'):__msg('Delete competition')}</button></>}>
              <span className="organizer-delete-icon"><Trash2 size={24}/></span><p>{__msg('Delete "{name}" and its competition data? This cannot be undone.',{name:competition.title})}</p>
              {deleteError && <p role="alert" className="organizer-dialog-error">{__msg(deleteError)}</p>}
            </Modal>}
        </div>
    );
}

export default OrganizerDashboard;
