export function fmtScore(value) {
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    return Number.isNaN(n) ? "—" : n.toFixed(4);
}

export function fmtDate(value) {
    if (!value) return "—";
    try {
        return new Date(value).toLocaleDateString(document.documentElement.lang);
    } catch {
        return value;
    }
}

export const pretty = (t) => {
    const s = String(t || "").replace(/_/g, " ").toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
};