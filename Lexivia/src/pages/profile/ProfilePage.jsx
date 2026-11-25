import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
/**
 * ProfilePage.jsx  —  View a user profile
 *
 * • Own profile  → /profile          (reads logged-in user from Supabase)
 * • Other user   → /profile/:userId  (public, no auth needed)
 */

import React, { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'

import Sidebar from '../../components/Sidebar'
import Topbar from '../../components/Topbar'
import { ArrowUpRight, BriefcaseBusiness, Flag, LoaderCircle, Sparkles, Trophy, UserRound } from 'lucide-react'
import '../../styles/ProfilePage.css'
import '../../styles/profileOverviewRefresh.css'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

// Initialise Supabase client  (replace with your actual project values)
import { supabase } from '../../config/supabase'
// ─── Icons ────────────────────────────────────────────────────────────────────
const LinkedInIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5zM0 8h5v16H0V8zm7.5 0h4.8v2.2h.07c.67-1.2 2.3-2.4 4.73-2.4C22.2 7.8 24 10 24 14v10h-5v-9c0-2.2-.04-5-3.05-5-3.05 0-3.52 2.38-3.52 4.84V24h-5V8z"/>
  </svg>
)
const GitHubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.42 7.86 10.95.58.1.79-.25.79-.55v-2.02c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.7.08-.69.08-.69 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.33.96.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.3 1.18-3.11-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.18a10.9 10.9 0 012.86-.38c.97 0 1.95.13 2.86.38 2.18-1.49 3.14-1.18 3.14-1.18.62 1.57.23 2.73.11 3.02.73.81 1.18 1.85 1.18 3.11 0 4.43-2.68 5.4-5.24 5.69.41.35.77 1.04.77 2.1v3.11c0 .3.21.65.8.55C20.71 21.42 24 17.1 24 12 24 5.65 18.85.5 12 .5z"/>
  </svg>
)
const WebIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15 15 0 010 20"/>
    <path d="M12 2a15 15 0 000 20"/>
  </svg>
)
const BuildingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="2" width="18" height="20" rx="2"/>
    <path d="M9 22V12h6v10"/>
  </svg>
)
const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
  </svg>
)

