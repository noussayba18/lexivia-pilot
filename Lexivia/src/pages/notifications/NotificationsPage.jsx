import { relativeTime } from '../../i18n/format.js';
import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import "./NotificationsPage.css";
import "../../styles/notificationsRefresh.css";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
function authHeaders() {
  const token = localStorage.getItem("token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ── Shared type config (mirrors popup) ────────────────────────────────────────

const TYPE_CONFIG = {
  team_invitation: { icon: "👥", color: "var(--lx-ink, #211f54)", bg: "var(--lx-teal-soft, #f0eff8)", label: "Team Invite" },
  team_join_request: { icon: "🙋", color: "var(--lx-teal, #398c92)", bg: "var(--lx-teal-soft, #edf8f6)", label: "Join Request" },
  team_invitation_accepted: { icon: "✅", color: "var(--lx-teal, #398c92)", bg: "var(--lx-teal-soft, #edf8f6)", label: "Invite Accepted" },
  team_invitation_declined: { icon: "❌", color: "var(--lx-coral, #b96864)", bg: "var(--lx-coral-soft, #fff0f0)", label: "Invite Declined" },
  team_join_accepted: { icon: "🎉", color: "var(--lx-teal, #398c92)", bg: "var(--lx-teal-soft, #edf8f6)", label: "Request Accepted" },
  team_join_declined: { icon: "😔", color: "var(--lx-coral, #b96864)", bg: "var(--lx-coral-soft, #fff0f0)", label: "Request Declined" },
  team_member_removed: { icon: "🚪", color: "var(--lx-ink, #ad914f)", bg: "var(--lx-gold-soft, #fff4e6)", label: "Removed from Team" },
  competition_invitation: { icon: "🏆", color: "var(--lx-muted, #8a83a9)", bg: "var(--lx-navy-soft, #f3edff)", label: "Competition Invite" },
  competition_joined: { icon: "📥", color: "var(--lx-ink, #211f54)", bg: "var(--lx-teal-soft, #f0eff8)", label: "New Participant" },
  competition_submission: { icon: "📤", color: "var(--lx-teal, #398c92)", bg: "var(--lx-teal-soft, #edf8f6)", label: "Submission" },
  data_sample_flagged: { icon: "🚩", color: "var(--lx-ink, #ad914f)", bg: "var(--lx-gold-soft, #fff4e6)", label: "Sample Flagged" },
  data_sample_validated: { icon: "✔️", color: "var(--lx-teal, #398c92)", bg: "var(--lx-teal-soft, #edf8f6)", label: "Sample Validated" },
  general: { icon: "📣", color: "var(--lx-muted, #555)", bg: "var(--lx-teal-soft, #f7f8fb)", label: "Info" },
  competition_join_request: { icon: "📥", color: "var(--lx-ink, #211f54)", bg: "var(--lx-teal-soft, #f0eff8)", label: "Competition Join Request" },
};

const ALL_TYPES = [
  "all",
  "team_invitation",
  "team_join_request",
  "team_invitation_accepted",
  "team_invitation_declined",
  "team_join_accepted",
  "team_join_declined",
  "team_member_removed",
  "competition_invitation",
  "competition_joined",
  "competition_submission",
  "data_sample_flagged",
  "data_sample_validated",
  "general",
  "competition_join_request",
];

function typeConfig(type) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.general;
}

function timeAgo(iso) { return relativeTime(iso); }

// ── Full notification card ────────────────────────────────────────────────────

function NotifCard({ notif, onRead, onDelete, onAction, selected, onSelect }) {
  useInterfaceLanguage();
  const cfg = typeConfig(notif.type);
  const [actioning, setActioning] = useState(null); // "accept" | "decline" | null
  const navigate = useNavigate();

  const hasInviteAction = notif.type === "team_invitation" && !notif.action_taken;
  const hasJoinAction = notif.type === "team_join_request" && !notif.action_taken;

  async function doAction(endpoint, label) {
    setActioning(label);
    try {
      const res = await fetch(`${API}/notifications/${notif.id}/${endpoint}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        onAction(notif.id, data.notification);
      }
    } finally {
      setActioning(null);
    }
  }

  function handleNavigate() {
    if (!notif.is_read) onRead(notif.id, true);

    if (notif.type === "competition_join_request" && notif.competition_id) {
      navigate(`/competitions/${notif.competition_id}/organizer#join-requests`);
      return;
    }

    if (notif.team_id) {
      navigate(`/teams/${notif.team_id}`);
      return;
    }

    if (notif.competition_id) {
      navigate(`/competitions/${notif.competition_id}`);
    }
  }

  return (
    <div className={`notif-card${notif.is_read ? " notif-read" : " notif-unread"}${selected ? " notif-selected" : ""}`}>
      {/* Select checkbox */}
      <label className="notif-checkbox" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={__msg("Select notification: {value0}", {value0: notif.title})} checked={selected}
          onChange={() => onSelect(notif.id)}
        />
      </label>

      {/* Unread indicator */}
      <div className="notif-unread-dot" style={{ opacity: notif.is_read ? 0 : 1 }} />

      {/* Icon */}
      <div className="notif-icon" style={{ background: cfg.bg }}>
        <span role="img">{cfg.icon}</span>
      </div>

      {/* Main content */}
      <div className="notif-body" onClick={handleNavigate}>
        <div className="notif-meta-row">
          <span className="notif-type-badge" style={{ color: cfg.color, background: cfg.bg }}>
            {__msg(cfg.label)}
          </span>
          {notif.actor_name && (
            <span className="notif-actor">{__msg("by")}{" "}{notif.actor_name}</span>
          )}
          <span className="notif-time">{timeAgo(notif.created_at)}</span>
        </div>

        <h4 className="notif-title">{__msg(notif.title)}</h4>
        <p className="notif-message">{__msg(notif.message)}</p>

        {/* Context chips */}
        <div className="notif-context-chips">
          {notif.team_name && (
            <span className="context-chip chip-team">👥 {notif.team_name}</span>
          )}
          {notif.competition_name && (
            <span className="context-chip chip-comp">🏆 {notif.competition_name}</span>
          )}
        </div>

        {/* Action buttons */}
        {(hasInviteAction || hasJoinAction) && (
          <div className="notif-actions">
            <button
              className="action-btn action-accept"
              onClick={e => {
                e.stopPropagation();
                doAction(
                  hasInviteAction ? "accept-invitation" : "accept-join-request",
                  "accept"
                );
              }}
              disabled={!!actioning}
            >
              {actioning === "accept" ? __msg("Accepting…") : __msg("✓ Accept")}
            </button>
            <button
              className="action-btn action-decline"
              onClick={e => {
                e.stopPropagation();
                doAction(
                  hasInviteAction ? "decline-invitation" : "decline-join-request",
                  "decline"
                );
              }}
              disabled={!!actioning}
            >
              {actioning === "decline" ? __msg("Declining…") : __msg("✕ Decline")}
            </button>
          </div>
        )}

        {/* Completed action */}
        {notif.action_taken && (
          <span
            className="action-taken-badge"
            style={{
              color: notif.action_taken === "accepted" ? "var(--lx-teal, #398c92)" : "var(--lx-coral, #b96864)",
              background: notif.action_taken === "accepted" ? "var(--lx-teal-soft, #edf8f6)" : "var(--lx-coral-soft, #fff0f0)",
              borderColor: notif.action_taken === "accepted" ? "var(--lx-line, #b2e4c8)" : "var(--lx-line, #fcc)",
            }}
          >
            {notif.action_taken === "accepted" ? __msg("✓ Accepted") : __msg("✕ Declined")}
          </span>
        )}
      </div>

      {/* Row controls */}
      <div className="notif-controls">
        <button
          className="ctrl-btn"
          title={notif.is_read ? __msg("Mark as unread") : __msg("Mark as read")}
          onClick={e => { e.stopPropagation(); onRead(notif.id, !notif.is_read); }}
        >
          {notif.is_read ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="#ccc" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" fill="#211f54" />
              <path d="M4 7l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button
          className="ctrl-btn ctrl-delete"
          title={__msg("Delete notification")}
          onClick={e => { e.stopPropagation(); onDelete(notif.id); }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3.5h10M5.5 3.5V2.5h3v1M4 3.5l.6 7.5h5l.6-7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ filtered }) {
  useInterfaceLanguage();
  return (
    <div className="notif-empty">
      <div className="notif-empty-icon">
        {filtered ? "🔍" : "🔔"}
      </div>
      <h3>{filtered ? __msg("No matching notifications") : __msg("You're all caught up!")}</h3>
      <p>
        {filtered
          ? __msg("Try a different filter or check back later.")
          : __msg("Notifications for team invites, competition updates, and more will appear here.")}
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [notifs, setNotifs] = useState([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState("all");       // type filter
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState(new Set());   // selected IDs

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchNotifs = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
        unread_only: String(unreadOnly),
      });
      if (filter !== "all") params.append("type_filter", filter);

      const res = await fetch(`${API}/notifications?${params}`, {
        signal, headers: authHeaders(),
      });
      if (res.status === 401) { navigate("/login"); return; }
      if (!res.ok) throw new Error("Could not load your notifications.");
      const data = await res.json();
      if (signal?.aborted) return;
      setNotifs(data.items || []);
      setTotal(data.total || 0);
      setUnreadCount(data.unread_count || 0);
    } catch (err) {
      if (!signal?.aborted) setError(err.message || "Could not load notifications.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, filter, unreadOnly, navigate]);

  useEffect(() => { const controller = new AbortController(); fetchNotifs(controller.signal); return () => controller.abort(); }, [fetchNotifs]);

  async function updateNotification(url, options) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error("That change could not be saved. Please try again.");
      setError("");
      return true;
    } catch (err) { setError(err.message || "Could not save notification changes."); return false; }
  }

  // Reset page when filter changes
  useEffect(() => { setPage(1); setSelected(new Set()); }, [filter, unreadOnly]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleRead(id, isRead) {
    if (!await updateNotification(`${API}/notifications/${id}/read`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ is_read: isRead }),
    })) return;
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: isRead } : n));
    const previous = notifs.find(n => n.id === id);
    if (previous && previous.is_read !== isRead) setUnreadCount(prev => isRead ? Math.max(0, prev - 1) : prev + 1);
  }

  async function handleDelete(id) {
    if (!await updateNotification(`${API}/notifications/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    })) return;
    const removed = notifs.find(n => n.id === id);
    setNotifs(prev => prev.filter(n => n.id !== id));
    setTotal(prev => prev - 1);
    if (removed && !removed.is_read) setUnreadCount(prev => Math.max(0, prev - 1));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function handleMarkAllRead() {
    if (!await updateNotification(`${API}/notifications/mark-all-read`, {
      method: "PATCH",
      headers: authHeaders(),
    })) return;
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (!await updateNotification(`${API}/notifications`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ ids }),
    })) return;
    const removedUnread = notifs.filter(n => ids.includes(n.id) && !n.is_read).length;
    setNotifs(prev => prev.filter(n => !ids.includes(n.id)));
    setTotal(prev => prev - ids.length);
    setUnreadCount(prev => Math.max(0, prev - removedUnread));
    setSelected(new Set());
  }

  async function handleClearAll() {
    if (!window.confirm("Delete all notifications? This cannot be undone.")) return;
    if (!await updateNotification(`${API}/notifications`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ all: true }),
    })) return;
    setNotifs([]);
    setTotal(0);
    setUnreadCount(0);
    setSelected(new Set());
  }

  function handleAction(id, updated) {
    if (updated) {
      setNotifs(prev => prev.map(n => n.id === id ? updated : n));
    }
  }

  function handleSelect(id) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function handleSelectAll() {
    if (selected.size === notifs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(notifs.map(n => n.id)));
    }
  }

  return <NotificationsView model={{notifs,total,unreadCount,loading,page,filter,unreadOnly,selected,error}} actions={{handleMarkAllRead,handleClearAll,setFilter,setUnreadOnly,handleRead,handleBulkDelete,setSelected,handleSelectAll,handleDelete,handleAction,handleSelect,setPage,fetchNotifs}}/>;
}

export function NotificationsView({model,actions}) {
  useInterfaceLanguage();
  const {notifs,total,unreadCount,loading,page,filter,unreadOnly,selected,error}=model;
  const {handleMarkAllRead,handleClearAll,setFilter,setUnreadOnly,handleRead,handleBulkDelete,setSelected,handleSelectAll,handleDelete,handleAction,handleSelect,setPage,fetchNotifs}=actions;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltered = filter !== "all" || unreadOnly;

  return (
    <div className="notif-layout notifications-refresh">
      <Sidebar />
      <div className="notif-main">
        <Topbar />
        <div className="notif-page-body">

          {/* ── Top bar ─────────────────────────────────────────────────── */}
          <div className="notif-page-header">
            <div className="notif-page-title-row">
              <div>
                <p className="notif-eyebrow"><Bell size={13}/>{" "}{__msg("YOUR COMMUNITY · KEEP IN TOUCH")}</p><h1 className="notif-page-title">{__msg("The latest from your world")}<span>.</span></h1>
                <p className="notif-page-sub">
                  {unreadCount > 0
                    ? <><strong>{unreadCount}</strong>{" "}{__msg("unread ·")}{" "}{total}{" "}{__msg("total")}</>
                    : <>{total}{" "}{__msg("notification")}{total !== 1 ? "s" : ""}</>}
                </p>
              </div>

              <div className="notif-header-actions">
                {unreadCount > 0 && (
                  <button className="hdr-btn hdr-btn-secondary" onClick={handleMarkAllRead}>
                    <CheckCheck size={15}/>{" "}{__msg("Mark all read")}{" "}</button>
                )}
                {total > 0 && (
                  <button className="hdr-btn hdr-btn-danger" onClick={handleClearAll}>{" "}{__msg("🗑 Clear all")}{" "}</button>
                )}
              </div>
            </div>

            {/* ── Filters ── */}
            <div className="notif-filters">
              <div className="notif-filter-tabs">
                <button
                  aria-pressed={filter === "all"} className={`filter-tab${filter === "all" ? " active" : ""}`}
                  onClick={() => setFilter("all")}
                >{" "}{__msg("All")}{" "}</button>
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    aria-pressed={filter === key} className={`filter-tab${filter === key ? " active" : ""}`}
                    onClick={() => setFilter(key)}
                  >
                    {cfg.icon} {__msg(cfg.label)}
                  </button>
                ))}
              </div>

              <label className="unread-toggle">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={e => setUnreadOnly(e.target.checked)}
                />{" "}{__msg("Unread only")}{" "}</label>
            </div>
          </div>

          {error && <div className="notif-request-error" role="alert">{__msg(error)}<button type="button" onClick={() => fetchNotifs()}><RefreshCw size={14}/>{" "}{__msg("Try again")}</button></div>}
          {/* ── Bulk action bar ─────────────────────────────────────────── */}
          {selected.size > 0 && (
            <div className="bulk-bar">
              <span className="bulk-count">{selected.size}{" "}{__msg("selected")}</span>
              <button className="bulk-btn" onClick={() => {
                [...selected].forEach(id => handleRead(id, true));
                setSelected(new Set());
              }}>{" "}{__msg("Mark read")}{" "}</button>
              <button className="bulk-btn bulk-btn-danger" onClick={handleBulkDelete}>{" "}{__msg("Delete selected")}{" "}</button>
              <button className="bulk-btn" onClick={() => setSelected(new Set())}>{" "}{__msg("Cancel")}{" "}</button>
            </div>
          )}

          {/* ── Notification list ────────────────────────────────────────── */}
          <div className="notif-list-wrap">
            {/* Select-all row */}
            {notifs.length > 0 && (
              <div className="notif-select-all-row">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.size === notifs.length && notifs.length > 0}
                    onChange={handleSelectAll}
                  />
                  <span>{__msg("Select all on this page")}</span>
                </label>
              </div>
            )}

            {loading ? (
              <div className="notif-skeleton-list">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="notif-skeleton" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
            ) : error && notifs.length === 0 ? null : notifs.length === 0 ? (
              <EmptyState filtered={isFiltered} />
            ) : (
              <div className="notif-cards">
                {notifs.map(n => (
                  <NotifCard
                    key={n.id}
                    notif={n}
                    onRead={handleRead}
                    onDelete={handleDelete}
                    onAction={handleAction}
                    selected={selected.has(n.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Pagination ─────────────────────────────────────────────── */}
          {!loading && total > PAGE_SIZE && (
            <div className="notif-pagination">
              <span className="pagination-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}{" "}{__msg("of")}{" "}{total}
              </span>
              <div className="pagination-controls">
                <button
                  className="pag-btn"
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >{" "}{__msg("‹ Prev")}{" "}</button>
                <span className="pag-current">{__msg("Page")}{" "}{page}{" "}{__msg("of")}{" "}{totalPages}</span>
                <button
                  className="pag-btn"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                >{" "}{__msg("Next ›")}{" "}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
