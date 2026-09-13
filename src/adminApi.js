export async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const adminMe = async () => {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({ ok: false }));
  // Unauthenticated is a normal state for the login gate; avoid a red console error.
  if (res.status === 401) return { ...data, ok: false };
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
};

export const adminLogin = (username, password) =>
  apiJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

export const adminLogout = () =>
  apiJson('/api/auth/logout', { method: 'POST', body: '{}' });

export const fetchState = (year) =>
  apiJson(`/api/admin/state?year=${encodeURIComponent(year)}`);

export const saveState = (payload, year) =>
  apiJson('/api/admin/state', {
    method: 'PUT',
    body: JSON.stringify({ year, payload })
  });

export const saveSheet = (sheet, year, options = {}) =>
  apiJson('/api/admin/sheet', {
    method: 'PUT',
    body: JSON.stringify({
      year,
      sheet,
      values: sheet?.values || [],
      formulas: sheet?.formulas || {},
      cols: sheet?.cols || 0,
      ...options
    })
  });

export const saveCells = (changes, year) =>
  apiJson('/api/admin/cell', {
    method: 'POST',
    body: JSON.stringify({ year, changes })
  });

export const importSheet = (sheet, year, mode = 'replace') =>
  apiJson('/api/admin/import-sheet', {
    method: 'POST',
    body: JSON.stringify({ year, mode, sheets: [sheet] })
  });

export const importSheets = (sheets, year, mode = 'replace') =>
  apiJson('/api/admin/import-sheet', {
    method: 'POST',
    body: JSON.stringify({ year, mode, sheets })
  });

export const fetchRevision = (year) =>
  apiJson(`/api/admin/revision?year=${encodeURIComponent(year)}`);

export const pushAudit = (entry) =>
  apiJson('/api/admin/audit', {
    method: 'POST',
    body: JSON.stringify({ entry })
  }).catch(() => null);
