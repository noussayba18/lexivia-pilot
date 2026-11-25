import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trophy, FileEdit, Database, CheckCircle2, ArrowUpRight, Plus, RefreshCw, Clock, ArrowRight, Users, Sparkles, X, AlertCircle } from "lucide-react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import { supabase } from "../config/supabase";
import "../styles/Dashboard.css";
const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const number = value => new Intl.NumberFormat(document.documentElement.lang).format(value);
const dateLabel = value => {
  if (!value) return null;
  const d = new Date(String(value).slice(0, 10) + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(document.documentElement.lang, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};
const metrics = [["active", "Active competitions", "Your ongoing competitions", Trophy], ["drafts", "Competition drafts", "Ready to continue editing", FileEdit], ["samples", "Samples created", "Your collected samples", Database], ["annotations", "Completed assignments", "Fully completed annotation work", CheckCircle2]];
export default function Dashboard() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);

  const request = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const id = ++request.current;
    async function load() {
      setBusy(true);
      setError("");
      try {
        const {
          data: auth,
          error: authError
        } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        if (authError || !auth?.session) {
          navigate("/login", {
            replace: true
          });
          return;
        }
        const session = auth.session;
        localStorage.setItem("token", session.access_token);
        localStorage.setItem("user", JSON.stringify(session.user));
        setName(session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "there");
        const headers = {
          Authorization: `Bearer ${session.access_token}`
        };
        const res = await fetch(`${API}/dashboard/overview`, {
          headers,
          signal: controller.signal
        });
        if (res.status === 401) {
          navigate("/login", {
            replace: true
          });
          return;
        }
        if (!res.ok) throw new Error("Unable to load your dashboard. Please try again.");
        const result = await res.json();
        if (!result?.stats || !Array.isArray(result.competitions) || !Array.isArray(result.actions) || !Array.isArray(result.deadlines)) throw new Error("The dashboard response is incomplete. Please try again.");
        if (!controller.signal.aborted && id === request.current) setData(result);
        // Profile lookup cannot delay or hide the dashboard.
        fetch(`${API}/profile/me`, {
          headers,
          signal: controller.signal
        }).then(r => r.ok ? r.json() : null).then(p => {
          if (!controller.signal.aborted && id === request.current && p) setName(p.full_name || p.name || p.username || session.user.user_metadata?.full_name || "there");
        }).catch(() => {});
      } catch (e) {
        if (!controller.signal.aborted && id === request.current) setError(e.message || "Unable to load your dashboard.");
      } finally {
        if (!controller.signal.aborted && id === request.current) setBusy(false);
      }
    }
    load();
    return () => controller.abort();
  }, [navigate, refresh]);
  return <DashboardView name={name} data={data} error={error} busy={busy} onRefresh={() => setRefresh(value => value + 1)} />;
}

const startingPoints = [
  { to: "/competitions", title: "Find your next challenge.", text: "Explore NLP competitions and put your ideas to the test.", action: "Explore competitions", Icon: Trophy, tone: "teal", label: "DISCOVER & COMPETE" },
  { to: "/datasets", title: "Start with a little data.", text: "Explore datasets. Find the foundation for your next discovery.", action: "Browse datasets", Icon: Database, tone: "gold", label: "EXPLORE & UNDERSTAND" },
  { to: "/teams", title: "Great minds, together.", text: "Find your people and bring a different perspective to the table.", action: "Connect with your teams", Icon: Users, tone: "coral", label: "CONNECT & COLLABORATE" },
];

