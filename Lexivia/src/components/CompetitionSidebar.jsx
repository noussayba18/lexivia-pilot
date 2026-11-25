import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Menu, X, LockKeyhole, Sparkles, Settings, CircleHelp } from "lucide-react";
import BrandLogo from "./BrandLogo";
import { workspaceIdentity } from "../utils/workspaceIdentity";
import s from "../styles/competitionChrome.module.css";
import { usePhaseAccess, isPageLocked } from "./usePhaseAccess";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
function getToken() { return localStorage.getItem("token") || localStorage.getItem("access_token") || localStorage.getItem("jwt"); }
function CIcon({ children }) {
  return (
    <span className={s.icon} aria-hidden="true">
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

const NAV_ITEMS = [
  {
    key: "data-collection",
    label: "Data Collection",
    path: "data-collection",
    icon: (
      <CIcon>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
      </CIcon>
    ),
  },
  {
    key: "data-annotation",
    label: "Annotation",
    path: "data-annotation",
    icon: (
      <CIcon>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </CIcon>
    ),
  },
  {
    key: "team-dataset",
    label: "Dataset",
    path: "team-dataset",
    icon: (
      <CIcon>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 17.5h7" />
        <path d="M17.5 14v7" />
      </CIcon>
    ),
  },
  {
    key: "dataset-hub",
    label: "Validation",
    path: "dataset-hub",
    icon: (
      <CIcon>
        <path d="M20 6L9 17l-5-5" />
        <path d="M21 12a9 9 0 1 1-3.4-7" />
      </CIcon>
    ),
  },
  {
    key: "experiments",
    label: "Workspace",
    path: "experiments",
    icon: (
      <CIcon>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
        <path d="M9 10v10" />
      </CIcon>
    ),
  },
  {
    key: "experiment-registry",
    label: "Experiments",
    path: "experiment-registry",
    icon: (
      <CIcon>
        <path d="M9 3v6l-5 9a2 2 0 0 0 1.75 3h12.5A2 2 0 0 0 20 18l-5-9V3" />
        <path d="M8 3h8" />
        <path d="M7 15h10" />
      </CIcon>
    ),
  },
  {
    key: "leaderboard",
    label: "Leaderboard",
    path: "leaderboard",
    icon: (
      <CIcon>
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M22 20H2" />
      </CIcon>
    ),
  },
  {
    key: "documentation",
    label: "Documentation",
    path: "documentation",
    icon: (
      <CIcon>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h6" />
      </CIcon>
    ),
  },
];

function CompetitionSidebar({ competitionId: propCompetitionId, competitionTitle }) {
  const params = useParams();
  const competitionId = propCompetitionId || params.competitionId || params.id;
  const [loadedTitle, setLoadedTitle] = useState("");
  const { access } = usePhaseAccess(competitionId);
  useEffect(() => {
    setLoadedTitle("");
    if (!competitionId || competitionTitle) return;
    const controller = new AbortController();
    const token = getToken();
    fetch(`${API}/competitions/${competitionId}`, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!controller.signal.aborted) setLoadedTitle(data?.title || ""); })
      .catch(() => {});
    return () => controller.abort();
  }, [competitionId, competitionTitle]);
  return <CompetitionSidebarView competitionId={competitionId} competitionTitle={competitionTitle || loadedTitle || "Competition"} access={access} />;
}

