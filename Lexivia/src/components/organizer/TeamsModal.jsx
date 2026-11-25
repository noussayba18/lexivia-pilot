import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import { useState } from "react";
import Modal from "../Modal";
import { fmtDate } from "./format";

/**
 * Teams & participants detail view. Two tabs over the same roster:
 *   Teams         one row per team / solo entry; click a row to expand its members
 *   Participants  every individual, with their team, skills and track
 */
export default function TeamsModal({ competition, teamsData, loading, initialTab = "teams", onClose }) {
  useInterfaceLanguage();
    const [tab, setTab] = useState(initialTab);
    const [open, setOpen] = useState({});
    const [filter, setFilter] = useState("");

    const entries = teamsData?.teams || [];
    const tracksOn = !!competition.tracks_enabled;
    const q = filter.trim().toLowerCase();

    const people = entries.flatMap((t) =>
        t.members.map((m) => ({ ...m, team_name: t.team_name, track_name: t.track_name, joined_at: t.joined_at }))
    );
    const teamRows = entries.filter((t) =>
        !q || (t.team_name || "solo").toLowerCase().includes(q) || t.members.some((m) => (m.username || "").toLowerCase().includes(q)));
    const peopleRows = people.filter((m) =>
        !q || (m.username || "").toLowerCase().includes(q) || (m.team_name || "").toLowerCase().includes(q));

    return (
        <Modal
            wide
            title={__msg("Teams & participants")}
            subtitle={teamsData ? __msg("{value0} team(s) · {value1} solo · {value2} participant(s)", {value0: teamsData.total_teams, value1: teamsData.total_solo_participants, value2: people.length}) : ""}
            onClose={onClose}
        >
            <div className="detail-toolbar">
                <div className="detail-tabs">
                    <button type="button" className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")}>{__msg("Teams")}</button>
                    <button type="button" className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>{__msg("Participants")}</button>
                </div>
                <input className="detail-search" placeholder={__msg("Filter…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>

            {loading ? (
                <p className="detail-empty">{__msg("Loading…")}</p>
            ) : entries.length === 0 ? (
                <p className="detail-empty">{__msg("Nobody has joined yet.")}</p>
            ) : tab === "teams" ? (
                <table className="submission-table">
                    <thead>
                        <tr><th></th><th>{__msg("Team")}</th><th>{__msg("Size")}</th>{tracksOn && <th>{__msg("Track")}</th>}<th>{__msg("Joined")}</th></tr>
                    </thead>
                    <tbody>
                        {teamRows.map((t, i) => {
                            const key = t.team_id || `solo-${i}`;
                            const isOpen = !!open[key];
                            return (
                                <FragmentRow key={key}>
                                    <tr className="row-click" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                                        <td>{isOpen ? "▾" : "▸"}</td>
                                        <td style={{ fontWeight: 600 }}>{t.team_name || __msg("Solo participant")}</td>
                                        <td>{t.size ?? t.members.length}</td>
                                        {tracksOn && <td>{t.track_name || "—"}</td>}
                                        <td>{fmtDate(t.joined_at)}</td>
                                    </tr>
                                    {isOpen && (
                                        <tr className="expand-row">
                                            <td></td>
                                            <td colSpan={tracksOn ? 4 : 3}>
                                                {t.members.map((m) => (
                                                    <div key={m.user_id} className="member-line">
                                                        <b>{m.username || m.user_id}</b>
                                                        <span>{m.email || __msg("no email")}</span>
                                                        {(m.skills || []).length > 0 && <em>{m.skills.join(", ")}</em>}
                                                    </div>
                                                ))}
                                            </td>
                                        </tr>
                                    )}
                                </FragmentRow>
                            );
                        })}
                    </tbody>
                </table>
            ) : (
                <table className="submission-table">
                    <thead>
                        <tr><th>{__msg("Name")}</th><th>{__msg("Team")}</th><th>{__msg("Skills")}</th>{tracksOn && <th>{__msg("Track")}</th>}<th>{__msg("Joined")}</th></tr>
                    </thead>
                    <tbody>
                        {peopleRows.map((m) => (
                            <tr key={`${m.user_id}-${m.team_name}`}>
                                <td style={{ fontWeight: 600 }}>{m.username || m.user_id}<div className="sub">{m.email}</div></td>
                                <td>{m.team_name || __msg("Solo")}</td>
                                <td>{(m.skills || []).join(", ") || "—"}</td>
                                {tracksOn && <td>{m.track_name || "—"}</td>}
                                <td>{fmtDate(m.joined_at)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Modal>
    );
}

// <tr> pairs need a fragment with a key
function FragmentRow({ children }) {
    return <>{children}</>;
}