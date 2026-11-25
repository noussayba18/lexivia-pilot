import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
/**
 * DataHealthPanel.jsx
 *
 * Displays live validation stats: validated / flagged / rejected / pending.
 * Data comes from GET /competitions/{id}/data-health — never hardcoded.
 *
 * Props:
 *   health  — the response object from the /data-health endpoint
 *             { total, validated, flagged, rejected, pending,
 *               avg_text_length, label_distribution, alerts }
 */

import { useEffect, useState } from "react";
import "./DataHealthPanel.css";

// ─── Severity badge ────────────────────────────────────────────────────────────
function SeverityBadge({ alerts }) {
  useInterfaceLanguage();
    if (!alerts || alerts.length === 0)
        return <span className="dhp-badge dhp-badge--healthy">{__msg("● HEALTHY")}</span>;
    const isCrit = alerts.some(a => a.level === "critical");
    return isCrit
        ? <span className="dhp-badge dhp-badge--critical">{__msg("▲ CRITICAL")}</span>
        : <span className="dhp-badge dhp-badge--warning">{__msg("△ WARNING")}</span>;
}

// ─── Single status row ─────────────────────────────────────────────────────────
function StatusRow({ label, count, total, color, icon }) {
  useInterfaceLanguage();
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
        <div className="dhp-status-row">
            <div className="dhp-status-meta">
                <span className="dhp-status-icon" style={{ color }}>{icon}</span>
                <span className="dhp-status-label">{__msg(label)}</span>
                <span className="dhp-status-count" style={{ color }}>{count.toLocaleString(document.documentElement.lang)}</span>
            </div>
            <div className="dhp-bar-track">
                <div
                    className="dhp-bar-fill"
                    style={{ width: `${pct}%`, background: color }}
                />
            </div>
            <span className="dhp-bar-pct">{pct}%</span>
        </div>
    );
}

// ─── Alert row ─────────────────────────────────────────────────────────────────
function AlertRow({ alert }) {
    const isCrit = alert.level === "critical";
    return (
        <div className={`dhp-alert ${isCrit ? "dhp-alert--critical" : "dhp-alert--warning"}`}>
            <span className="dhp-alert-icon">{isCrit ? "⊘" : "△"}</span>
            <div className="dhp-alert-body">
                <p className="dhp-alert-type">{alert.type}</p>
                <p className="dhp-alert-detail">{alert.detail}</p>
            </div>
        </div>
    );
}

// ─── Main panel ────────────────────────────────────────────────────────────────
export default function DataHealthPanel({ health, loading }) {
  useInterfaceLanguage();
    if (loading) {
        return (
            <div className="dhp-panel dhp-panel--loading">
                <div className="dhp-spinner" />
                <p className="dhp-loading-text">{__msg("Analysing dataset health…")}</p>
            </div>
        );
    }

    if (!health) return null;

    const { total = 0, validated = 0, flagged = 0, rejected = 0, pending = 0, alerts = [] } = health;

    const statuses = [
        { label: "Validated", count: validated, color: "var(--lx-teal, #398C92)", icon: "✓" },
        { label: "Pending",   count: pending,   color: "var(--lx-ink, #B49146)", icon: "◔" },
        { label: "Flagged",   count: flagged,   color: "var(--lx-gold, #BB8B51)", icon: "△" },
        { label: "Rejected",  count: rejected,  color: "var(--lx-coral, #B96864)", icon: "⊘" },
    ];

    return (
        <div className="dhp-panel">
            {/* Header */}
            <div className="dhp-panel-header">
                <div className="dhp-panel-title-row">
                    <span className="dhp-panel-title">{__msg("DATA HEALTH")}</span>
                    <SeverityBadge alerts={alerts} />
                </div>
                <span className="dhp-total-label">
                    {total.toLocaleString(document.documentElement.lang)}{" "}{__msg("total samples")}{" "}</span>
            </div>

            {/* Status breakdown */}
            <div className="dhp-status-list">
                {statuses.map(s => (
                    <StatusRow key={s.label} total={total} {...s} />
                ))}
            </div>

            {/* Divider */}
            {alerts.length > 0 && <div className="dhp-divider" />}

            {/* Alerts */}
            {alerts.map((a, i) => <AlertRow key={i} alert={a} />)}

            {alerts.length === 0 && (
                <p className="dhp-no-alerts">{__msg("No quality issues detected.")}</p>
            )}
        </div>
    );
}