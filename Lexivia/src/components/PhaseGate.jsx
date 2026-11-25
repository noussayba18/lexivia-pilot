import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * PhaseGate.jsx
 *
 * Wrap a competition page so participants only reach it when the organizer's
 * current phase allows it. Otherwise they get the normal sidebar plus a locked
 * screen that says which phase the competition is in (name + description set by
 * the organizer), what IS open right now, and when this page unlocks.
 *
 *     export default withPhaseGate(DataCollection, "data-collection");
 *
 * The page key is the sidebar path (data-collection, data-annotation, team-dataset,
 * dataset-hub, experiments, experiment-registry, leaderboard, documentation).
 * Organizers always pass through.
 */
import { useNavigate, useParams } from "react-router-dom";
import CompetitionSidebar from "./CompetitionSidebar";
import { usePhaseAccess, isPageLocked } from "./usePhaseAccess";
import "./PhaseGate.css";

const PAGE_LABELS = {
  "data-collection": "Data Collection",
  "data-annotation": "Annotation",
  "team-dataset": "Dataset",
  "dataset-hub": "Validation",
  experiments: "Workspace",
  "experiment-registry": "Experiments",
  leaderboard: "Leaderboard",
  documentation: "Documentation",
};

function fmt(d) {
  if (!d) return "";
  const x = new Date(`${d}T00:00:00`);
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString(document.documentElement.lang, { month: "short", day: "numeric", year: "numeric" });
}

function LockedScreen({ competitionId, pageKey, access }) {
  useInterfaceLanguage();
  const navigate = useNavigate();
  const current = access.current;
  const notStarted = access.state === "not_started";
  const open = (access.allowed_pages || []).filter((k) => PAGE_LABELS[k]);
  const unlockPhase = (access.phases || []).find(
    (p) => p.status === "upcoming" && (p.allowed_pages == null || p.allowed_pages.includes(pageKey))
  );
  const label = PAGE_LABELS[pageKey] || "This page";

  return (
    <div className="pg-main">
      <div className="pg-card">
        <div className="pg-lock" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h2 className="pg-title">{__msg(label)}{" "}{__msg("is locked right now")}</h2>

        {notStarted ? (
          <p className="pg-sub">{__msg("The competition hasn't started yet")}{access.starts_on ? __msg(" — it begins on {value0}", {value0: fmt(access.starts_on)}) : ""}.</p>
        ) : (
          <>
            <p className="pg-sub">{__msg("You're not allowed to open this page during the current phase of the competition.")}</p>
            {current && (
              <div className="pg-phase">
                <div className="pg-phase-label">{__msg("Current phase ·")}{" "}{current.order}{" "}{__msg("of")}{" "}{access.phases.length}</div>
                <div className="pg-phase-name">{current.name}</div>
                {current.description && <p className="pg-phase-desc">{current.description}</p>}
                {current.ends_on && <p className="pg-phase-desc" style={{ marginTop: 6, color: "var(--lx-muted, #6b7280)" }}>{__msg("Ends")}{" "}{fmt(current.ends_on)}</p>}
              </div>
            )}
          </>
        )}

        {unlockPhase && (
          <p className="pg-sub">
            <strong>{__msg(label)}</strong>{" "}{__msg("opens in the phase")}{" "}<strong>{unlockPhase.name}</strong>
            {unlockPhase.starts_on ? __msg(", starting {value0}", {value0: fmt(unlockPhase.starts_on)}) : ""}.
          </p>
        )}

        {open.length > 0 && (
          <>
            <div className="pg-section">{__msg("Open in this phase")}</div>
            <div className="pg-actions">
              {open.map((k) => (
                <button key={k} type="button" className="pg-btn" onClick={() => navigate(`/competitions/${competitionId}/${k}`)}>
                  {PAGE_LABELS[k]}
                </button>
              ))}
            </div>
          </>
        )}

        {(access.phases || []).length > 1 && (
          <>
            <div className="pg-section">{__msg("Timeline")}</div>
            <ul className="pg-timeline">
              {access.phases.map((p) => (
                <li key={p.id ?? p.order} className={p.status}>
                  <span>{p.order}. {p.name}</span>
                  <small>{fmt(p.starts_on)}{p.ends_on ? ` → ${fmt(p.ends_on)}` : ""}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export function withPhaseGate(Page, pageKey) {
  function Gated(props) {
  useInterfaceLanguage();
    const params = useParams();
    const competitionId = params.id ?? params.competitionId;
    const { loading, access } = usePhaseAccess(competitionId);

    if (loading) {
      return (
        <div className="pg-shell">
          <CompetitionSidebar competitionId={competitionId} />
          <div className="pg-loading">{__msg("Loading…")}</div>
        </div>
      );
    }

    if (isPageLocked(access, pageKey)) {
      return (
        <div className="pg-shell">
          <CompetitionSidebar competitionId={competitionId} />
          <LockedScreen competitionId={competitionId} pageKey={pageKey} access={access} />
        </div>
      );
    }

    return <Page {...props} />;
  }
  Gated.displayName = `PhaseGate(${Page.displayName || Page.name || "Page"})`;
  return Gated;
}

export default withPhaseGate;