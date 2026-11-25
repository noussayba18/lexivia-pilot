import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../Modal";
import { pretty } from "./format";

const API = "http://127.0.0.1:8000";

/**
 * Data & annotation: how many samples were collected and how far annotation has got
 * (from /annotation/stats — the same numbers annotators see), per-annotator figures,
 * and links into the Data Collection / Annotation pages.
 */
export default function DataModal({ competition, competitionId, monitoring, datasets, onClose }) {
  useInterfaceLanguage();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const t = localStorage.getItem("token") || localStorage.getItem("access_token") || localStorage.getItem("jwt");
        fetch(`${API}/competitions/${competitionId}/annotation/stats`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
            .then((r) => (r.ok ? r.json() : null))
            .then(setStats)
            .catch(() => setStats(null))
            .finally(() => setLoading(false));
    }, [competitionId]);

    const totals = stats?.totals;
    const go = (path) => navigate(`/competitions/${competitionId}/${path}`);

    return (
        <Modal wide title={__msg("Data & annotation")} subtitle={__msg("{value0} sample(s) collected", {value0: monitoring.samples_count ?? 0})} onClose={onClose}
            footer={
                <>
                    <button type="button" className="jc-btn jc-btn-ghost" onClick={() => go("dataset-hub")}>{__msg("Dataset hub")}</button>
                    <button type="button" className="jc-btn jc-btn-ghost" onClick={() => go("data-collection")}>{__msg("Data collection")}</button>
                    <button type="button" className="jc-btn jc-btn-primary" onClick={() => go("data-annotation")}>{__msg("Annotation")}</button>
                </>
            }>
            <h4 className="detail-h">{__msg("Annotation progress")}</h4>
            {loading ? (
                <p className="detail-empty">{__msg("Loading…")}</p>
            ) : !stats?.configured ? (
                <p className="detail-empty">
                    {stats?.required_annotators == null
                        ? __msg("Annotation isn't set up: the number of annotators per sample hasn't been configured.")
                        : __msg("Annotation isn't set up: this competition has no annotation tasks.")}
                </p>
            ) : (
                <>
                    <p className="sub" style={{ marginTop: 0 }}>{" "}{__msg("Each sample needs")}{" "}{stats.required_annotators}{" "}{__msg("different annotator")}{stats.required_annotators === 1 ? "" : "s"}
                        {stats.adjudication ? __msg("; ties get one extra annotator.") : __msg("; ties are flagged for you to resolve.")}
                    </p>
                    <div className="mini-stats">
                        {[["Total", totals.total], ["Completed", totals.completed], ["Partial", totals.partial],
                          ["Not started", totals.not_started], ["Conflicts", totals.conflicts],
                          ["To resolve", totals.conflicts_to_resolve], ["Resolved", totals.resolved_conflicts]].map(([l, n]) => (
                            <div key={l}><strong>{n}</strong><span>{l}</span></div>
                        ))}
                    </div>

                    <h4 className="detail-h">{__msg("Annotators")}</h4>
                    {stats.annotators.length === 0 ? (
                        <p className="detail-empty">{__msg("Nobody has annotated yet.")}</p>
                    ) : (
                        <table className="submission-table">
                            <thead><tr><th>{__msg("Annotator")}</th><th>{__msg("Annotated")}</th><th>{__msg("Completed")}</th><th>{__msg("Partial")}</th><th>{__msg("Conflicts handled")}</th><th>{__msg("Resolved")}</th></tr></thead>
                            <tbody>
                                {stats.annotators.map((a) => (
                                    <tr key={a.id}>
                                        <td style={{ fontWeight: 600 }}>{a.name}</td><td>{a.annotated}</td><td>{a.completed}</td>
                                        <td>{a.partial}</td><td>{a.conflicts_handled}</td><td>{a.conflicts_resolved}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </>
            )}

            {!monitoring.data_collection_enabled && (
                <>
                    <h4 className="detail-h">{__msg("Organizer datasets")}</h4>
                    {datasets.length === 0 ? (
                        <p className="detail-empty">{__msg("No datasets configured. Add them from the dataset hub.")}</p>
                    ) : (
                        <div className="dataset-grid">
                            {datasets.map((d) => (
                                <div className="dataset-card" key={d.id}>
                                    <strong>{d.original_filename || __msg("Dataset file")}</strong>
                                    <p>{d.description || pretty(d.dataset_type)}</p>
                                    <span>{d.dataset_type || __msg("Private")}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
            {competition.assets?.length === 0 && <p className="detail-empty">{__msg("No sample structure defined yet.")}</p>}
        </Modal>
    );
}