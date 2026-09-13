import { getGoogleAccessToken } from './google.js';

const API_ROOT = 'https://sheets.googleapis.com/v4';
const MAX_WRITE_ROWS = 700;
const REQUEST_TIMEOUT_MS = 25000;

function q(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function request(env, path, init = {}, accessToken = null) {
  const token = accessToken || await getGoogleAccessToken(env);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${API_ROOT}/${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers || {})
        }
      });
    } catch (e) {
      lastError = e?.name === 'AbortError' ? new Error('Google Sheets request timeout') : e;
      lastError.status = 504;
      if (attempt === 3) break;
      await new Promise(r => setTimeout(r, 400 * (2 ** attempt) + Math.floor(Math.random() * 250)));
      continue;
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (res.ok) return data;

    const message = data?.error?.message || `Google Sheets ${res.status}`;
    lastError = new Error(message);
    lastError.status = res.status;

    // Transient Google/API gateway errors get a short backoff.
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 3) break;
    const retryAfter = Number(res.headers.get('retry-after') || 0);
    const backoff = retryAfter > 0 ? Math.min(8000, retryAfter * 1000) : Math.min(8000, 400 * (2 ** attempt) + Math.floor(Math.random() * 250));
    await new Promise(r => setTimeout(r, backoff));
  }
  throw lastError || new Error('Google Sheets request failed');
}

export async function getSpreadsheet(env, accessToken = null) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID belum diatur');
  }
  return request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}?fields=spreadsheetId,properties(locale),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))`,
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

function normalizeFormulaSeparators(formula, separator) {
  const f = String(formula || '');
  if (separator !== ';' || !f.includes(',')) return f;
  let out = '', quoted = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '"') { quoted = !quoted; out += ch; continue; }
    if (ch === ',' && !quoted) out += ';'; else out += ch;
  }
  return out;
}

function formulaSeparator(meta) {
  const locale = String(meta?.properties?.locale || '').toLowerCase();
  // Locales that use comma as decimal separator generally use semicolon as the
  // formula argument delimiter in the Sheets UI/parser. Indonesian is one of them.
  return (/^(id|de|fr|es|it|pt|nl|tr|ru|pl|sv|da|fi|no|cs|uk)([-_]|$)/.test(locale)) ? ';' : ',';
}

function rowsMatrix(sheet, separator = ',') {
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
    // Preserve workbook formulas, but adapt only the argument delimiter for the
    // destination spreadsheet locale so formulas do not become #ERROR!/parse errors.
    if (typeof f === 'string' && f.startsWith('=') && !/\[[^\]]+\]/.test(f)) {
      return normalizeFormulaSeparators(f, separator);
    }
    return row?.[c] ?? '';
  }));
}

async function clearAndWriteSheet(env, title, sheet, accessToken, meta = null) {
  const matrix = rowsMatrix(sheet, formulaSeparator(meta));
  const rows = matrix.length;
  const cols = Math.max(Number(sheet?.cols) || 0, ...matrix.map(r => r.length), 1);
  const lastCol = columnLetter(cols - 1);
  const existing = (meta?.sheets || []).find(s => s.properties.title === title);
  const oldRows = Number(existing?.properties?.gridProperties?.rowCount || 0);
  const oldCols = Number(existing?.properties?.gridProperties?.columnCount || 0);

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

  // Remove stale cells only after all new values have been accepted.
  const cleanup = [];
  if (oldRows > rows) {
    const tailEndCol = columnLetter(Math.max(oldCols, cols, 1) - 1);
    cleanup.push(`${q(title)}!A${rows + 1}:${tailEndCol}${oldRows}`);
  }
  if (oldCols > cols && rows > 0) {
    const startTailCol = columnLetter(cols);
    const tailEndCol = columnLetter(oldCols - 1);
    cleanup.push(`${q(title)}!${startTailCol}1:${tailEndCol}${rows}`);
  }
  if (!rows && oldRows && oldCols) {
    cleanup.push(`${q(title)}!A1:${columnLetter(oldCols - 1)}${oldRows}`);
  }
  if (cleanup.length) {
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`,
      { method: 'POST', body: JSON.stringify({ ranges: cleanup }) },
      accessToken
    );
  }
  return { rows, chunks };
}


function estimateBytes(value) {
  try { return JSON.stringify(value).length; } catch { return 0; }
}

