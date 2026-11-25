import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import Modal from "../Modal";
import { fmtDate, fmtScore } from "./format";

export default function SubmissionsModal({ submissions, loading, onClose }) {
  useInterfaceLanguage();
    const tone = (s) => (s === "done" ? ["#e6f9ef", "#1a7a44"] : s === "failed" ? ["#fdeaea", "#c0392b"] : ["#fff7ed", "#b85200"]);
    return (
        <Modal wide title={__msg("Submissions")} subtitle={__msg("{value0} shown", {value0: submissions.length})} onClose={onClose}>
            {loading ? (
                <p className="detail-empty">{__msg("Loading submissions…")}</p>
            ) : submissions.length === 0 ? (
                <p className="detail-empty">{__msg("No submissions yet.")}</p>
            ) : (
                <table className="submission-table">
                    <thead><tr><th>{__msg("Team")}</th><th>{__msg("Score")}</th><th>{__msg("Time")}</th><th>{__msg("Status")}</th></tr></thead>
                    <tbody>
                        {submissions.map((s) => {
                            const [bg, color] = tone(s.status);
                            return (
                                <tr key={s.id}>
                                    <td style={{ fontWeight: 600 }}>
                                        {s.team_name}{!s.is_team && <span className="sub">{" "}{__msg("(solo)")}</span>}
                                    </td>
                                    <td>{fmtScore(s.score)}</td>
                                    <td>{fmtDate(s.submitted_at)}</td>
                                    <td><span className="pill" style={{ background: bg, color }} title={s.error_message || ""}>{s.status || __msg("pending")}</span></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </Modal>
    );
}