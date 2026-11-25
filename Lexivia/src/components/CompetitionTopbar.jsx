import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronRight, Database, Search, X } from "lucide-react";
import NotificationPopup from "./NotificationPopup";
import { workspaceIdentity } from "../utils/workspaceIdentity";
import s from "../styles/competitionChrome.module.css";

export default function CompetitionTopbar({ competitionId, competitionTitle = "Competition", status = "LAB ACTIVE", showDatasetHub = true }) {
  useInterfaceLanguage();
  const navigate = useNavigate(), location = useLocation();
  const [search,setSearch] = useState("");
  const input = useRef(null), identity = workspaceIdentity();
  const basePath = `/competitions/${competitionId}`;
  useEffect(() => { setSearch(new URLSearchParams(location.search).get("q") || ""); }, [location.search]);
  useEffect(() => {
    const shortcut = event => { if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.isContentEditable && !['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) { event.preventDefault(); input.current?.focus(); } };
    window.addEventListener("keydown",shortcut);
    return () => window.removeEventListener("keydown",shortcut);
  }, []);
  const submit = event => { event.preventDefault(); if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`); };
  return <header className={`competition-topbar ${s.topbar}`}>
    <div className={s.topRow}><form className={s.search} role="search" aria-label={__msg("Search Lexivia")} onSubmit={submit}><button type="submit" aria-label={__msg("Search")}><Search size={18}/></button><input ref={input} type="search" aria-label={__msg("Search competitions, datasets, and teams")} placeholder={__msg("Search competitions, datasets, teams…")} value={search} onChange={event => setSearch(event.target.value)}/>{search ? <button type="button" aria-label={__msg("Clear search")} onClick={() => {setSearch(""); input.current?.focus();}}><X size={15}/></button> : <span className={s.shortcut} aria-hidden="true">/</span>}</form><div className={s.actions}>{showDatasetHub && <Link to={`${basePath}/dataset-hub`} className={s.hub} aria-label={__msg("Dataset Hub")} title={__msg("Dataset Hub")}><Database size={16}/><span>{__msg("Dataset Hub")}</span></Link>}<div className={s.notification}><NotificationPopup/></div><Link to="/profile" className={s.avatar} aria-label={__msg("Your profile")} title={identity.name}>{identity.initials}</Link></div></div>
    <div className={s.contextRow}><div className={s.context}><Link to={basePath} className={s.challengeTitle} title={competitionTitle}>{competitionTitle}</Link><ChevronRight size={13}/><span className={s.workspaceLabel}>{__msg("Workspace")}</span></div><div className={s.contextActions}>{status && <span className={s.status}><span/>{__msg(status)}</span>}<nav aria-label={__msg("Competition shortcuts")}><Link to={basePath} aria-current={location.pathname === basePath ? "page" : undefined}>{__msg("Overview")}</Link><Link to="/resources">{__msg("Resources")}{" "}<ArrowUpRight size={11}/></Link></nav></div></div>
  </header>;
}
