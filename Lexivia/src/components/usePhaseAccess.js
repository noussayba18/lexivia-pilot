import { useCallback, useEffect, useState } from "react";

const API = "http://127.0.0.1:8000";

function getToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt")
  );
}

// Sidebar + page gate both ask for the same data: share one request for a few seconds.
const cache = new Map(); // competitionId -> { ts, promise }
const TTL_MS = 15000;

function fetchPhaseAccess(competitionId, force = false) {
  const hit = cache.get(competitionId);
  if (!force && hit && Date.now() - hit.ts < TTL_MS) return hit.promise;
  const token = getToken();
  const promise = fetch(`${API}/competitions/${competitionId}/phase-access`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((res) => {
    if (!res.ok) throw new Error(`phase-access ${res.status}`);
    return res.json();
  });
  cache.set(competitionId, { ts: Date.now(), promise });
  promise.catch(() => cache.delete(competitionId));
  return promise;
}

/** { loading, access, refresh }.  `access` is null if it could not be loaded (fail open;
 *  the backend still enforces locks on the API calls). */
export function usePhaseAccess(competitionId) {
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(!!competitionId);

  const load = useCallback(
    (force = false) => {
      if (!competitionId) return Promise.resolve();
      return fetchPhaseAccess(competitionId, force)
        .then(setAccess)
        .catch(() => setAccess(null))
        .finally(() => setLoading(false));
    },
    [competitionId]
  );

  useEffect(() => {
    setLoading(!!competitionId);
    load();
  }, [competitionId, load]);

  return { loading, access, refresh: () => load(true) };
}

/** True when a participant must NOT open this sidebar page right now. */
export function isPageLocked(access, pageKey) {
  if (!access || !access.enabled || access.is_organizer) return false;
  if (pageKey === "support") return false;
  if (access.allowed_pages == null) return false; // legacy phase: everything open
  return !access.allowed_pages.includes(pageKey);
}