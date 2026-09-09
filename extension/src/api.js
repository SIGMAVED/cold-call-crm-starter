const BASE = 'http://localhost:4001/api';
const WS_BASE = 'ws://localhost:4001';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getTwilioToken: () => request('/twilio/token', { method: 'POST' }),
  getLeadByPhone: (phone) => request(`/leads/by-phone/${encodeURIComponent(phone)}`),
  checkDnc: (numbers) => request('/leads/check-dnc', { method: 'POST', body: JSON.stringify({ numbers }) }),
  listRecentCalls: (limit = 20) => request(`/calls?limit=${limit}`),
  getTodayCallCount: () => request('/calls/today-count'),
  getDialerQueue: () => request('/dialer-queue'),
  getInbox: () => request('/inbox'),
  getRecording: () => request('/twilio/recording'),
  setRecording: (enabled) => request('/twilio/recording', { method: 'POST', body: JSON.stringify({ enabled }) }),
  getCall: (id) => request(`/calls/${id}`),
  getCurrentTarget: () => request('/targets/current'),
  startSession: (leadCount) => request('/sessions', { method: 'POST', body: JSON.stringify({ lead_count: leadCount }) }),
  updateSession: (id, dialCount) => request(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ dial_count: dialCount }) }),
};

export function transcriptSocketUrl(callSid) {
  return `${WS_BASE}/transcripts/${encodeURIComponent(callSid)}`;
}

export const CRM_BASE_URL = 'http://localhost:5173';