// ─── Page Component ────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { userId: paramUserId } = useParams()
  const navigate = useNavigate()

  // Auth state
  const [authUser, setAuthUser]   = useState(null)   // Supabase auth user
  const [authReady, setAuthReady] = useState(false)  // true once auth is resolved

  // Profile data
  const [profileData, setProfileData]         = useState(null)
  const [organizedComps, setOrganizedComps]   = useState(null)
  const [participatedComps, setParticipatedComps] = useState(null)
  const [competitionErrors, setCompetitionErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // ── 1. Resolve the logged-in user once ──────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null)
      setAuthReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── 2. Load profile once auth is resolved ───────────────────────────────────
  useEffect(() => {
    if (!authReady) return   // wait until we know who's logged in

    // Which user are we viewing?
    // - No URL param  → own profile  (requires login)
    // - URL param     → another user's public profile
    const viewingUserId = paramUserId ?? authUser?.id

    if (!viewingUserId) {
      // Not logged in and no userId in URL → redirect to login
      navigate('/login')
      return
    }

    async function loadProfile() {
      setLoading(true)
      setError(null)
      setOrganizedComps(null)
      setParticipatedComps(null)
      setCompetitionErrors({})
      try {
        // For own profile we use /profile/me (sends auth token)
        // For other profiles we use /profile/:id (public, no token needed)
        const isOwnProfile = !paramUserId && authUser?.id === viewingUserId

        const headers = {}
        if (isOwnProfile) {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`
          }
        }

        const profileEndpoint = isOwnProfile
          ? `${API}/profile/me`
          : `${API}/profile/${viewingUserId}`

        const res = await fetch(profileEndpoint, { headers })
        if (!res.ok) throw new Error(`Failed to load profile (${res.status})`)
        const data = await res.json()
        setProfileData(data)

        // Load each history independently so a history error never hides the profile.
        const loadHistory = (kind, setter) => fetch(`${API}/competitions/${kind}/${viewingUserId}`)
          .then(res => { if (!res.ok) throw new Error('History unavailable'); return res.json() })
          .then(data => setter(Array.isArray(data) ? data : []))
          .catch(() => { setter([]); setCompetitionErrors(previous => ({...previous, [kind]: true})) })
        loadHistory('organizer', setOrganizedComps)
        loadHistory('participant', setParticipatedComps)
      } catch (err) {
        setError('Failed to load profile.')
        console.error('[ProfilePage] load error:', err)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [authReady, authUser, paramUserId, navigate])

  return <ProfilePageView profileData={profileData} organizedComps={organizedComps} participatedComps={participatedComps} competitionErrors={competitionErrors} isOwnProfile={!paramUserId} loading={!authReady || loading} error={error}/>;
}

function ProfileFrame({children}) {
  return <div className="p-shell p-refresh"><Sidebar/><div className="p-content"><Topbar/><main className="p-body">{children}</main></div></div>
}

function CompetitionHistory({title, Icon, items, error, own, organized = false}) {
  useInterfaceLanguage();
  return <section className="p-card"><div className="p-section-heading"><span className="p-section-icon"><Icon size={19}/></span><div><h2 className="p-card-title">{__msg(title)}</h2><p>{organized ? __msg("Challenges brought to life.") : __msg("Questions explored with the community.")}</p></div>{Array.isArray(items) && !error && <span className="p-section-count">{items.length}</span>}</div>
    {error ? <p className="p-empty" role="status">{__msg("Competition history is unavailable right now.")}</p> : items === null ? <p className="p-empty" role="status">{__msg("Loading competition history…")}</p> : items.length ? <ul className="p-competition-list">{items.map(comp=><li key={comp.id}><Link to={`/competitions/${comp.id}`}><span><strong>{comp.title}</strong>{comp.date && <small>{comp.date}</small>}</span><ArrowUpRight size={16}/></Link></li>)}</ul> : <div className="p-empty-block"><p>{organized ? __msg("No competitions organized yet.") : __msg("No competitions joined yet.")}</p>{own && <Link to={organized ? '/create-competition' : '/competitions'}>{organized ? __msg("Create your first challenge") : __msg("Find your next challenge")} <ArrowUpRight size={13}/></Link>}</div>}
  </section>
}

export function ProfilePageView({profileData, organizedComps=null, participatedComps=null, competitionErrors={}, isOwnProfile=false, loading=false, error=null}) {
  useInterfaceLanguage();
  if (loading) return <ProfileFrame><div className="p-state" role="status"><LoaderCircle size={26} className="p-loading-icon"/><h1>{__msg("Gathering your story…")}</h1><p>{__msg("Your profile will be here in a moment.")}</p></div></ProfileFrame>
  if (error || !profileData) return <ProfileFrame><div className="p-state" role="alert"><UserRound size={28}/><h1>{__msg("Profile unavailable.")}</h1><p>{error || __msg("This profile could not be found.")}</p><Link className="p-profile-button" to="/dashboard">{__msg("Back to workspace")}{" "}<ArrowUpRight size={15}/></Link></div></ProfileFrame>
  const {full_name, name, username, profile_picture, institution, bio, skills, experiences, linkedin_url, github_url, website_url} = profileData
  const displayName = full_name || name || username || __msg('Lexivia member')
  const links = [
    {url:linkedin_url,label:'LinkedIn',icon:<LinkedInIcon/>},
    {url:github_url,label:'GitHub',icon:<GitHubIcon/>},
    {url:website_url,label:'Website',icon:<WebIcon/>},
  ].filter(link=>link.url)
  return <ProfileFrame>
    <header className="p-page-header"><div><p className="p-eyebrow">{isOwnProfile ? __msg("YOUR PROFILE · YOUR PERSPECTIVE") : __msg("COMMUNITY · MEMBER PROFILE")}</p><h1 className="p-page-title">{isOwnProfile ? __msg("Your story, still unfolding") : __msg('Meet {name}', {name:displayName})}<span>.</span></h1><p className="p-page-subtitle">{__msg("The skills, experiences, and shared discoveries that make a profile yours.")}</p></div>{isOwnProfile && <Link className="p-profile-button" to="/profile/update"><EditIcon/>{" "}{__msg("Edit profile")}</Link>}</header>
    <div className="p-overview">
      <aside className="p-sidebar-card">
        <div className="p-profile-cover" aria-hidden="true"><span/><i/></div>
        {profile_picture ? <img src={profile_picture} alt={displayName} className="p-avatar p-avatar--xl"/> : <div className="p-avatar p-avatar--xl p-avatar--ph" aria-label={__msg('{name} profile picture', {name:displayName})}>{displayName.charAt(0).toUpperCase()}</div>}
        <span className="p-member-label">{__msg("LEXIVIA COMMUNITY")}</span><h2 className="p-sidebar-name">{displayName}</h2>
        {institution && <div className="p-sidebar-meta"><span className="p-meta-item"><BuildingIcon/>{institution}</span></div>}
        <div className="p-sidebar-section"><h3 className="p-card-title">{isOwnProfile ? __msg('A little about you') : __msg('A little about {name}', {name:displayName})}</h3><p className="p-bio">{bio || (isOwnProfile ? __msg("Share what you’re curious about, what you’re building, or what brings you here.") : __msg("No biography shared yet."))}</p>{!bio && isOwnProfile && <Link className="p-inline-link" to="/profile/update">{__msg("Add a biography")}{" "}<ArrowUpRight size={13}/></Link>}</div>
        {links.length > 0 && <div className="p-sidebar-links">{links.map(link=><a key={link.label} href={link.url} className="p-ext-link">{link.icon}{__msg(link.label)}<ArrowUpRight size={12}/></a>)}</div>}
      </aside>
      <div className="p-main">
        <section className="p-card"><div className="p-section-heading"><span className="p-section-icon"><Sparkles size={19}/></span><div><h2 className="p-card-title">{__msg("Skills & expertise")}</h2><p>{__msg("The tools and ideas you bring to the table.")}</p></div></div>{skills?.length ? <div className="p-tags">{skills.map(skill=><span key={skill} className="p-tag">{skill}</span>)}</div> : <div className="p-empty-block"><p>{__msg("No skills added yet.")}</p>{isOwnProfile && <Link to="/profile/update">{__msg("Add your skills")}{" "}<ArrowUpRight size={13}/></Link>}</div>}</section>
        <section className="p-card"><div className="p-section-heading"><span className="p-section-icon"><BriefcaseBusiness size={19}/></span><div><h2 className="p-card-title">{__msg("Experience")}</h2><p>{__msg("The chapters that shaped your perspective.")}</p></div></div>{experiences?.length ? <ul className="p-exp-list">{experiences.map(exp=><li key={exp.id} className="p-exp-item"><div className="p-exp-header"><div><p className="p-exp-title">{exp.title}</p>{exp.organization && <p className="p-exp-org">{exp.organization}</p>}</div><span className="p-exp-years">{exp.start_year} – {exp.end_year ?? __msg("Present")}</span></div>{exp.description && <p className="p-exp-desc">{exp.description}</p>}</li>)}</ul> : <div className="p-empty-block"><p>{__msg("No experience added yet.")}</p>{isOwnProfile && <Link to="/profile/update">{__msg("Share your experience")}{" "}<ArrowUpRight size={13}/></Link>}</div>}</section>
        <CompetitionHistory organized title={__msg("Organized competitions")} Icon={Flag} items={organizedComps} error={competitionErrors.organizer} own={isOwnProfile}/>
        <CompetitionHistory title={__msg("Participated competitions")} Icon={Trophy} items={participatedComps} error={competitionErrors.participant} own={isOwnProfile}/>
      </div>
    </div>
  </ProfileFrame>
}