export function CompetitionSidebarView({ competitionId, competitionTitle, access }) {
  useInterfaceLanguage();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("lexivia.sidebar.collapsed") === "true");
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [open, setOpen] = useState(false);
  const sidebar = useRef(null), toggleButton = useRef(null);
  const identity = workspaceIdentity();
  const basePath = `/competitions/${competitionId}`;
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const change = event => { setMobile(event.matches); setOpen(false); };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    toggleButton.current?.focus();
    const onKey = event => {
      if (event.key === "Escape") { setOpen(false); toggleButton.current?.focus(); }
      if (event.key === "Tab") {
        const controls = [...sidebar.current.querySelectorAll('a[href],button')].filter(el => el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; };
  }, [open]);
  const toggle = () => {
    if (mobile) setOpen(value => !value);
    else setCollapsed(value => { localStorage.setItem("lexivia.sidebar.collapsed", String(!value)); return !value; });
  };
  const currentPhase = access?.enabled ? access.current : null;
  const go = to => { setOpen(false); navigate(to); };
  return <div className={`${s.slot} ${collapsed ? s.collapsed : ""} ${open ? s.open : ""}`}>
    {open && <button className={s.scrim} aria-label={__msg("Close workspace navigation")} onClick={() => setOpen(false)} />}
    <aside ref={sidebar} className={s.sidebar} aria-label={__msg("Competition workspace")} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined}>
      <div className={s.brandRow}><Link to="/dashboard" className={s.wordmark} aria-label={__msg("Lexivia home")}><BrandLogo compact={mobile ? !open : collapsed} /></Link><button ref={toggleButton} className={s.toggle} onClick={toggle} aria-label={mobile ? (open ? __msg("Close workspace navigation") : __msg("Open workspace navigation")) : (collapsed ? __msg("Expand workspace sidebar") : __msg("Collapse workspace sidebar"))} aria-expanded={mobile ? open : !collapsed}>{mobile ? (open ? <X size={18}/> : <Menu size={18}/>) : (collapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>)}</button></div>
      <Link to="/competitions" className={s.back} title={__msg("All competitions")} aria-label={__msg("All competitions")} onClick={() => setOpen(false)}><ArrowLeft size={16}/><span>{__msg("All competitions")}</span></Link>
      <div className={s.identity}><span>{__msg("YOUR CHALLENGE")}</span><strong title={competitionTitle}>{competitionTitle}</strong></div>
      <Link to={basePath} className={s.overview} title={__msg("Competition overview")} aria-label={__msg("Competition overview")} onClick={() => setOpen(false)}><ArrowUpRight size={18}/><span>{__msg("Challenge overview")}</span></Link>
      {access?.enabled && (currentPhase || access.state === "not_started") && <div className={s.phase}><span>{__msg("Current phase")}</span><strong>{currentPhase?.name || __msg("Not started yet")}</strong></div>}
      <nav className={s.nav} aria-label={__msg("Competition pages")}>{NAV_ITEMS.map((item,index) => {
        const locked = isPageLocked(access,item.key), active = pathname === `${basePath}/${item.path}` || pathname.startsWith(`${basePath}/${item.path}/`);
        return <div key={item.key}>{(index === 0 || index === 4) && <div className={s.sectionLabel}>{index === 0 ? __msg("DATA LAB") : __msg("MODEL LAB")}</div>}<Link to={`${basePath}/${item.path}`} className={`${s.navItem} ${active ? s.active : ""} ${locked ? s.locked : ""}`} aria-current={active ? "page" : undefined} aria-label={`${__msg(item.label)}${locked ? " — " + __msg("Locked in the current phase") : ""}`} title={`${__msg(item.label)}${locked ? " · " + __msg("Locked in the current phase") : ""}`} onClick={() => setOpen(false)}>{item.icon}<span className={s.itemLabel}>{__msg(item.label)}</span>{locked && <LockKeyhole size={12} className={s.lock} aria-hidden="true"/>}</Link></div>;
      })}</nav>
      <div className={s.bottom}><div className={s.note}><Sparkles size={17}/><p>{__msg("One idea can make")}<br/>{__msg("a world of difference.")}</p></div><button className={s.utility} title={__msg("Settings")} aria-label={__msg("Settings")} onClick={() => go('/profile/settings')}><Settings size={18}/><span>{__msg("Settings")}</span></button><button className={s.utility} title={__msg("Competition support")} aria-label={__msg("Competition support")} onClick={() => go(`${basePath}/support`)}><CircleHelp size={18}/><span>{__msg("Support")}</span></button><Link to="/profile" className={s.user} aria-label={__msg("Your profile")} title={__msg("Your profile")} onClick={() => setOpen(false)}><span className={s.avatar}>{identity.initials}</span><span className={s.userCopy}><strong>{identity.name}</strong><small>{__msg("Your personal workspace")}</small></span><ChevronRight size={14}/></Link></div>
    </aside>
  </div>;
}
export default CompetitionSidebar;
