// All requests go through the Vite proxy in dev (same-origin, cookies flow
// automatically). In prod, set VITE_API_URL and this will call it directly
// with credentials: 'include' for the cross-origin cookie to attach.
const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  // auth
  signup: (body: { email: string; password: string; full_name?: string; phone?: string }) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  // reports
  listReports: (params: Record<string, string> = {}) =>
    request(`/reports?${new URLSearchParams(params)}`),
  createReport: (body: Record<string, unknown>) =>
    request('/reports', { method: 'POST', body: JSON.stringify(body) }),
  updateStatus: (id: string, status: string) =>
    request(`/reports/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  stats: () => request('/reports/stats/summary'),

  // mla
  nearestMla: (lat: number, lng: number) =>
    request(`/mla/nearest?lat=${lat}&lng=${lng}`),
  searchMla: (constituency: string) =>
    request(`/mla?constituency=${encodeURIComponent(constituency)}`),
};
