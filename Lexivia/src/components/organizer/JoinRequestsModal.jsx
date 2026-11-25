import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import Modal from "../Modal";
import { fmtDate } from "./format";

/**
 * Pending join requests (competitions with manual approval). Each request shows whether
 * the applicant / team still meets the organizer's requirements — the server re-checks
 * on approval, so a request that no longer qualifies can only be rejected.
 */
export default function JoinRequestsModal({ requests, loading, onAction, onClose }) {
  useInterfaceLanguage();
    return (
        <Modal wide title={__msg("Join requests")} subtitle={__msg("{value0} pending", {value0: requests.length})} onClose={onClose}>
            {loading ? (
                <p className="detail-empty">{__msg("Loading requests…")}</p>
            ) : requests.length === 0 ? (
                <p className="detail-empty">{__msg("No pending requests. Everything has been reviewed.")}</p>
            ) : (
                <div className="request-list">
                    {requests.map((req) => {
                        const members = req.team?.members?.length
                            ? req.team.members
                            : [{ user_id: req.user_id, username: req.username, email: req.email, role: "solo", skills: req.skills || [] }];
                        const ok = req.meets_requirements !== false;
                        return (
                            <div key={req.id} className="request-card">
                                <div className="request-head">
                                    <div>
                                        <b>{req.team?.name || req.username || req.user_id}</b>
                                        <span className={`pill ${req.team_id ? "pill-green" : "pill-blue"}`}>{req.team_id ? __msg("TEAM") : __msg("SOLO")}</span>
                                        {req.track_name && <span className="pill pill-gray">{__msg("Track:")}{" "}{req.track_name}</span>}
                                        {req.rules_accepted && <span className="pill pill-gray">{__msg("Rules agreed")}</span>}
                                    </div>
                                    <span className="sub">{fmtDate(req.created_at)}</span>
                                </div>

                                <div className={`request-check ${ok ? "ok" : "bad"}`}>
                                    {ok ? __msg("✓ Meets the competition's requirements") : __msg("⚠ Does not meet the requirements")}
                                    {!ok && <ul>{req.requirement_issues.map((r) => <li key={r}>{r}</li>)}</ul>}
                                </div>

                                {req.message && <p className="request-message">“{__msg(req.message)}”</p>}

                                <div className="request-members">
                                    {members.map((m) => (
                                        <div key={m.user_id} className="member-line">
                                            <b>{m.username || m.user_id}</b>
                                            <span>{m.role || __msg("member")} · {m.email || __msg("no email")}</span>
                                            {(m.skills || []).length > 0 && <em>{m.skills.join(", ")}</em>}
                                        </div>
                                    ))}
                                </div>

                                <div className="request-actions">
                                    <button type="button" disabled={!ok} title={ok ? "" : __msg("Requirements are not met")} onClick={() => onAction(req.id, "approve")}>{__msg("Approve")}</button>
                                    <button type="button" className="danger" onClick={() => onAction(req.id, "reject")}>{__msg("Reject")}</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
}