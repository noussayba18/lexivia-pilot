import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../styles/CompetitionDetails.css";
import Topbar from "../components/Topbar";
import Sidebar from "../components/Sidebar";
import JoinCompetitionModal from "../components/JoinCompetitionModal";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function safeJson(value, fallback = []) {
    try {
        if (!value) return fallback;
        if (Array.isArray(value)) return value;
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function money(value) {
    if (value === null || value === undefined || value === "") return "TBD";
    if (String(value).startsWith("$")) return value;
    return `$${Number(value).toLocaleString(document.documentElement.lang)}`;
}

function fmtScore(value) {
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    if (Number.isNaN(n)) return "—";
    return n.toFixed(4);
}

function complexityText(level) {
    if (level === 0) return "Level 1: Beginner";
    if (level === 1) return "Level 2: Intermediate";
    if (level === 2) return "Level 3: Advanced";
    if (level === 3) return "Level 4: Expert";
    return "Level not selected";
}

function getToken() {
    return localStorage.getItem("token");
}

function authHeader() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function CompetitionDetails() {
    const { competitionId } = useParams();
    const navigate = useNavigate();

    const [competition, setCompetition] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("overview");

    const [monitoring, setMonitoring] = useState(null);
    const [isJoined, setIsJoined] = useState(false);
    const [showJoin, setShowJoin] = useState(false);
    const [joinRules, setJoinRules] = useState(null);
    const [hasPendingRequest, setHasPendingRequest] = useState(false);


    const [datasets, setDatasets] = useState([]);
    const [datasetsLoading, setDatasetsLoading] = useState(false);

    const [leaderboard, setLeaderboard] = useState([]);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);


    const [tracks, setTracks] = useState([]);
    const [tracksLoading, setTracksLoading] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);

        const token = getToken();

        if (!token) {
            navigate("/login");
            return;
        }

        fetch(`${API}/competitions/${competitionId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })
            .then((res) => {
                if (res.status === 401) {
                    navigate("/login");
                    return null;
                }

                if (!res.ok) {
                    throw new Error("Competition not found");
                }

                return res.json();
            })
            .then((data) => {
                if (!data) return;

                setCompetition(data);
                setHasPendingRequest(Boolean(data.has_pending_request));
            })
            .catch((err) => {
                console.error(err);
                alert("Competition not found");
                navigate("/competitions");
            })
            .finally(() => setLoading(false));
    }, [competitionId, navigate]);

    useEffect(() => {
        const token = getToken();

        if (!token) return;

        fetch(`${API}/competitions/${competitionId}/monitoring`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })
            .then((res) => {
                if (!res.ok) throw new Error("Could not load monitoring");
                return res.json();
            })
            .then((data) => {
                setMonitoring(data);

                if (data.user_role === "organizer") {
                    setIsJoined(false);
                }

                if (data.user_role === "participant") {
                    setIsJoined(true);
                }
            })
            .catch((err) => console.error("Monitoring fetch error:", err));
    }, [competitionId]);

    useEffect(() => {
        const token = getToken();

        if (!token) return;

        fetch(`${API}/competitions/${competitionId}/is-joined`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })
            .then((res) => {
                if (!res.ok) throw new Error("Could not check joined status");
                return res.json();
            })
            .then((data) => {
                if (data.user_role === "organizer") {
                    setIsJoined(false);
                } else {
                    setIsJoined(data.joined === true);
                }
            })
            .catch((err) => console.error("Joined check error:", err));
    }, [competitionId]);

    useEffect(() => {
        const token = getToken();

        if (!token) return;

        setDatasetsLoading(true);

        fetch(`${API}/competitions/${competitionId}/datasets`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })
            .then((res) => {
                if (!res.ok) throw new Error("Could not load datasets");
                return res.json();
            })
            .then((data) => {
                setDatasets(Array.isArray(data) ? data : []);
            })
            .catch((err) => {
                console.error("Datasets fetch error:", err);
                setDatasets([]);
            })
            .finally(() => setDatasetsLoading(false));
    }, [competitionId]);

    useEffect(() => {
        const token = getToken();

        if (!token) return;

        setLeaderboardLoading(true);

        fetch(`${API}/competitions/${competitionId}/leaderboard-rich`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })
            .then((res) => {
                if (!res.ok) throw new Error("Could not load leaderboard");
                return res.json();
            })
            .then((data) => {
                setLeaderboard(Array.isArray(data) ? data : (Array.isArray(data?.entries) ? data.entries : []));
            })
            .catch((err) => {
                console.error("Leaderboard fetch error:", err);
                setLeaderboard([]);
            })
            .finally(() => setLeaderboardLoading(false));
    }, [competitionId]);

    // The organizer's team-eligibility rules (size, skills, places) for the Teams tab.
    useEffect(() => {
        if (activeTab !== "teams" || joinRules) return;
        fetch(`${API}/competitions/${competitionId}/join-options`, { headers: authHeader() })
            .then((res) => (res.ok ? res.json() : null))
            .then((d) => d && setJoinRules(d.rules))
            .catch(() => {});
    }, [activeTab, competitionId, joinRules]);

    useEffect(() => {
        const token = getToken();

        if (!token || !competition?.tracks_enabled) return;

        setTracksLoading(true);

        fetch(`${API}/competitions/${competitionId}/tracks`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((res) => {
                if (!res.ok) throw new Error("Could not load tracks");
                return res.json();
            })
            .then((data) => setTracks(Array.isArray(data.tracks) ? data.tracks : []))
            .catch((err) => {
                console.error("Tracks fetch error:", err);
                setTracks([]);
            })
            .finally(() => setTracksLoading(false));
    }, [competitionId, competition?.tracks_enabled]);

    // One join flow: the dialog lets the user join individually or as a team (eligible teams only),
    // choose a track when the competition has tracks, and agree to the rules.
    const handleJoined = (result) => {
        setShowJoin(false);
        if (result?.status === "pending") {
            setHasPendingRequest(true);
            return;
        }
        setIsJoined(true);
        navigate(`/competitions/${competitionId}/${competition?.data_collection_enabled ? "data-collection" : "experiments"}`);
    };

    return <CompetitionDetailsView model={{ competitionId, competition, loading, activeTab, monitoring, isJoined, showJoin, joinRules, hasPendingRequest, datasets, datasetsLoading, leaderboard, leaderboardLoading, tracks, tracksLoading }} actions={{ navigate, setActiveTab, setShowJoin, handleJoined }} />;
}

export function CompetitionDetailsView({ model, actions, joinDialog = null }) {
  useInterfaceLanguage();
    const { competitionId, competition, loading, activeTab, monitoring, isJoined, showJoin, joinRules, hasPendingRequest, datasets, datasetsLoading, leaderboard, leaderboardLoading, tracks, tracksLoading } = model;
    const { navigate, setActiveTab, setShowJoin, handleJoined } = actions;
    const taskConfig = useMemo(() => competition?.task_config || {}, [competition]);
    const phases = useMemo(() => taskConfig.phases || [], [taskConfig]);
    const dataCollectionCfg = useMemo(() => taskConfig.data_collection || {}, [taskConfig]);
    const licenseCfg = useMemo(() => taskConfig.license || {}, [taskConfig]);
    const evaluationCfg = useMemo(() => taskConfig.evaluation_scoring || {}, [taskConfig]);

    const requiredSkills = useMemo(() => {
        return safeJson(competition?.required_skills, []);
    }, [competition]);

    if (loading) return <div className="details-shell"><Sidebar /><div className="details-page"><Topbar /><main className="details-main"><div className="details-loading" role="status">{__msg("Getting your next challenge ready…")}</div></main></div></div>;
    if (!competition) return null;

    const hasPrize = competition.prize_pool !== null && competition.prize_pool !== undefined && competition.prize_pool !== "";
    const prize = hasPrize ? money(competition.prize_pool) : null;

    const normalizedStatus = String(competition.status || "").toUpperCase();
    const isOpen = normalizedStatus === "OPEN";

    const userIsOrganizer =
        monitoring?.is_organizer === true ||
        competition.is_organizer === true ||
        competition.user_role === "organizer";

    const userIsParticipant =
        isJoined ||
        monitoring?.user_role === "participant" ||
        competition.user_role === "participant";

    const validLeaderboard = leaderboard.filter((entry) => entry.score !== null && entry.score !== undefined && Number.isFinite(Number(entry.score)));
    const topLeaderboardEntry = validLeaderboard[0];

    return (
        <div className="details-shell">
            <Sidebar />

            <div className="details-page">
                <Topbar />

                <main className="details-main">
                    <section className="details-hero">
                        <button
                            type="button"
                            className="back-button"
                            onClick={() => {
                                if (window.history.length > 1) {
                                    navigate(-1);
                                } else {
                                    navigate("/competitions");
                                }
                            }}
                        >{" "}{__msg("← Back to Competitions")}{" "}</button>

                        <div>
                            <div className="details-meta"><span className="details-eyebrow">{__msg("THE CHALLENGE")}</span>
                                <span className="requirement-badge">
                                    {normalizedStatus}
                                </span>


                            </div>

                            <h1>{competition.title}</h1>
                            <p className="details-intro">{__msg("Explore the challenge. Find your team. Build something that matters.")}</p>

                            <div className="details-dates">
                                {competition.start_date && <span>{__msg("Starts")}{" "}{competition.start_date}</span>}
                                {competition.end_date && <span>{__msg("Ends")}{" "}{competition.end_date}</span>}
                                {competition.my_track_id && (
                                    <span>{" "}{__msg("▣ Your track:")}{" "}
                                        {(tracks.find((t) => String(t.id) === String(competition.my_track_id)) || {}).name || competition.my_track_id}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="details-hero-actions">
                            {hasPrize && <div className="prize-card">
                                <span>{__msg("PRIZE POOL")}</span>
                                <strong>{prize}</strong>
                            </div>}

                            {userIsOrganizer ? (
                                <button
                                    className="organizer-badge clickable"
                                    onClick={() => navigate(`/competitions/${competitionId}/organizer`)}
                                >{" "}{__msg("Organizer dashboard →")}{" "}</button>
                            ) : userIsParticipant && isOpen ? (
                                <button
                                    className="organizer-badge clickable"
                                    onClick={() => navigate(`/competitions/${competitionId}/${competition.data_collection_enabled ? "data-collection" : "experiments"}`)}
                                >{" "}{__msg("Open workspace →")}{" "}</button>
                            ) : userIsParticipant && !isOpen ? (
                                <button
                                    type="button"
                                    className="join-btn"
                                    disabled
                                    style={{
                                        opacity: 0.75,
                                        cursor: "not-allowed",
                                        background: "var(--lx-raised, #e7e9ed)", color: "var(--lx-muted, #62677a)",
                                    }}
                                >{" "}{__msg("Competition")}{" "}{normalizedStatus}
                                </button>
                            ) : hasPendingRequest ? (
                                <button
                                    type="button"
                                    className="join-btn"
                                    disabled
                                    style={{
                                        opacity: 0.7,
                                        cursor: "not-allowed",
                                        background: "var(--lx-gold-soft, #f7e7be)", color: "var(--lx-ink, #655019)",
                                    }}
                                >{" "}{__msg("⏳ Request Pending…")}{" "}</button>
                            ) : !isOpen ? (
                                <button
                                    type="button"
                                    className="join-btn"
                                    disabled
                                    style={{
                                        opacity: 0.75,
                                        cursor: "not-allowed",
                                        background: "var(--lx-raised, #e7e9ed)", color: "var(--lx-muted, #62677a)",
                                    }}
                                >{" "}{__msg("Competition")}{" "}{normalizedStatus}
                                </button>
                            ) : (
                                <button type="button" className="join-btn" onClick={() => setShowJoin(true)}>
                                    {competition.join_method === "manual" ? __msg("Request to Join →") : __msg("Join Competition →")}
                                </button>
                            )}
                        </div>
                    </section>

                    <nav className="details-tabs" aria-label={__msg("Competition sections")}>
                        <button
                            aria-current={activeTab === "overview" ? "page" : undefined} className={activeTab === "overview" ? "active" : ""}
                            onClick={() => setActiveTab("overview")}
                        >{" "}{__msg("Overview")}{" "}</button>

                        <button
                            aria-current={activeTab === "rules" ? "page" : undefined} className={activeTab === "rules" ? "active" : ""}
                            onClick={() => setActiveTab("rules")}
                        >{" "}{__msg("Rules")}{" "}</button>

                        <button
                            aria-current={activeTab === "datasets" ? "page" : undefined} className={activeTab === "datasets" ? "active" : ""}
                            onClick={() => setActiveTab("datasets")}
                        >{" "}{__msg("Datasets")}{" "}</button>

                        <button
                            aria-current={activeTab === "leaderboard" ? "page" : undefined} className={activeTab === "leaderboard" ? "active" : ""}
                            onClick={() => setActiveTab("leaderboard")}
                        >{" "}{__msg("Leaderboard")}{" "}</button>

                        <button
                            aria-current={activeTab === "teams" ? "page" : undefined} className={activeTab === "teams" ? "active" : ""}
                            onClick={() => setActiveTab("teams")}
                        >{" "}{__msg("Teams")}{" "}</button>

                        {monitoring && monitoring.is_organizer === true && (
                            <button
                                type="button"
                                onClick={() => navigate(`/competitions/${competitionId}/organizer`)}
                            >{" "}{__msg("Manage competition →")}{" "}</button>
                        )}
                    </nav>

                    {activeTab === "overview" && (
                        <div className="details-layout">
                            <div className="details-left">
                                <section className="overview-card">
                                    <h2>{__msg("About this challenge")}</h2>
                                    <p className="overview-text">{competition.description}</p>

                                    <div className="info-grid">
                                        {competition.primary_metric && <div className="info-box">
                                            <h3>{__msg("EVALUATION")}</h3>
                                            <strong>{__msg("Primary metric:")}{" "}{competition.primary_metric}</strong>
                                            {competition.secondary_metric && <p>{__msg("Secondary metric:")}{" "}{competition.secondary_metric}</p>}
                                        </div>}
                                        {competition.complexity_level != null && <div className="info-box">
                                            <h3>{__msg("DIFFICULTY")}</h3>
                                            <strong>{complexityText(competition.complexity_level)}</strong>
                                            {requiredSkills.length > 0 && <p>{__msg("Required skills:")}{" "}{requiredSkills.join(", ")}</p>}
                                        </div>}
                                        {((competition.assets || []).length > 0 || (competition.tasks || []).length > 0) && <div className="info-box" style={{ gridColumn: "1 / -1" }}>
                                            <h3>{__msg("SAMPLE & TASKS")}</h3>

                                            <>
                                                    {(competition.assets || []).length > 0 && <strong>{__msg("A sample contains")}</strong>}
                                                    <div className="chip-row">
                                                        {(competition.assets || []).map((a) => (
                                                            <span key={a.key} className="chip">{a.name} · {a.type}</span>
                                                        ))}
                                                    </div>

                                                    {(competition.tasks || []).length > 0 && <strong style={{ marginTop: 14 }}>{__msg("Tasks")}</strong>}
                                                    <ul className="task-list">
                                                        {(competition.tasks || []).map((t) => {
                                                            const target =
                                                                t.target?.type === "SAMPLE" ? __msg("the whole sample")
                                                                : t.target?.type === "TASK_OUTPUT"
                                                                    ? __msg("the output of “{value0}”", {value0: (competition.tasks.find((x) => x.key === t.target.ref) || {}).name || t.target.ref})
                                                                    : ((competition.assets || []).find((a) => a.key === t.target?.ref) || {}).name || __msg("an asset");
                                                            return (
                                                                <li key={t.key}>
                                                                    <b>{t.name}</b>
                                                                    <span>{String(t.type).replace(/_/g, " ").toLowerCase()}{" "}{__msg("· applies to")}{" "}{target}</span>
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                            </>
                                        </div>}
                                    </div>
                                </section>
                            </div>

                            <aside className="details-right">
                                {topLeaderboardEntry && <section className="side-card performers-card">
                                    <h3>{__msg("TOP PERFORMERS")}</h3>

                                    <div className="performer first">
                                        <strong>{String(topLeaderboardEntry.rank).padStart(2, "0")}</strong>

                                        <div>
                                            <b>{topLeaderboardEntry.team_name || topLeaderboardEntry.user_name || __msg("Participant {value0}", {value0: topLeaderboardEntry.user_id})}</b>
                                            <p>
                                                {competition.primary_metric || __msg("Metric")}:{" "}
                                                {fmtScore(topLeaderboardEntry.score)}
                                            </p>
                                        </div>

                                        <span>{__msg("BEST")}</span>
                                    </div>

                                    <button type="button" onClick={() => setActiveTab("leaderboard")}>{" "}{__msg("Full Leaderboard")}{" "}</button>
                                </section>}

                                {competition.phases_enabled && phases.length > 0 ? (
                                    <section className="side-card timeline-card">
                                        <h3>{__msg("PHASES")}</h3>

                                        {phases
                                            .slice()
                                            .sort((a, b) => (a.order || 0) - (b.order || 0))
                                            .map((phase, idx) => (
                                                <div
                                                    className={`timeline-item${idx === 0 ? " active" : ""}`}
                                                    key={phase.id || phase.name}
                                                >
                                                    <span></span>
                                                    <div>
                                                        <b>{phase.name}</b>
                                                        <p>
                                                            {phase.durationDays
                                                                ? __msg("Days: {count}", {count:phase.durationDays})
                                                                : __msg("Duration not set")}
                                                        </p>
                                                        {phase.description && <p>{phase.description}</p>}
                                                    </div>
                                                </div>
                                            ))}
                                    </section>
                                ) : (competition.validation_date || competition.freeze_date) ? (
                                    <section className="side-card timeline-card">
                                        <h3>{__msg("TIMELINE")}</h3>

                                        <div className="timeline-item active">
                                            <span></span>
                                            <div>
                                                <b>{__msg("Submissions Open")}</b>
                                                <p>{competition.start_date || __msg("Not set")}</p>
                                            </div>
                                        </div>

                                        {competition.validation_date && (
                                            <div className="timeline-item">
                                                <span></span>
                                                <div>
                                                    <b>{__msg("Model Validation Cutoff")}</b>
                                                    <p>{competition.validation_date}</p>
                                                </div>
                                            </div>
                                        )}

                                        {competition.freeze_date && (
                                            <div className="timeline-item">
                                                <span></span>
                                                <div>
                                                    <b>{__msg("Final Leaderboard Freeze")}</b>
                                                    <p>{competition.freeze_date}</p>
                                                </div>
                                            </div>
                                        )}

                                        <div className="timeline-item">
                                            <span></span>
                                            <div>
                                                <b>{__msg("Competition End")}</b>
                                                <p>{competition.end_date || __msg("Not set")}</p>
                                            </div>
                                        </div>
                                    </section>
                                ) : null}

                                {competition.max_teams != null && Number(competition.max_teams) > 0 && <section className="teams-card">
                                    <span>♙</span>
                                    <div>
                                        <strong>{competition.max_teams}</strong>
                                        <p>{__msg("Max Teams")}</p>
                                    </div>
                                </section>}

                                {competition.tracks_enabled && (
                                    <section className="side-card timeline-card">
                                        <h3>{__msg("TRACKS")}</h3>

                                        {tracksLoading && <p className="overview-text">{__msg("Loading tracks…")}</p>}

                                        {!tracksLoading && tracks.length === 0 && (
                                            <p className="overview-text">{__msg("No tracks configured.")}</p>
                                        )}

                                        {tracks.map((t) => (
                                            <div className="timeline-item" key={t.id}>
                                                <span></span>
                                                <div>
                                                    <b>
                                                        {t.name}
                                                        {t.active === false && __msg(" (removed — under minimum)")}
                                                    </b>
                                                    <p>
                                                        {t.team_count} / {t.min_teams}{" "}{__msg("team")}{t.min_teams === 1 ? "" : "s"}{" "}{__msg("minimum")}{" "}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </section>
                                )}
                            </aside>
                        </div>
                    )}

                    {activeTab === "rules" && (
                        <section className="overview-card">
                            <h2>{__msg("The ground rules")}</h2>
                            <p className="overview-text">
                                {competition.additional_rules || __msg("Competition participation and submission requirements are listed below.")}
                            </p>

                            <div className="info-grid">
                                {(competition.max_teams != null || competition.min_members != null || competition.max_members != null) && <div className="info-box">
                                    <h3>{__msg("TEAM RULES")}</h3>
                                    {competition.max_teams != null && <p>{__msg("Max teams:")}{" "}{competition.max_teams || __msg("Unlimited")}</p>}
                                    {competition.min_members != null && <p>{__msg("Min members:")}{" "}{competition.min_members}</p>}
                                    {competition.max_members != null && <p>{__msg("Max members:")}{" "}{competition.max_members}</p>}
                                </div>}

                                <div className="info-box">
                                    <h3>{__msg("SUBMISSION RULES")}</h3>
                                    {competition.max_submissions_per_day != null && <p>{__msg("Max submissions/day:")}{" "}{competition.max_submissions_per_day}</p>}
                                    <p>{__msg("External data:")}{" "}{competition.allow_external_data ? __msg("Allowed") : __msg("Not allowed")}</p>
                                    <p>{__msg("Pretrained models:")}{" "}{competition.allow_pretrained_models ? __msg("Allowed") : __msg("Not allowed")}</p>
                                    <p>{__msg("Code sharing:")}{" "}{competition.require_code_sharing ? __msg("Required") : __msg("Not required")}</p>
                                </div>

                                {competition.data_collection_enabled && (
                                    <div className="info-box">
                                        <h3>{__msg("DATA COLLECTION")}</h3>
                                        {(dataCollectionCfg.inputs || []).length > 0 ? (
                                            (dataCollectionCfg.inputs || []).map((inp) => (
                                                <p key={inp.name}>
                                                    {inp.name}: {inp.modality}{" "}{__msg("· max")}{" "}{inp.max_length}
                                                    {inp.modality === "audio" ? "s" : __msg(" words")}
                                                </p>
                                            ))
                                        ) : (
                                            null
                                        )}
                                        <p>{" "}{__msg("Allowed sources:")}{" "}
                                            {(dataCollectionCfg.allowed_source_types || []).join(", ")}
                                        </p>
                                        {dataCollectionCfg.annotators_per_instance != null && <p>{__msg("Annotators per instance:")}{" "}{dataCollectionCfg.annotators_per_instance}</p>}
                                        <p>{" "}{__msg("Disagreement adjudication:")}{" "}
                                            {dataCollectionCfg.adjudication_enabled ? __msg("Enabled") : __msg("Disabled")}
                                        </p>
                                    </div>
                                )}

                                {competition.data_collection_enabled && licenseCfg.version && (
                                    <div className="info-box">
                                        <h3>{__msg("DATA USAGE LICENSE")}</h3>
                                        <p>{__msg("Version:")}{" "}{licenseCfg.version}</p>
                                        <p className="overview-text">{licenseCfg.text}</p>
                                    </div>
                                )}

                                <div className="info-box">
                                    <h3>{__msg("EVALUATION SCORING")}</h3>
                                    <p>{" "}{__msg("Mode:")}{" "}
                                        {evaluationCfg.mode === "data_quality_plus_model"
                                            ? __msg("Data quality + model score")
                                            : __msg("Standard (primary metric only)")}
                                    </p>
                                    {evaluationCfg.mode === "data_quality_plus_model" && (
                                        <>
                                            <p>{__msg("Data quality weight:")}{" "}{evaluationCfg.data_quality_weight}%</p>
                                            <p>{__msg("Model weight:")}{" "}{evaluationCfg.model_weight}%</p>
                                            {evaluationCfg.public_test_fraction != null && (
                                                <p>{__msg("Held-out test fraction:")}{" "}{evaluationCfg.public_test_fraction}%</p>
                                            )}
                                        </>
                                    )}
                                    {evaluationCfg.winners_per_track != null && <p>{__msg("Winners per track:")}{" "}{evaluationCfg.winners_per_track}</p>}
                                </div>
                            </div>
                        </section>
                    )}

                    {activeTab === "datasets" && (
                        <section className="datasets-card">
                            <div className="datasets-head">
                                <h2>{__msg("Explore the datasets")}</h2>

                                {userIsOrganizer && <button
                                    type="button"
                                    onClick={() => navigate(`/competitions/${competitionId}/dataset-hub`)}
                                >{" "}{__msg("Manage dataset files")}{" "}</button>}
                            </div>

                            {datasetsLoading ? (
                                <div className="dataset-row">
                                    <div>
                                        <strong>{__msg("Loading datasets…")}</strong>
                                        <p>{__msg("Please wait while dataset files are fetched.")}</p>
                                    </div>
                                </div>
                            ) : datasets.length === 0 ? (
                                <div className="dataset-row">
                                    <div>
                                        <strong>{userIsOrganizer ? __msg("Dataset files") : __msg("Available datasets")}</strong>
                                        <p>{userIsOrganizer ? __msg("No reference datasets have been uploaded.") : __msg("Reference evaluation datasets are private. Collected datasets are published in the Dataset Hub after the competition closes.")}</p>
                                    </div>
                                </div>
                            ) : (
                                datasets.map((dataset) => (
                                    <div className="dataset-row" key={dataset.id}>
                                        <div>
                                            <strong>{dataset.original_filename || __msg("Dataset file")}</strong>
                                            <p>{" "}{__msg("Type:")}{" "}{dataset.dataset_type || __msg("Unknown")}{" "}{__msg("· Uploaded:")}{" "}
                                                {dataset.uploaded_at || __msg("Unknown date")}
                                            </p>
                                            {dataset.description && <p>{dataset.description}</p>}
                                        </div>

                                        <span>▣</span>
                                    </div>
                                ))
                            )}
                        </section>
                    )}

                    {activeTab === "leaderboard" && (
                        <section className="overview-card">
                            <h2>{__msg("On the leaderboard")}</h2>

                            {leaderboardLoading ? (
                                <p className="overview-text">{__msg("Loading leaderboard…")}</p>
                            ) : leaderboard.length === 0 ? (
                                <p className="overview-text">{__msg("No model submissions yet.")}</p>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {leaderboard.map((entry) => (
                                        <div
                                            key={entry.submission_id || entry.rank}
                                            className="dataset-row"
                                        >
                                            <div>
                                                <strong>#{entry.rank} {entry.team_name || entry.user_name || __msg("Participant {value0}", {value0: entry.user_id})}</strong>
                                                <p>{" "}{__msg("Score:")}{" "}{fmtScore(entry.score)}{" "}{__msg("· Metric:")}{" "}
                                                    {entry.metric_name || competition.primary_metric || __msg("Score")}
                                                </p>
                                            </div>

                                            <span>{fmtScore(entry.score)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {activeTab === "teams" && (
                        <section className="overview-card">
                            <h2>{__msg("Better together")}</h2>
                            <p className="overview-text">{__msg("Places:")}{" "}{competition.max_teams || __msg("Unlimited")}</p>
                            <p className="overview-text">{__msg("Teams:")}{" "}{monitoring?.teams_count ?? "—"}{" "}{__msg("· Solo participants:")}{" "}{monitoring?.solo_participants_count ?? "—"}{" "}{__msg("· Total participants:")}{" "}{monitoring?.participants_count ?? "—"}</p>

                            <div className="info-box" style={{ marginTop: 20 }}>
                                <h3>{__msg("WHO CAN JOIN")}</h3>
                                {!joinRules ? (
                                    <p>{__msg("Loading requirements…")}</p>
                                ) : (
                                    <ul className="task-list">
                                        <li>
                                            <b>{__msg("Participation")}</b>
                                            <span>
                                                {joinRules.requires_team
                                                    ? __msg("Teams only — {value0}", {value0: joinRules.team_size})
                                                    : joinRules.allows_team
                                                        ? __msg("Individuals, or teams{value0}", {value0: joinRules.team_size ? ` of ${joinRules.team_size.replace("exactly ", "")}` : ""})
                                                        : __msg("Individuals only")}
                                            </span>
                                        </li>
                                        {joinRules.skills.map((r) => (
                                            <li key={r.skill}><b>{r.skill}</b><span>{r.text}</span></li>
                                        ))}
                                        <li>
                                            <b>{__msg("Joining")}</b>
                                            <span>{joinRules.join_method === "manual" ? __msg("Reviewed by the organizer") : __msg("Automatic when requirements are met")}</span>
                                        </li>
                                    </ul>
                                )}
                            </div>
                        </section>
                    )}
                </main>
            </div>

            {showJoin && (joinDialog ||
                <JoinCompetitionModal
                    competitionId={competitionId}
                    competitionTitle={competition.title}
                    onClose={() => setShowJoin(false)}
                    onJoined={handleJoined}
                />
            )}
        </div>
    );
}

export default CompetitionDetails;