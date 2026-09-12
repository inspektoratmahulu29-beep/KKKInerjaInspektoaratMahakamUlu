import { getGoogleAccessToken } from './google.js';

export async function sheetsRequest(env, path, init = {}) {
  const token = await getGoogleAccessToken(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error?.message || `Google Sheets ${res.status}`);
  return data;
}

export async function getSpreadsheetMetadata(env) {
  return sheetsRequest(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}?fields=spreadsheetId,sheets(properties(sheetId,title,index))`);
}

export async function readWorkbook(env, sheetNames) {
  const ranges = sheetNames.map(n => `'${String(n).replace(/'/g, "''")}'`);
  const meta = await getSpreadsheetMetadata(env);
  const available = new Set((meta.sheets || []).map(s => s.properties.title));
  const wanted = sheetNames.filter(n => available.has(n));
  if (!wanted.length) return { meta, sheets: {} };
  const qs = wanted.map(n => `ranges=${encodeURIComponent(`'${n.replace(/'/g, "''")}'`)}`).join('&');
  const data = await sheetsRequest(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchGet?majorDimension=ROWS&${qs}`);
  const sheets = {};
  for (const vr of data.valueRanges || []) {
    const title = String(vr.range || '').split('!')[0].replace(/^'/, '').replace(/'$/, '').replace(/''/g, "'");
    const values = vr.values || [];
    sheets[title] = { name: title, values, rows: values.length, cols: Math.max(0, ...values.map(r => r.length)), formulas: {} };
  }
  return { meta, sheets };
}

function formulaValue(sheet, r, c, v) {
  const addr = (()=>{ let n=c+1, s=''; while(n){const q=(n-1)%26;s=String.fromCharCode(65+q)+s;n=Math.floor((n-1)/26);} return s+(r+1); })();
  return sheet?.formulas?.[addr] || (v === null || v === undefined ? '' : v);
}

export async function writeWorkbook(env, payload) {
  const data = payload?.sheets || {};
  const names = Object.keys(data);
  if (!names.length) return { updated: 0 };

  // Clear values only, preserving the spreadsheet's formatting/merged cells.
  await sheetsRequest(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: names.map(name => `'${name.replace(/'/g, "''")}'!A:ZZ`) })
  });

  const values = names.map(name => {
    const sheet = data[name];
    const rows = (sheet.values || []).map((row, r) => row.map((v, c) => formulaValue(sheet, r, c, v)));
    return { range: `'${name.replace(/'/g, "''")}'!A1`, majorDimension: 'ROWS', values: rows };
  });
  const url = `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`;
  return sheetsRequest(env, url, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: values }) });
}