export async function writeSheetsBatch(env, sheets, year = 2026, options = {}) {
  const entries = Object.entries(sheets || {}).filter(([name, sheet]) => String(name).trim() && sheet);
  if (!entries.length) return { updated: 0, created: 0, results: [] };

  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const currentSheets = meta.sheets || [];
  const existingByTitle = new Map(currentSheets.map(s => [s.properties.title, s]));
  const titles = currentSheets.map(s => s.properties.title);
  const separator = formulaSeparator(meta);

  const targets = entries.map(([name]) => ({
    name,
    title: resolveExistingTitle(year, name, titles) || `${Number(year)}__${name}`
  }));
  const createdTargets = targets.filter(x => !existingByTitle.has(x.title));
  await ensureSheets(env, createdTargets.map(x => x.title), currentSheets, accessToken);

  const dataItems = [];
  const resultRows = [];
  const cleanupRanges = [];

  for (const x of targets) {
    const src = sheets[x.name] || {};
    const matrix = rowsMatrix(src, separator);
    const rows = matrix.length;
    const cols = Math.max(Number(src?.cols) || 0, ...matrix.map(r => r.length), 1);
    const lastCol = columnLetter(cols - 1);
    const old = existingByTitle.get(x.title);
    const oldRows = Number(old?.properties?.gridProperties?.rowCount || 0);
    const oldCols = Number(old?.properties?.gridProperties?.columnCount || 0);

    resultRows.push({
      name: x.name,
      googleTitle: x.title,
      rows,
      chunks: 0,
      created: !old
    });

    // IMPORTANT: do not clear first. Write the new content first so a failed
    // import cannot destroy the previous working data.
    for (let start = 0; start < rows; start += MAX_WRITE_ROWS) {
      const slice = matrix.slice(start, start + MAX_WRITE_ROWS);
      dataItems.push({
        name: x.name,
        range: `${q(x.title)}!A${start + 1}:${lastCol}${start + slice.length}`,
        majorDimension: 'ROWS',
        values: slice
      });
    }

    // Clear only the old tail after the new values have been written.
    const tailRanges = [];
    if (oldRows > rows) {
      const tailEndCol = columnLetter(Math.max(oldCols, cols, 1) - 1);
      tailRanges.push(`${q(x.title)}!A${rows + 1}:${tailEndCol}${oldRows}`);
    }
    if (oldCols > cols && rows > 0) {
      const startTailCol = columnLetter(cols);
      const tailEndCol = columnLetter(oldCols - 1);
      tailRanges.push(`${q(x.title)}!${startTailCol}1:${tailEndCol}${Math.min(oldRows || rows, rows)}`);
    }
    cleanupRanges.push(...tailRanges);
  }

  const batches = [];
  let batch = [];
  let batchSize = 0;
  for (const item of dataItems) {
    const itemSize = estimateBytes(item) + 180;
    if (batch.length && batchSize + itemSize > 1400000) {
      batches.push(batch);
      batch = [];
      batchSize = 0;
    }
    batch.push(item);
    batchSize += itemSize;
  }
  if (batch.length) batches.push(batch);

  for (const payload of batches) {
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: payload.map(({ range, majorDimension, values }) => ({ range, majorDimension, values }))
        })
      },
      accessToken
    );
  }

  // The old tail is removed only after every write chunk succeeds.
  if (cleanupRanges.length) {
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`,
      { method: 'POST', body: JSON.stringify({ ranges: cleanupRanges }) },
      accessToken
    );
  }

  const perSheet = new Map(resultRows.map(x => [x.name, x]));
  for (const item of dataItems) {
    const row = perSheet.get(item.name);
    if (row) row.chunks += 1;
  }
  return {
    updated: targets.length,
    created: createdTargets.length,
    batches: batches.length,
    results: resultRows
  };
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
  // Read formulas separately so round-tripping from Google Sheets back to the
  // editor/Excel keeps existing workbook formulas instead of flattening them.
  const formulaData = await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchGet?majorDimension=ROWS&valueRenderOption=FORMULA&${qs}`,
    {},
    accessToken
  );

  const sheets = {};
  const formulaErrors = [];
  for (let i = 0; i < resolved.length; i++) {
    const item = resolved[i];
    const values = data.valueRanges?.[i]?.values || [];
    const rendered = formulaData.valueRanges?.[i]?.values || [];
    const formulas = {};
    for (let r = 0; r < rendered.length; r++) {
      for (let c = 0; c < (rendered[r] || []).length; c++) {
        const v = rendered[r]?.[c];
        const a = cellAddress(r, c);
        if (typeof v === 'string' && v.startsWith('=')) formulas[a] = v;
        const raw = values[r]?.[c];
        if (formulas[a] && typeof raw === 'string' && ['#ERROR!','#REF!','#NAME?'].includes(raw.trim().toUpperCase())) {
          formulaErrors.push({ canonical: item.canonical, cell: a, formula: v, value: raw });
        }
      }
    }
    sheets[item.canonical] = {
      name: item.canonical,
      googleTitle: item.actual,
      values,
      rows: values.length,
      cols: Math.max(0, ...values.map(r => r.length), ...rendered.map(r => r.length)),
      formulas
    };
  }

  return {
    meta,
    sheets,
    missing: canonicalNames.filter(n => !sheets[n]),
    availableTitles: titles,
    formulaErrors
  };
}

