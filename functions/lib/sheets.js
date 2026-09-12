import { getGoogleAccessToken } from './google.js';

const API_ROOT = 'https://sheets.googleapis.com/v4';
const DEFAULT_COLS = 'ZZ';
const SYSTEM_SHEET = '__SYSTEM';

function q(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function normalizeName(name) {
  return String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function safeErrorMessage(data, status) {
  const msg = data?.error?.message || data?.message || `Google Sheets ${status}`;
  return `Google Sheets ${status}: ${msg}`;
}

async function request(env, path, init = {}) {
  const token = await getGoogleAccessToken(env);
  const res = await fetch(`${API_ROOT}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(safeErrorMessage(data, res.status));
    err.status = res.status;
    err.google = data?.error || null;
    throw err;
  }
  return data;
}

export async function getSpreadsheet(env) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID belum diatur');
  return request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount)))`);
}

export function yearSheetName(year, canonical, existingTitles = []) {
  const exact = existingTitles.find(t => normalizeName(t) === normalizeName(canonical));
  if (exact && Number(year) === 2026) return exact;
  const prefixed = `${Number(year)}__${canonical}`;
  const existingPrefixed = existingTitles.find(t => normalizeName(t) === normalizeName(prefixed));
  return existingPrefixed || prefixed;
}

export function resolveExistingTitle(year, canonical, existingTitles) {
  const exact = existingTitles.find(t => normalizeName(t) === normalizeName(canonical));
  if (exact && Number(year) === 2026) return exact;
  const pref = `${Number(year)}__${canonical}`;
  return existingTitles.find(t => normalizeName(t) === normalizeName(pref)) || null;
}

async function ensureSheets(env, targetTitles, currentSheets, { hide = false } = {}) {
  const existing = new Set(currentSheets.map(s => s.properties.title));
  const missing = [...new Set(targetTitles)].filter(t => !existing.has(t));
  if (!missing.length) return currentSheets;
  const requests = missing.map(title => ({ addSheet: { properties: { title, ...(hide ? { hidden: true } : {}) } } }));
  await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests })
  });
  const meta = await getSpreadsheet(env);
  return meta.sheets || [];
}

async function ensureSystemSheet(env, currentSheets) {
  const existing = currentSheets.find(s => s.properties.title === SYSTEM_SHEET);
  if (existing) return { sheets: currentSheets, sheetId: existing.properties.sheetId };
  const sheets = await ensureSheets(env, [SYSTEM_SHEET], currentSheets, { hide: true });
  const created = sheets.find(s => s.properties.title === SYSTEM_SHEET);
  return { sheets, sheetId: created?.properties.sheetId || null };
}

export async function readWorkbook(env, canonicalNames, year = 2026) {
  const meta = await getSpreadsheet(env);
  const currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const resolved = canonicalNames.map(name => ({ canonical: name, actual: resolveExistingTitle(year, name, titles) })).filter(x => x.actual);

  if (!resolved.length) {
    return { meta, sheets: {}, missing: canonicalNames, availableTitles: titles };
  }

  const ranges = resolved.map(x => `${q(x.actual)}!A:${DEFAULT_COLS}`);
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const data = await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchGet?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&${qs}`);
  const sheets = {};
  for (let i = 0; i < resolved.length; i++) {
    const item = resolved[i];
    const vr = data.valueRanges?.[i] || {};
    const values = vr.values || [];
    sheets[item.canonical] = {
      name: item.canonical,
      googleTitle: item.actual,
      values,
      rows: values.length,
      cols: Math.max(0, ...values.map(r => r.length)),
      formulas: {}
    };
  }
  return { meta, sheets, missing: canonicalNames.filter(n => !sheets[n]), availableTitles: titles };
}

async function readRanges(env, titles) {
  if (!titles.length) return {};
  const ranges = titles.map(title => `${q(title)}!A:${DEFAULT_COLS}`);
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const data = await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchGet?majorDimension=ROWS&valueRenderOption=FORMULA&${qs}`);
  const out = {};
  titles.forEach((title, i) => { out[title] = data.valueRanges?.[i]?.values || []; });
  return out;
}

