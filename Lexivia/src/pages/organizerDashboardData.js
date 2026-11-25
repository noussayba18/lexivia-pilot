export class OrganizerDashboardError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export async function loadOrganizerDashboard(request, base, competitionId, signal) {
  const responses = await Promise.all([
    request(`${base}/competitions/${competitionId}`, {signal}),
    request(`${base}/competitions/${competitionId}/monitoring`, {signal}),
  ]);
  // An HTTP error is not a role verdict. Only a valid monitoring response can
  // identify the viewer; never show management controls while this is unknown.
  if (responses.some(response=>response.status===401)) throw new OrganizerDashboardError('session','Session expired. Please log in again.');
  if (responses.some(response=>response.status===403)) throw new OrganizerDashboardError('access','Only the organizer can access this dashboard.');
  if (responses.some(response=>response.status===404)) throw new OrganizerDashboardError('missing','Competition not found');
  if (responses.some(response=>!response.ok)) throw new OrganizerDashboardError('error','Could not load organizer dashboard.');
  let competition, monitoring;
  try { [competition,monitoring] = await Promise.all(responses.map(response=>response.json())); }
  catch { throw new OrganizerDashboardError('error','Could not load organizer dashboard.'); }
  if (!competition?.id || typeof monitoring?.is_organizer !== 'boolean') throw new OrganizerDashboardError('error','Could not load organizer dashboard.');
  if (!monitoring.is_organizer) throw new OrganizerDashboardError('access','Only the organizer can access this dashboard.');
  return {competition,monitoring};
}
