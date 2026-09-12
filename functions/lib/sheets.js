import { getGoogleAccessToken } from './google.js';

const API_ROOT = 'https://sheets.googleapis.com/v4';
const DEFAULT_COLS = 'ZZ';

function q(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
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
  if (!res.ok) throw new Error(data?.error?.message || `Google Sheets ${res.status}`);
  return data;
}

export async function getSpreadsheet(env) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID belum diatur');
  return request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}?fields=spreadsheetId,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))`);
}

function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function yearSheetName(year, canonical, existingTitles = []) {
  const exact = existingTitles.find(t => t === canonical);
  if (exact && Number(year) === 2026) return exact;
  const prefixed = `${Number(year)}__${canonical}`;
  const existingPrefixed = existingTitles.find(t => t === prefixed);
  return existingPrefixed || prefixed;
}

export function resolveExistingTitle(year, canonical, existingTitles) {
  const exact = existingTitles.find(t => normalizeName(t) === normalizeName(canonical));
  if (exact && Number(year) === 2026) return exact;
  const pref = `${Number(year)}__${canonical}`;
  const prefHit = existingTitles.find(t => normalizeName(t) === normalizeName(pref));
  return prefHit || null;
}

async function ensureSheets(env, targetTitles, currentSheets) {
  const existing = new Set(currentSheets.map(s => s.properties.title));
  const missing = [...new Set(targetTitles)].filter(t => !existing.has(t));
  if (!missing.length) return currentSheets;
  const requests = missing.map(title => ({ addSheet: { properties: { title } } }));
  await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests })
  });
  const meta = await getSpreadsheet(env);
  return meta.sheets || [];
}

export async function readWorkbook(env, canonicalNames, year = 2026) {
  const meta = await getSpreadsheet(env);
  const currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const resolved = canonicalNames
    .map(name => ({ canonical: name, actual: resolveExistingTitle(year, name, titles) }))
    .filter(x => x.actual);

  if (!resolved.length) {
    return {
      meta,
      sheets: {},
      missing: canonicalNames,
      availableTitles: titles
    };
  }

  const ranges = resolved.map(x => `${q(x.actual)}!A:${DEFAULT_COLS}`);
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const data = await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchGet?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&${qs}`
  );

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

  const missing = canonicalNames.filter(n => !sheets[n]);
  return { meta, sheets, missing, availableTitles: titles };
}

export async function writeWorkbook(env, payload, year = 2026) {
  const data = payload?.sheets || {};
  const names = Object.keys(data);
  if (!names.length) return { updated: 0, created: 0 };

  const meta = await getSpreadsheet(env);
  let currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);

  const targetMap = {};
  for (const name of names) {
    const existing = resolveExistingTitle(year, name, titles);
    targetMap[name] = existing || `${Number(year)}__${name}`;
  }

  currentSheets = await ensureSheets(env, Object.values(targetMap), currentSheets);

  // Clear only the target sheets' values; this leaves formatting/merged cells intact.
  await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`,
    {
      method: 'POST',
      body: JSON.stringify({
        ranges: Object.values(targetMap).map(title => `${q(title)}!A:${DEFAULT_COLS}`)
      })
    }
  );

  const dataRanges = [];
  for (const name of names) {
    const sheet = data[name] || {};
    const rows = (sheet.values || []).map(row => Array.from({ length: Math.max(sheet.cols || 0, row?.length || 0) }, (_, i) => row?.[i] ?? ''));
    dataRanges.push({
      range: `${q(targetMap[name])}!A1`,
      majorDimension: 'ROWS',
      values: rows
    });
  }

  const response = await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: dataRanges })
    }
  );

  return {
    updated: names.length,
    created: names.filter(name => !titles.includes(targetMap[name])).length,
    targetMap,
    response
  };
}
