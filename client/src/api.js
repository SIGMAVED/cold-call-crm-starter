const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listLeads: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/leads${qs ? `?${qs}` : ''}`);
  },
  meta: () => request('/leads/meta'),
  getLead: (id) => request(`/leads/${id}`),
  createLead: (data) => request('/leads', { method: 'POST', body: JSON.stringify(data) }),
  updateLead: (id, data) => request(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLead: (id) => request(`/leads/${id}`, { method: 'DELETE' }),
  bulkDeleteLeads: (ids) => request('/leads/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  logCall: (id, data) => request(`/leads/${id}/log-call`, { method: 'POST', body: JSON.stringify(data) }),
  getNotes: (id) => request(`/leads/${id}/notes`),
  addNote: (id, body) => request(`/leads/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  draftEmail: (id, email) => request(`/leads/${id}/draft-email`, { method: 'POST', body: JSON.stringify({ email }) }),
  getLeadCalls: (id) => request(`/leads/${id}/calls`),
  queueToday: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/leads/queue/today${qs ? `?${qs}` : ''}`);
  },
  kanban: () => request('/leads/kanban'),
  dashboardFollowups: () => request('/leads/dashboard/followups'),
  stats: () => request('/leads/stats'),
  leadsByIds: (ids) => request(`/leads?ids=${ids.join(',')}`),
  sendToDialer: (entries) => request('/dialer-queue', { method: 'POST', body: JSON.stringify({ entries }) }),
  importPreview: (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${BASE}/import/preview`, { method: 'POST', body: form }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'preview failed');
      return res.json();
    });
  },
  importCommit: (data) => request('/import/commit', { method: 'POST', body: JSON.stringify(data) }),

  listStatuses: () => request('/statuses'),
  createStatus: (data) => request('/statuses', { method: 'POST', body: JSON.stringify(data) }),
  updateStatus: (id, data) => request(`/statuses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteStatus: (id) => request(`/statuses/${id}`, { method: 'DELETE' }),

  listOutcomes: () => request('/outcomes'),
  createOutcome: (data) => request('/outcomes', { method: 'POST', body: JSON.stringify(data) }),
  updateOutcome: (id, data) => request(`/outcomes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteOutcome: (id) => request(`/outcomes/${id}`, { method: 'DELETE' }),

  analytics: (range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request(`/analytics${qs ? `?${qs}` : ''}`);
  },
  dailyDials: (range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request(`/analytics/daily-dials${qs ? `?${qs}` : ''}`);
  },
  dispositionBreakdown: (range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request(`/analytics/dispositions${qs ? `?${qs}` : ''}`);
  },
  roleBreakdown: (range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request(`/analytics/roles${qs ? `?${qs}` : ''}`);
  },
  segments: (by, range = {}) => {
    const qs = new URLSearchParams({ ...range, by }).toString();
    return request(`/analytics/segments?${qs}`);
  },

  listTargets: () => request('/targets'),
  currentTarget: () => request('/targets/current'),
  activeTargets: () => request('/targets/active'),
  createTarget: (data) => request('/targets', { method: 'POST', body: JSON.stringify(data) }),
  updateTarget: (id, data) => request(`/targets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTarget: (id) => request(`/targets/${id}`, { method: 'DELETE' }),

  listSessions: (range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request(`/sessions${qs ? `?${qs}` : ''}`);
  },
  startSession: (leadCount) => request('/sessions', { method: 'POST', body: JSON.stringify({ lead_count: leadCount }) }),
  updateSession: (id, dialCount) => request(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ dial_count: dialCount }) }),

  listCustomFields: () => request('/custom-fields'),
  createCustomField: (data) => request('/custom-fields', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomField: (id, data) => request(`/custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCustomField: (id) => request(`/custom-fields/${id}`, { method: 'DELETE' }),

  funnel: (range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request(`/metrics/funnel${qs ? '?' + qs : ''}`);
  },
  metricsToday: () => request('/metrics/today'),

  twilioBalance: () => request('/twilio/balance'),
  twilioUsage: () => request('/twilio/usage'),
  twilioDailyUsage: (range = {}) => {
    const qs = new URLSearchParams(range).toString();
    return request(`/twilio/usage/daily${qs ? `?${qs}` : ''}`);
  },
};