async function clearTitles(env, titles) {
  if (!titles.length) return;
  await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`, {
    method: 'POST', body: JSON.stringify({ ranges: titles.map(title => `${q(title)}!A:${DEFAULT_COLS}`) })
  });
}

async function writeChunks(env, ranges, chunkSize = 3) {
  for (let i = 0; i < ranges.length; i += chunkSize) {
    const chunk = ranges.slice(i, i + chunkSize);
    await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: chunk })
    });
  }
}

async function restoreSnapshot(env, snapshot) {
  const entries = Object.entries(snapshot || {});
  if (!entries.length) return;
  await clearTitles(env, entries.map(([title]) => title));
  const ranges = entries.map(([title, values]) => ({ range: `${q(title)}!A1`, majorDimension: 'ROWS', values }));
  await writeChunks(env, ranges, 3);
}

export async function writeRevision(env, year = 2026, reason = 'write') {
  const meta = await getSpreadsheet(env);
  const sys = await ensureSystemSheet(env, meta.sheets || []);
  const stamp = new Date().toISOString();
  const revision = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [{
        range: `${q(SYSTEM_SHEET)}!A1:C2`,
        majorDimension: 'ROWS',
        values: [['revision', 'updatedAt', 'year'], [revision, stamp, Number(year)]]
      }]
    })
  });
  return { revision, updatedAt: stamp, year: Number(year), reason, systemSheetId: sys.sheetId };
}

export async function readRevision(env) {
  const meta = await getSpreadsheet(env);
  const titles = (meta.sheets || []).map(s => s.properties.title);
  if (!titles.includes(SYSTEM_SHEET)) return { revision: '0', updatedAt: null, year: null };
  const values = await readRanges(env, [SYSTEM_SHEET]);
  const rows = values[SYSTEM_SHEET] || [];
  return { revision: rows?.[1]?.[0] || '0', updatedAt: rows?.[1]?.[1] || null, year: rows?.[1]?.[2] || null };
}

export async function writeWorkbook(env, payload, year = 2026) {
  const data = payload?.sheets || {};
  const names = Object.keys(data);
  if (!names.length) return { updated: 0, created: 0 };

  const meta = await getSpreadsheet(env);
  let currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const targetMap = {};
  for (const name of names) targetMap[name] = resolveExistingTitle(year, name, titles) || (Number(year) === 2026 ? name : `${Number(year)}__${name}`);
  const targetTitles = Object.values(targetMap);

  currentSheets = await ensureSheets(env, targetTitles, currentSheets);

  // Remote snapshot makes import atomic-ish: if any write fails, attempt to restore the prior values.
  const snapshot = await readRanges(env, targetTitles);
  let changed = false;
  try {
    await clearTitles(env, targetTitles);
    const dataRanges = [];
    for (const name of names) {
      const sheet = data[name] || {};
      const cols = Math.max(sheet.cols || 0, ...(sheet.values || []).map(row => row?.length || 0), 1);
      const rows = (sheet.values || []).map(row => Array.from({ length: cols }, (_, i) => row?.[i] ?? ''));
      dataRanges.push({ range: `${q(targetMap[name])}!A1`, majorDimension: 'ROWS', values: rows });
    }
    await writeChunks(env, dataRanges, 3);
    changed = true;
    const revision = await writeRevision(env, year, 'import-or-save');
    return {
      updated: names.length,
      created: names.filter(name => !titles.includes(targetMap[name])).length,
      targetMap,
      revision,
      response: { ok: true }
    };
  } catch (e) {
    try { await restoreSnapshot(env, snapshot); } catch (restoreErr) {
      e.restoreError = restoreErr?.message || String(restoreErr);
    }
    const wrapped = new Error(e.message || 'Gagal menyimpan ke Google Sheets');
    wrapped.status = e.status || 502;
    wrapped.restoreAttempted = true;
    wrapped.restoreSucceeded = !e.restoreError;
    throw wrapped;
  }
}
