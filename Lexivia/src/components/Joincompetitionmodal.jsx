import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "./Modal";
import "../styles/joinCompetition.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function authHeader() {
  const t = localStorage.getItem("token") || localStorage.getItem("access_token") || localStorage.getItem("jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Join flow:  choose Individually or As a team → (pick an eligible team) → join.
 *
 * Everything shown comes from GET /competitions/{id}/join-options, which applies the
 * organizer's rules (team size, required skills and how many members need them, capacity,
 * approval method). Only teams the user LEADS can join, and only eligible ones are offered.
 * The server re-checks all of it when joining.
 */
export default function JoinCompetitionModal({ competitionId, competitionTitle, onClose, onJoined }) {
  const navigate = useNavigate();
  const [opts, setOpts] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState(null);          // "individual" | "team"
  const [teamId, setTeamId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showIneligible, setShowIneligible] = useState(false);
  const [acceptRules, setAcceptRules] = useState(false);

  useEffect(() => {
    fetch(`${API}/competitions/${competitionId}/join-options`, { headers: authHeader() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Could not load join options");
        return d;
      })
      .then((d) => {
        setOpts(d);
        const indOk = d.individual.available && d.individual.eligible;
        const teamOk = d.team.available && d.team.eligible_count > 0;
        setMode(indOk ? "individual" : teamOk || d.team.available ? "team" : null);
        const first = d.team.teams.find((t) => t.eligible);
        if (first) setTeamId(String(first.id));
      })
      .catch((e) => setLoadError(e.message));
  }, [competitionId]);

  const manual = opts?.join_method === "manual";
  const needsTrack = !!opts?.track_required;
  const eligibleTeams = (opts?.team.teams || []).filter((t) => t.eligible);
  const ineligibleTeams = (opts?.team.teams || []).filter((t) => !t.eligible);

  const canSubmit =
    !submitting &&
    opts?.can_join &&
    (!needsTrack || trackId) &&
    acceptRules &&
    ((mode === "individual" && opts.individual.available && opts.individual.eligible) ||
      (mode === "team" && opts.team.available && eligibleTeams.some(t => String(t.id) === String(teamId))));

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const body = { message, accept_rules: acceptRules, ...(trackId ? { track_id: trackId } : {}) };
      const url = mode === "team" ? "join-team" : "join";
      if (mode === "team") body.team_id = teamId;
      const res = await fetch(`${API}/competitions/${competitionId}/${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not join the competition");
      onJoined(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return <JoinCompetitionDialog model={{ opts, loadError, mode, teamId, trackId, message, submitting, error, showIneligible, acceptRules, manual, needsTrack, eligibleTeams, ineligibleTeams, canSubmit }} actions={{ onClose, submit, setMode, setTeamId, setTrackId, setMessage, setShowIneligible, setAcceptRules, navigate }} competitionTitle={competitionTitle} />;
}

export function JoinCompetitionDialog({ model, actions, competitionTitle }) {
  useInterfaceLanguage();
  const { opts, loadError, mode, teamId, trackId, message, submitting, error, showIneligible, acceptRules, manual, needsTrack, eligibleTeams, ineligibleTeams, canSubmit } = model;
  const { onClose, submit, setMode, setTeamId, setTrackId, setMessage, setShowIneligible, setAcceptRules, navigate } = actions;
  const rules = opts?.rules || { skills: [] };


  return (
    <Modal
      className="join-dialog"
      title={__msg("Join {value0}", {value0: competitionTitle || __msg("competition")})}
      subtitle={manual ? __msg("The organizer reviews every request.") : __msg("You join as soon as you meet the requirements.")}
      onClose={onClose}
      footer={
        opts?.can_join && (
          <>
            <button type="button" className="jc-btn jc-btn-ghost" onClick={onClose}>{__msg("Cancel")}</button>
            <button type="button" className="jc-btn jc-btn-primary" disabled={!canSubmit} onClick={submit}>
              {submitting ? "Submitting…" : manual ? "Send join request" : mode === "team" ? "Join with this team" : __msg("Join competition")}
            </button>
          </>
        )
      }
    >
      {loadError && <p className="jc-error" role="alert">{loadError}</p>}
      {!opts && !loadError && <p className="jc-muted">{__msg("Checking requirements…")}</p>}

      {opts && !opts.can_join && <p className="jc-notice">{opts.blocked_reason}</p>}

      {opts?.can_join && (
        <>
          {(rules.team_size || rules.skills.length > 0 || rules.max_teams) && (
            <div className="jc-rules">
              <strong>{__msg("Requirements")}</strong>
              <ul>
                {rules.team_size && <li>{__msg("Teams:")}{" "}{rules.team_size}</li>}
                {rules.skills.map((s) => <li key={s.skill}>{s.text}</li>)}
                {rules.max_teams && <li>{__msg("Limited to")}{" "}{rules.max_teams}{" "}{__msg("places")}</li>}
              </ul>
            </div>
          )}

          <div className="jc-choice">
            {[
              ["individual", "Join individually", opts.individual.available, opts.individual.eligible, opts.individual.reasons],
              ["team", "Join as a team", opts.team.available, opts.team.eligible_count > 0, []],
            ].map(([key, label, available, ok]) => (
              <button
                key={key}
                type="button"
                disabled={!available}
                aria-pressed={mode === key}
                className={`jc-choice-btn ${mode === key ? "active" : ""}`}
                onClick={() => setMode(key)}
              >
                <span className="jc-choice-icon" aria-hidden="true">{key === "individual" ? "01" : "02"}</span><b>{__msg(label)}</b>
                <span>
                  {!available
                    ? key === "individual" ? __msg("This competition requires teams") : __msg("Individuals only")
                    : ok ? __msg("Eligible") : key === "team" ? __msg("No eligible team") : __msg("Not eligible")}
                </span>
              </button>
            ))}
          </div>

          {mode === "individual" && (
            opts.individual.eligible ? (
              <p className="jc-muted">{__msg("You meet the requirements to join on your own.")}</p>
            ) : (
              <ul className="jc-reasons">{opts.individual.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            )
          )}

          {mode === "team" && (
            <>
              <p className="jc-muted">{__msg("Only a team's leader can join on its behalf.")}</p>

              {eligibleTeams.length > 0 ? (
                <div className="jc-teams">
                  {eligibleTeams.map((t) => (
                    <label key={t.id} className={`jc-team ${teamId === String(t.id) ? "selected" : ""}`}>
                      <input type="radio" name="team" checked={teamId === String(t.id)} onChange={() => setTeamId(String(t.id))} />
                      <div>
                        <b>{t.name}</b>
                        <span>{t.member_count}{" "}{__msg("members ·")}{" "}{t.members.map((m) => m.name).join(", ")}</span>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="jc-notice">{" "}{__msg("None of the teams you lead can join this competition.")}{" "}{opts.team.teams.length === 0 && __msg(" You don't lead any team yet.")}
                </div>
              )}

              {ineligibleTeams.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="jc-link" onClick={() => setShowIneligible((v) => !v)}>
                    {showIneligible ? __msg("Hide") : __msg("Why aren't my other teams listed?")} ({ineligibleTeams.length})
                  </button>
                  {showIneligible && ineligibleTeams.map((t) => (
                    <div key={t.id} className="jc-ineligible">
                      <b>{t.name}</b>
                      <ul>{t.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}

              {opts.team.not_leader_count > 0 && (
                <p className="jc-muted" style={{ marginTop: 10 }}>
                  {opts.team.not_leader_count}{" "}{__msg("team")}{opts.team.not_leader_count === 1 ? "" : "s"}{" "}{__msg("you belong to")}{" "}{opts.team.not_leader_count === 1 ? __msg("isn't") : __msg("aren't")}{" "}{__msg("listed because you aren't the leader.")}{" "}</p>
              )}

              <button type="button" className="jc-link" onClick={() => navigate("/teams")}>{__msg("Create or manage teams →")}</button>
            </>
          )}

          {needsTrack && (
            <div className="jc-field">
              <label htmlFor="join-track">{__msg("Track")}{" "}<span style={{ color: "var(--lx-gold, #c0392b)" }}>*</span></label>
              <select id="join-track" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
                <option value="">{__msg("Select a track…")}</option>
                {opts.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {opts.tracks.find((t) => String(t.id) === String(trackId))?.description && (
                <p className="jc-muted">{opts.tracks.find((t) => String(t.id) === String(trackId)).description}</p>
              )}
              <p className="jc-muted">{__msg("You compete on one track; it can't be changed after joining.")}</p>
            </div>
          )}

          <div className="jc-rulesbox">
            <strong>{__msg("Competition rules")}</strong>
            <div className="jc-rulesbox-list">
              {opts.rules_to_accept.map((r) => (
                <div key={r.key} className="jc-rule">
                  <b>{r.title}</b>
                  <p>{r.text}</p>
                </div>
              ))}
            </div>
            <label className="jc-agree">
              <input type="checkbox" checked={acceptRules} onChange={(e) => setAcceptRules(e.target.checked)} />
              <span>{" "}{__msg("I have read and agree to all the rules above")}{" "}{mode === "team" ? __msg(", on behalf of my team") : ""}.
              </span>
            </label>
          </div>

          {manual && (
            <div className="jc-field">
              <label htmlFor="join-message">{__msg("Message to the organizer")}{" "}<span className="jc-muted">{__msg("(optional)")}</span></label>
              <textarea id="join-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder={mode === "team" ? __msg("Tell the organizer why your team should be accepted…") : __msg("Tell the organizer why you'd like to join…")} />
            </div>
          )}

          {error && <p className="jc-error" role="alert">{__msg(error)}</p>}
        </>
      )}
    </Modal>
  );
}