export function DashboardView({ name, data, error, busy, onRefresh }) {
  useInterfaceLanguage();
  const [filter, setFilter] = useState("Current");
  const [showStats, setShowStats] = useState(true);
  const [showStartingPoints, setShowStartingPoints] = useState(true);
  const rows = (data?.competitions || []).filter(r => filter === "All" || filter === "Current" && ["OPEN", "UPCOMING"].includes(r.status) || filter === "Drafts" && r.status === "DRAFT" || filter === "Ended" && r.status === "CLOSED");
  const count = value => value == null ? "—" : number(value);

  return <div className="dashboard-shell">
    <Sidebar />
    <div className="dashboard-main">
      <Topbar />
      <main className="db-body">
        <div className="db-context"><span className="db-eyebrow"><span />{" "}{__msg("YOUR PERSONAL WORKSPACE")}</span><button className="db-refresh" type="button" disabled={busy} onClick={onRefresh} aria-label={__msg("Refresh dashboard")}><RefreshCw size={13} className={busy ? "db-spin" : ""} /><span>{busy ? __msg("Updating…") : __msg("Refresh")}</span></button></div>
        <header className="db-heading">
          <div className="db-welcome"><h1>{name ? <>{__msg("Welcome back,")}<br /><span>{name}.</span></> : <>{__msg("A little curiosity.")}<br /><span>{__msg("A new possibility.")}</span></>}</h1><p>{__msg("Your next discovery is waiting. Pick up where you left off,")}<br className="db-desktop-break" />{" "}{__msg("or make room for something new.")}</p></div>
          <div className="db-radar"><span className="db-radar-label"><Sparkles size={14} />{" "}{__msg("ON YOUR RADAR")}</span><div><a href="#db-attention"><strong>{count(data?.actions.length)}</strong><span>{__msg("Things to follow up")}</span></a><a href="#db-deadlines"><strong>{count(data?.deadlines.length)}</strong><span>{__msg("Deadlines within 14 days")}</span></a></div><span className="db-radar-note">{__msg("A little focus goes a long way.")}</span></div>
        </header>
        {error && <div className="db-error" role="alert"><AlertCircle size={17} /><span>{__msg(error)} {data && __msg("Showing the last loaded information.")}</span><button type="button" className="db-button" disabled={busy} onClick={onRefresh}>{__msg("Try again")}</button></div>}
        <section className="db-overview" aria-label={__msg("Your workspace activity")} aria-busy={busy}>
          <div className="db-section-line"><h2>{__msg("Your activity, at a glance.")}</h2><button type="button" className="db-quiet-button" onClick={() => setShowStats(value => !value)} aria-expanded={showStats} aria-controls="db-activity-stats">{showStats ? __msg("Hide stats") : __msg("Show stats")}</button></div>
          {showStats && <div className="db-metrics" id="db-activity-stats">{metrics.map(([key, label, note, Icon]) => <div className="db-metric" key={key}><span className={`db-metric-icon db-tone-${key}`}><Icon size={18} strokeWidth={1.7} /></span><div><h3>{__msg(label)}</h3><strong className={busy && !data ? "db-count-loading" : ""}>{count(data?.stats[key])}</strong><p>{__msg(note)}</p></div></div>)}</div>}
        </section>
        <section className="db-start" aria-labelledby="db-start-title"><div className="db-section-line"><div><span className="db-eyebrow">{__msg("FOLLOW YOUR CURIOSITY")}</span><h2 id="db-start-title">{__msg("Where will today take you?")}</h2><p>{__msg("Choose a starting point. See what’s possible.")}</p></div><button className="db-dismiss" type="button" onClick={() => setShowStartingPoints(value => !value)} aria-label={showStartingPoints ? __msg("Hide starting points") : __msg("Show starting points")} aria-expanded={showStartingPoints} aria-controls="db-starting-points">{showStartingPoints ? <X size={17} /> : <Plus size={17} />}</button></div>
          {showStartingPoints && <div className="db-focus-grid" id="db-starting-points">{startingPoints.map(({ to, title, text, action, Icon, tone, label }, i) => <Link to={to} className={`db-focus-card db-focus-${tone}`} key={to}><div className="db-focus-art" aria-hidden="true"><span className="db-focus-symbol"><Icon size={29} strokeWidth={1.5} /></span><span className="db-art-ring" /><span className="db-art-dot" /><span className="db-focus-number">0{i + 1}</span></div><div className="db-focus-copy"><span className="db-card-label">{__msg(label)}</span><h3>{__msg(title)}</h3><p>{__msg(text)}</p><span className="db-card-action">{__msg(action)}<ArrowUpRight size={15} /></span></div></Link>)}</div>}
        </section>
        <div className="db-grid">
          <section className="db-panel db-work" id="db-your-work" aria-busy={busy}><div className="db-panel-head"><div><span className="db-eyebrow">{__msg("PICK UP WHERE YOU LEFT OFF")}</span><h2>{__msg("Your competitions")}</h2><p>{__msg("A shared question. Your own way forward.")}</p></div><Link to="/create-competition" className="db-button db-primary"><Plus size={14} /><span>{__msg("Create")}</span></Link></div>
            <div className="db-tabs" aria-label={__msg("Filter competitions")}>{["Current", "Drafts", "Ended", "All"].map(f => <button type="button" key={f} aria-pressed={filter === f} className={filter === f ? "is-selected" : ""} onClick={() => setFilter(f)}>{__msg(f)}{data && <span>{(data.competitions || []).filter(r => f === "All" || f === "Current" && ["OPEN", "UPCOMING"].includes(r.status) || f === "Drafts" && r.status === "DRAFT" || f === "Ended" && r.status === "CLOSED").length}</span>}</button>)}</div>
            {!data ? <div className="db-empty" role="status">{busy ? <><RefreshCw size={25} className="db-spin" /><h3>{__msg("Gathering your workspace…")}</h3><p>{__msg("Your competitions and latest activity will appear here.")}</p></> : <><AlertCircle size={27} /><h3>{__msg("Your work is unavailable right now.")}</h3><p>{__msg("Refresh the dashboard to try loading it again.")}</p></>}</div> : rows.length ? <div className="db-competition-list">{rows.map(r => <Link className="db-competition" to={r.href} key={r.id}><span className="db-competition-icon"><Trophy size={21} strokeWidth={1.6} /></span><div className="db-competition-copy"><div className="db-row-title"><h3>{r.title}</h3><span className={`db-status db-status-${r.status.toLowerCase()}`}>{r.status === "OPEN" ? __msg("Active") : r.status === "CLOSED" ? __msg("Ended") : r.status === "DRAFT" ? __msg("Draft") : __msg("Upcoming")}</span></div><p>{__msg(r.role)}{r.tasks.length > 0 && ` · ${r.tasks.slice(0, 2).map(task=>__msg(task)).join(" · ")}`}{r.tasks.length > 2 ? ` +${r.tasks.length - 2}` : ""}</p>{dateLabel(r.end_date) && <small><Clock size={10} /> {dateLabel(r.end_date)}</small>}</div><ArrowUpRight size={16} /></Link>)}</div> : <div className="db-empty"><Trophy size={28} strokeWidth={1.4} /><h3>{filter === "Drafts" ? __msg("Your next idea starts with a draft.") : filter === "Ended" ? __msg("No finished chapters just yet.") : __msg("Room for your next challenge.")}</h3><p>{filter === "Drafts" ? __msg("Create a competition and shape it at your own pace.") : filter === "Ended" ? __msg("Your completed competitions will appear here.") : __msg("Explore competitions to join, or create one of your own.")}</p><Link className="db-text-link" to={filter === "Drafts" ? "/create-competition" : "/competitions"}>{filter === "Drafts" ? __msg("Create a competition") : __msg("Explore competitions")} <ArrowRight size={14} /></Link></div>}
            <Link className="db-panel-footer" to="/competitions">{__msg("Explore all competitions")}{" "}<ArrowRight size={14} /></Link>
          </section>
          <aside className="db-side">
            <section className="db-panel" id="db-attention"><div className="db-panel-head"><div><span className="db-eyebrow">{__msg("THE LITTLE THINGS THAT MATTER")}</span><h2>{__msg("Needs your attention")}</h2></div><span className="db-count">{count(data?.actions.length)}</span></div>{data?.actions.length ? data.actions.map(a => <Link className="db-action" key={a.id} to={a.href}><span className="db-action-dot" /><div><h3>{__msg(a.title)}</h3><p>{a.detail}</p></div><ArrowUpRight size={15} /></Link>) : <div className="db-small-empty"><CheckCircle2 size={19} /><div><strong>{data ? __msg("You’re all caught up.") : busy ? __msg("Checking your next steps…") : __msg("We couldn’t check your next steps.")}</strong><p>{data ? __msg("A little space for something new.") : __msg("Your follow-ups will appear here once loaded.")}</p></div></div>}</section>
            <section className="db-panel" id="db-deadlines"><div className="db-panel-head"><div><span className="db-eyebrow">{__msg("A LOOK AHEAD")}</span><h2>{__msg("Coming up")}</h2></div><Clock size={18} /></div>{data?.deadlines.length ? data.deadlines.map(d => <Link className="db-action" key={d.id} to={d.href}><div><h3>{d.title}</h3><p>{dateLabel(d.end_date)}</p></div><span className={`db-days ${d.days_left <= 3 ? "is-urgent" : ""}`}>{d.days_left === 0 ? __msg("Today") : __msg("{count}d left", {count:d.days_left})}</span></Link>) : <div className="db-small-empty"><Clock size={19} /><div><strong>{data ? __msg("No deadlines on the horizon.") : busy ? __msg("Checking your calendar…") : __msg("Your calendar is unavailable.")}</strong><p>{data ? __msg("Nothing due in the next 14 days.") : __msg("Upcoming dates will appear once loaded.")}</p></div></div>}</section>
            
          </aside>
        </div>
        <footer className="db-footer"><span>{__msg("Made for curious minds. Better together.")}</span>{data?.generated_at && <span>{__msg("Updated")}{" "}{new Date(data.generated_at).toLocaleTimeString(document.documentElement.lang, { hour: "2-digit", minute: "2-digit" })}</span>}</footer>
      </main>
    </div>
  </div>;
}
