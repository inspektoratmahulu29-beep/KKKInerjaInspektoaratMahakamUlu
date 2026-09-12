export async function apiJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data?.message || `HTTP ${res.status}`); err.status = res.status; err.code = data?.code; err.diagnostic = data?.diagnostic; throw err; }
  return data;
}
export const adminMe = () => apiJson('/api/auth/me');
export const adminLogin = (username, password) => apiJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const adminLogout = () => apiJson('/api/auth/logout', { method: 'POST', body: '{}' });
export const fetchState = (year) => apiJson(`/api/admin/state?year=${encodeURIComponent(year)}`);
export const saveState = (payload, year) => apiJson('/api/admin/state', { method: 'PUT', body: JSON.stringify({ year, payload }) });
export const fetchRevision = () => apiJson('/api/admin/revision');
export const verifyBackend = () => apiJson('/api/admin/verify');
export const pushAudit = (entry) => apiJson('/api/admin/audit', { method: 'POST', body: JSON.stringify({ entry }) }).catch(() => null);