export async function rewriteFormulaCells(env, cells) {
  if (!Array.isArray(cells) || !cells.length) return { updated: 0, batches: 0 };
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const titles = (meta.sheets || []).map(s => s.properties.title);
  const separator = formulaSeparator(meta);
  const data = [];
  for (const x of cells) {
    const name = String(x?.canonical || x?.name || '').trim();
    const cell = String(x?.cell || '').trim();
    const formula = String(x?.formula || '');
    if (!name || !cell || !formula.startsWith('=')) continue;
    const title = resolveExistingTitle(Number(x?.year || 2026), name, titles) || titles.find(t => normalizeName(t) === normalizeName(name));
    if (!title) continue;
    let repaired = formula;
    // Khusus sheet Realisasi Fisik & Keu, kolom E pada baris data memakai
    // hubungan E = I/D*100 sementara I = H*D/100. Secara matematis E = H,
    // tetapi rantai formula tersebut rentan kembali #ERROR setelah import Excel
    // dan refresh pada Google Sheets. Saat error terdeteksi, turunkan menjadi
    // formula langsung yang ekuivalen dan non-circular.
    if (name === 'Realisasi Fisik & Keu' && /^E\d+$/i.test(cell)) {
      const row = cell.slice(1);
      repaired = `=IFERROR(H${row}${separator}"")`;
    }
    data.push({ range: `${q(title)}!${cell}`, majorDimension: 'ROWS', values: [[normalizeFormulaSeparators(repaired, separator)]] });
  }
  if (!data.length) return { updated: 0, batches: 0 };
  for (let i = 0; i < data.length; i += 250) {
    const chunk = data.slice(i, i + 250);
    await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`, { method:'POST', body: JSON.stringify({ valueInputOption:'USER_ENTERED', data:chunk }) }, accessToken);
  }
  return { updated: data.length, batches: Math.ceil(data.length / 250) };
}

export async function writeSingleSheet(env, sheet, year = 2026, options = {}) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Google Sheets belum dikonfigurasi di backend');
  }
  const name = String(sheet?.name || '').trim();
  if (!name) throw new Error('Nama sheet kosong');
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const targetTitle = resolveExistingTitle(year, name, titles) || `${Number(year)}__${name}`;
  const old = currentSheets.find(s => s.properties.title === targetTitle);

  await ensureSheets(env, [targetTitle], currentSheets, accessToken);
  const result = await clearAndWriteSheet(env, targetTitle, sheet, accessToken, meta);

  // clearAndWriteSheet writes a new snapshot after clearing. Single-sheet saves
  // are used for manual editor persistence, so keep the existing behavior but
  // report the exact target explicitly.
  return {
    ok: true,
    name,
    googleTitle: targetTitle,
    created: !titles.includes(targetTitle),
    previousRows: Number(old?.properties?.gridProperties?.rowCount || 0),
    previousCols: Number(old?.properties?.gridProperties?.columnCount || 0),
    ...result
  };
}

export async function writeCells(env, changes, year = 2026) {
  const clean = (changes || []).map(x => ({
    name: String(x?.name || '').trim(),
    row: Number(x?.row),
    col: Number(x?.col),
    value: x?.value ?? ''
  })).filter(x => x.name && Number.isInteger(x.row) && x.row >= 0 && Number.isInteger(x.col) && x.col >= 0);
  if (!clean.length) return { updated: 0, batches: 0 };
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const titles = (meta.sheets || []).map(s => s.properties.title);
  const separator = formulaSeparator(meta);
  const bySheet = new Map();
  for (const x of clean) {
    const title = resolveExistingTitle(year, x.name, titles) || `${Number(year)}__${x.name}`;
    if (!bySheet.has(title)) bySheet.set(title, []);
    const value = typeof x.value === 'string' && x.value.startsWith('=') ? normalizeFormulaSeparators(x.value, separator) : x.value;
    bySheet.get(title).push({ row: x.row, col: x.col, value });
  }
  const data = [];
  for (const [title, cells] of bySheet) {
    for (const c of cells) {
      const addr = cellAddress(c.row, c.col);
      data.push({ range: `${q(title)}!${addr}`, majorDimension: 'ROWS', values: [[c.value]] });
    }
  }
  const batches = [];
  let batch = [], size = 0;
  for (const item of data) {
    const n = estimateBytes(item) + 80;
    if (batch.length && size + n > 700000) { batches.push(batch); batch = []; size = 0; }
    batch.push(item); size += n;
  }
  if (batch.length) batches.push(batch);
  for (const payload of batches) {
    await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: payload })
    }, accessToken);
  }
  return { updated: data.length, batches: batches.length };
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
