import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { BookOpen, ChevronLeft, ChevronRight, Database, House, Menu, Plus, Settings, Trophy, Users, X } from 'lucide-react'
import { workspaceIdentity } from '../utils/workspaceIdentity'
import s from '../styles/workspace.module.css'
import BrandLogo from './BrandLogo'

const links = [['/dashboard', 'Home', House], ['/competitions', 'Competitions', Trophy], ['/datasets', 'Datasets', Database], ['/teams', 'Teams', Users]]

export default function Sidebar() {
  useInterfaceLanguage();
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lexivia.sidebar.collapsed') === 'true')
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [mobileOpen, setMobileOpen] = useState(false)
  const sidebar = useRef(null)
  const toggleButton = useRef(null)
  const identity = workspaceIdentity()

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const change = event => { setMobile(event.matches); setMobileOpen(false) }
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const close = event => {
      if (event.key === 'Escape') { setMobileOpen(false); toggleButton.current?.focus() }
      if (event.key === 'Tab') {
        const controls = [...sidebar.current.querySelectorAll('a[href], button')].filter(element => element.offsetParent !== null)
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [mobileOpen])

  const toggle = () => {
    if (mobile) setMobileOpen(value => !value)
    else setCollapsed(value => { localStorage.setItem('lexivia.sidebar.collapsed', String(!value)); return !value })
  }
  const isCompetition = pathname === '/create-competition' || pathname.startsWith('/edit-competition/') || pathname.startsWith('/competitions')
  const navLink = (to, label, Icon, active) => <NavLink key={to} to={to} title={__msg(label)} aria-label={__msg(label)} onClick={() => setMobileOpen(false)} className={({ isActive }) => `${s.navLink} ${(active ?? isActive) ? s.navActive : ''}`}><Icon size={19} strokeWidth={1.7} /><span>{__msg(label)}</span></NavLink>

  return <div className={`${s.sidebarSlot} ${collapsed ? s.collapsed : ''} ${mobileOpen ? s.mobileOpen : ''}`}>
    {mobileOpen && <button type="button" className={s.scrim} onClick={() => setMobileOpen(false)} aria-label={__msg("Close navigation")} />}
    <aside ref={sidebar} className={s.sidebar} aria-label={__msg("Workspace navigation")} role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen ? true : undefined}>
      <div className={s.sidebarHeader}><Link to="/dashboard" className={s.wordmark} aria-label={__msg("Lexivia home")}><BrandLogo compact={mobile ? !mobileOpen : collapsed} /></Link><button type="button" ref={toggleButton} className={s.collapseButton} onClick={toggle} aria-label={mobile ? (mobileOpen ? __msg("Close navigation") : __msg("Open navigation")) : (collapsed ? __msg("Expand sidebar") : __msg("Collapse sidebar"))} aria-expanded={mobile ? mobileOpen : !collapsed}>{mobile ? (mobileOpen ? <X size={17} /> : <Menu size={18} />) : (collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />)}</button></div>
      <Link className={s.createButton} to="/create-competition" title={__msg("Create competition")} aria-label={__msg("Create competition")} onClick={() => setMobileOpen(false)}><Plus size={19} /><span>{__msg("Create competition")}</span></Link>
      <span className={s.navLabel}>{__msg("WORKSPACE")}</span>
      <nav className={s.nav} aria-label={__msg("Main workspace navigation")}>{links.map(([to, label, Icon]) => navLink(to, label, Icon, to === '/competitions' ? isCompetition : undefined))}</nav>
      <div className={s.sidebarBottom}>
        <nav className={s.nav} aria-label={__msg("Help and account navigation")}>{navLink('/resources', 'Resources', BookOpen)}{navLink('/profile/settings', 'Settings', Settings)}</nav>
        <Link className={s.sidebarUser} to="/profile" title={__msg("Your profile")} aria-label={__msg("Your profile")} onClick={() => setMobileOpen(false)}><span className={s.userAvatar}>{identity.initials}</span><span><strong>{identity.name}</strong><small>{__msg("Your personal workspace")}</small></span><ChevronRight size={14} /></Link>
      </div>
    </aside>
  </div>
}
