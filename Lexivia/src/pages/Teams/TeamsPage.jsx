import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/Sidebar';
import Topbar from '../../components/Topbar';
import './TeamsPage.css';
import '../../styles/directoryRefresh.css';
import { Search, Users, ArrowUpRight } from 'lucide-react';
import CreateTeamModal from './CreateTeamModal';
import { authFetch } from '../../utils/authFetch';

const PAGE_SIZE = 6;
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

function deriveStatus(team) {
  return team.is_my_team ? {label:'YOUR TEAM', color:'active'} : {label:'COMMUNITY', color:'rising'};
}

function resolveTeamLogo(team) {
  const logo = team?.logo_url || team?.logoUrl || team?.picture_url || team?.avatar_url;

  if (!logo) return null;
  if (logo.startsWith('http') || logo.startsWith('data:') || logo.startsWith('blob:')) {
    return logo;
  }

  return `${API_ORIGIN}${logo.startsWith('/') ? logo : `/${logo}`}`;
}

function getInitials(name) {
  if (!name?.trim()) return 'TM';
  return name
    .trim()
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function avatarHue(team) {
  const raw = `${team?.id || ''}-${team?.name || 'team'}`;
  let hash = 0;

  for (let i = 0; i < raw.length; i++) {
    hash = raw.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
}

function DefaultTeamLogo({ team }) {
  return (
    <div className="team-avatar-gradient" style={{ '--avatar-hue': avatarHue(team) }}>
      <span>{getInitials(team?.name)}</span>
    </div>
  );
}

function TeamAvatar({ team }) {
  useInterfaceLanguage();
  const [imageFailed, setImageFailed] = useState(false);
  const logoSrc = resolveTeamLogo(team);
  const showImage = logoSrc && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [logoSrc]);

  return (
    <div className="team-avatar" aria-label={__msg("{value0} logo", {value0: team?.name || __msg("Team")})}>
      {showImage ? (
        <img
          src={logoSrc}
          alt={__msg("{value0} logo", {value0: team?.name || __msg("Team")})}
          className="team-avatar-img"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <DefaultTeamLogo team={team} />
      )}
    </div>
  );
}

function MemberAvatars({ count }) {
  const visible = Math.min(count, 3);
  const extra = count - visible;
  const colors = ['#9bcac5', '#d7bd7b', '#b7b1d1'];

  return (
    <div className="member-avatars">
      {Array.from({ length: visible }).map((_, i) => (
        <div key={i} className="avatar" style={{ background: colors[i], zIndex: visible - i }}>
          <Users size={10} aria-hidden="true"/>
        </div>
      ))}
      {extra > 0 && <div className="avatar avatar-extra">+{extra}</div>}
    </div>
  );
}

function TeamCard({ team, onClick }) {
  useInterfaceLanguage();
  const memberCount = team.member_count ?? 0;
  const { label, color } = deriveStatus(team);

  return (
    <div className="team-card">
      <div className="team-card-header">
        <TeamAvatar team={team} />
        <span className={`status-badge status-${color}`}>{__msg(label)}</span>
      </div>

      <h3 className="team-name">{team.name}</h3>
      <p className="team-desc">{team.description || __msg("No description provided.")}</p>

      <div className="team-meta">
        <div className="meta-box">
          <span className="meta-label">{__msg("MEMBERS")}</span>
          <span className="meta-value">{memberCount}{" "}{__msg("Total")}</span>
        </div>
        <div className="meta-box">
          <span className="meta-label">{__msg("CREATED")}</span>
          <span className="meta-value">
            {team.created_at
              ? new Date(team.created_at).toLocaleDateString(document.documentElement.lang, { month: 'short', year: 'numeric' })
              : __msg("Unknown")}
          </span>
        </div>
      </div>

      <div className="team-footer">
        <MemberAvatars count={memberCount} />
        <button
          className="view-team-btn"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >{" "}{__msg("View Team")}{" "}<ArrowUpRight size={14}/>
        </button>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="team-card" style={{ pointerEvents: 'none' }}>
      {[120, 80, 60, 90].map((w, i) => (
        <div
          key={i}
          style={{
            height: i === 0 ? 44 : 14,
            width: i === 0 ? 44 : `${w}%`,
            background: "var(--lx-raised, #eaeaea)",
            borderRadius: 8,
            marginBottom: 12,
            animation: 'pulse 1.4s ease-in-out infinite',
          }}
        />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

export default function TeamsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        tab: activeTab,
      });

      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const data = await authFetch(`/teams?${params}`);
      setTeams(data.teams ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error(err);
      setError('Failed to load teams. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchQuery, page]);

  useEffect(() => {
    const debounce = setTimeout(fetchTeams, searchQuery ? 350 : 0);
    return () => clearTimeout(debounce);
  }, [fetchTeams, searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, searchQuery]);

  return <TeamsPageView model={{activeTab, searchQuery, teams, loading, error, page, total, showCreateModal}} actions={{setActiveTab,setSearchQuery,setPage,setShowCreateModal,fetchTeams}}/>;
}

export function TeamsPageView({model,actions}) {
  useInterfaceLanguage();
  const navigate = useNavigate();
  const {activeTab, searchQuery, teams, loading, error, page, total, showCreateModal} = model;
  const {setActiveTab,setSearchQuery,setPage,setShowCreateModal,fetchTeams} = actions;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const visiblePages = () => {
    const pages = [];

    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <div className="app-layout teams-directory">
      <Sidebar />
      <div className="main-content">
        <Topbar />
        <main className="page-body directory-main">
          <header className="page-title-row directory-heading">
            <div><p className="directory-eyebrow">{__msg("TEAMS · CONNECT & COLLABORATE")}</p><h1>{__msg("Better questions. Together")}<span>.</span></h1><p>{__msg("Find your people, share your skills, and build something worth exploring.")}</p></div>
            <button className="create-btn" onClick={() => setShowCreateModal(true)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>{" "}{__msg("Create Team")}{" "}</button>
          </header>
          <div className="teams-search"><Search size={17}/><input type="search" aria-label={__msg("Search teams")} placeholder={__msg("Search teams by name…")} value={searchQuery} onChange={e=>{setSearchQuery(e.target.value);setPage(1);}}/></div>
          <div className="tabs" role="group" aria-label={__msg("Team membership filter")}>
            {['all', 'mine'].map((t) => (
              <button
                key={t}
                aria-pressed={activeTab === t} className={`tab${activeTab === t ? ' active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t === 'all' ? __msg("All Teams") : __msg("My Teams")}
              </button>
            ))}
          </div>

          {error && (
            <div className="teams-error" role="alert">
              {__msg(error)} <button onClick={fetchTeams}>{__msg("Try again")}</button>
            </div>
          )}

          <div className="teams-grid" aria-busy={loading}>
            {loading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => <SkeletonCard key={i} />)
            ) : error ? null : teams.length === 0 ? (
              <div className="teams-empty-state">
                <div className="teams-empty-icon"><Users size={25}/></div>
                <div className="teams-empty-title">
                  {activeTab === 'mine' ? __msg("You haven't joined any teams yet.") : __msg("No teams found.")}
                </div>
              </div>
            ) : (
              teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  onClick={() => navigate(`/teams/${team.id}`)}
                />
              ))
            )}
          </div>

          {!loading && total > 0 && (
            <div className="pagination">
              <span className="pagination-info">{__msg("Showing {start}–{end} of {total} teams", {start:(page - 1) * PAGE_SIZE + 1,end:Math.min(page * PAGE_SIZE, total),total})}</span>
              <div className="pagination-controls">
                <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)} aria-label={__msg("Previous page")}>‹</button>
                {visiblePages().map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="page-ellipsis">...</span>
                  ) : (
                    <button
                      key={p}
                      className={`page-btn${p === page ? ' active' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  )
                )}
                <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} aria-label={__msg("Next page")}>›</button>
              </div>
            </div>
          )}
        </main>
      </div>

      <CreateTeamModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          setShowCreateModal(false);
          fetchTeams();
        }}
      />
    </div>
  );
}
