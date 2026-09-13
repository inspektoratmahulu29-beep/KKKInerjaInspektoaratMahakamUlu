import { getGoogleAccessToken } from './google.js';

const API_ROOT = 'https://sheets.googleapis.com/v4';
const MAX_WRITE_ROWS = 250;

function q(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function request(env, path, init = {}, accessToken = null) {
  const token = accessToken || await getGoogleAccessToken(env);
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
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
    if (res.ok) return data;

    const message = data?.error?.message || `Google Sheets ${res.status}`;
    lastError = new Error(message);
    lastError.status = res.status;

    // Transient Google/API gateway errors get a short backoff.
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 2) break;
    await new Promise(r => setTimeout(r, 250 * (2 ** attempt)));
  }
  throw lastError || new Error('Google Sheets request failed');
}

export async function getSpreadsheet(env, accessToken = null) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID belum diatur');
  }
  return request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}?fields=spreadsheetId,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))`,
    {},
    accessToken
  );
}

function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function resolveExistingTitle(year, canonical, existingTitles) {
  const exact = existingTitles.find(t => normalizeName(t) === normalizeName(canonical));
  if (exact && Number(year) === 2026) return exact;
  const pref = `${Number(year)}__${canonical}`;
  return existingTitles.find(t => normalizeName(t) === normalizeName(pref)) || null;
}

async function ensureSheets(env, targetTitles, currentSheets, accessToken = null) {
  const existing = new Set((currentSheets || []).map(s => s.properties.title));
  const missing = [...new Set(targetTitles)].filter(t => !existing.has(t));
  if (!missing.length) return currentSheets || [];
  const requests = missing.map(title => ({
    addSheet: { properties: { title } }
  }));
  await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ requests }) },
    accessToken
  );
  const meta = await getSpreadsheet(env, accessToken);
  return meta.sheets || [];
}

function columnLetter(index) {
  let n = index + 1, s = '';
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellAddress(rowIndex, colIndex) {
  return `${columnLetter(colIndex)}${rowIndex + 1}`;
}

function rowsMatrix(sheet) {
  const values = Array.isArray(sheet?.values) ? sheet.values : [];
  const cols = Math.max(
    Number(sheet?.cols) || 0,
    ...values.map(r => Array.isArray(r) ? r.length : 0),
    0
  );
  const formulas = sheet?.formulas || {};
  return values.map((row, r) => Array.from({ length: cols }, (_, c) => {
    const addr = cellAddress(r, c);
    const f = formulas[addr];
    // Preserve normal local formulas in Google Sheets. External formulas are
    // deliberately kept as their cached imported value to avoid broken links.
    if (typeof f === 'string' && f.startsWith('=') && !/\[[^\]]+\]/.test(f)) return f;
    return row?.[c] ?? '';
  }));
}

async function clearAndWriteSheet(env, title, sheet, accessToken) {
  const matrix = rowsMatrix(sheet);
  const rows = matrix.length;
  const cols = Math.max(Number(sheet?.cols) || 0, ...matrix.map(r => r.length), 1);
  const lastCol = columnLetter(cols - 1);
  const clearRange = `${q(title)}!A1:${lastCol}${Math.max(rows, 1)}`;

  // Values only: formatting/merges remain intact.
  await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`,
    {
      method: 'POST',
      body: JSON.stringify({ ranges: [clearRange] })
    },
    accessToken
  );

  if (!rows) return { rows: 0, chunks: 0 };

  let chunks = 0;
  for (let start = 0; start < rows; start += MAX_WRITE_ROWS) {
    const slice = matrix.slice(start, start + MAX_WRITE_ROWS);
    const endRow = start + slice.length;
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [{
            range: `${q(title)}!A${start + 1}:${lastCol}${endRow}`,
            majorDimension: 'ROWS',
            values: slice
          }]
        })
      },
      accessToken
    );
    chunks++;
  }

  return { rows, chunks };
}

export async function readWorkbook(env, canonicalNames, year = 2026) {
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const resolved = canonicalNames
    .map(name => ({
      canonical: name,
      actual: resolveExistingTitle(year, name, titles)
    }))
    .filter(x => x.actual);

  if (!resolved.length) {
    return {
      meta,
      sheets: {},
      missing: canonicalNames,
      availableTitles: titles
    };
  }

  const ranges = resolved.map(x => `${q(x.actual)}!A:ZZ`);
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const data = await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchGet?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&${qs}`,
    {},
    accessToken
  );

  const sheets = {};
  for (let i = 0; i < resolved.length; i++) {
    const item = resolved[i];
    const values = data.valueRanges?.[i]?.values || [];
    sheets[item.canonical] = {
      name: item.canonical,
      googleTitle: item.actual,
      values,
      rows: values.length,
      cols: Math.max(0, ...values.map(r => r.length)),
      formulas: {}
    };
  }

  return {
    meta,
    sheets,
    missing: canonicalNames.filter(n => !sheets[n]),
    availableTitles: titles
  };
}

export async function writeSingleSheet(env, sheet, year = 2026, options = {}) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Google Sheets belum dikonfigurasi di backend');
  }
  const name = String(sheet?.name || '').trim();
  if (!name) throw new Error('Nama sheet kosong');

  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  let currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const targetTitle = resolveExistingTitle(year, name, titles) || `${Number(year)}__${name}`;

  currentSheets = await ensureSheets(env, [targetTitle], currentSheets, accessToken);
  const result = await clearAndWriteSheet(env, targetTitle, sheet, accessToken);
  return {
    ok: true,
    name,
    googleTitle: targetTitle,
    created: !titles.includes(targetTitle),
    ...result
  };
}

export async function writeWorkbook(env, payload, year = 2026) {
  const data = payload?.sheets || {};
  const names = Object.keys(data);
  if (!names.length) return { updated: 0, created: 0 };

  // Import/save is intentionally performed sheet-by-sheet to keep each request
  // small and prevent a large workbook from timing out a single Pages Function.
  const results = [];
  for (const name of names) {
    results.push(await writeSingleSheet(env, {
      ...(data[name] || {}),
      name
    }, year));
  }
  return {
    updated: results.length,
    created: results.filter(x => x.created).length,
    results
  };
}
