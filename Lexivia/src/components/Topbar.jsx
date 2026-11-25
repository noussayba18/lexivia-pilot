import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Search, X } from 'lucide-react'
import NotificationPopup from './NotificationPopup'
import { workspaceIdentity } from '../utils/workspaceIdentity'
import s from '../styles/workspace.module.css'

export default function Topbar({ title = '', subtitle = '', showBrowseButton = false }) {
  useInterfaceLanguage();
  const navigate = useNavigate()
  const location = useLocation()
  const currentQuery = new URLSearchParams(location.search).get('q') || ''
  const [search, setSearch] = useState(currentQuery)
  const input = useRef(null)
  const identity = workspaceIdentity()

  useEffect(() => { setSearch(currentQuery) }, [currentQuery])
  useEffect(() => {
    const shortcut = event => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && !event.target.isContentEditable) {
        event.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  const handleSearch = event => {
    event.preventDefault()
    if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`)
  }
  const clear = () => { setSearch(''); if (location.pathname === '/search') navigate('/search'); input.current?.focus() }

  return <>
    <header className={s.topbar}>
      <form className={s.searchForm} role="search" aria-label={__msg("Search Lexivia")} onSubmit={handleSearch}><button className={s.searchButton} type="submit" aria-label={__msg("Search")}><Search size={19} strokeWidth={1.7} /></button><input ref={input} type="search" aria-label={__msg("Search competitions, datasets, and teams")} value={search} placeholder={__msg("Search competitions, datasets, teams…")} onChange={event => { const value = event.target.value; setSearch(value); if (location.pathname === '/search') navigate(value.trim() ? `/search?q=${encodeURIComponent(value)}` : '/search') }} />{search ? <button type="button" className={s.clearSearch} aria-label={__msg("Clear search")} onClick={clear}><X size={15} /></button> : <kbd className={s.searchShortcut}>/</kbd>}</form>
      <div className={s.topbarActions}><div className={s.notification}><NotificationPopup /></div><Link className={s.topbarProfile} to="/profile" title={identity.name} aria-label={__msg("Open your profile")}>{identity.initials}</Link></div>
    </header>
    {(title || subtitle || showBrowseButton) && <section className={s.pageHeading}><div>{title && <h1>{__msg(title)}</h1>}{subtitle && <p>{subtitle}</p>}</div>{showBrowseButton && <Link className={s.browseButton} to="/competitions">{__msg("Browse competitions")}{" "}<ArrowUpRight size={16} /></Link>}</section>}
  </>
}
