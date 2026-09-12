import { getCookie, json, verifySession } from '../../lib/security.js';
import { readWorkbook, writeWorkbook } from '../../lib/sheets.js';
import { SEED_WORKBOOK } from '../../lib/seed.js';

const canonicalNames = ['IKU','Rencana Aksi','Capaian Sasaran Strategis','Capaian Sasaran Program','Capaian Sasaran Kegiatan Utama','Capaian Sasaran Kegiatan(Penun)','Capaian Sasaran SUBKegiatan(U)','Capaian Sasaran SUBKegiatan (P)','Monev Renaksi IKU','Monev Program','Monev output Subkegiatan Utama','Monev Subkegiatan Penunjang','Rekap realisasi PKPT','Realisasi Fisik & Keu'];

async function requireAuth(request, env) { return verifySession(env, getCookie(request, '__Host-kk_session')); }
function seedPayload(year) { const p = structuredClone(SEED_WORKBOOK); p.meta = { ...(p.meta || {}), year: Number(year), sheetCount: Object.keys(p.sheets || {}).length }; p.activeYear = Number(year); return p; }

export async function onRequestGet({ request, env }) {
  if (!(await requireAuth(request, env))) return json({ ok: false, message: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year') || env.DEFAULT_YEAR || 2026);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return json({ ok: false, code: 'YEAR_INVALID', message: 'Tahun tidak valid.' }, 400);
  try {
    if (env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      const wb = await readWorkbook(env, canonicalNames, year);
      if (Object.keys(wb.sheets).length) {
        return json({ ok: true, source: 'google-sheets', year, needsImport: false, payload: { ...wb, meta: { ...(wb.meta || {}), year, sheetCount: Object.keys(wb.sheets).length }, activeYear: year } });
      }
      return json({ ok: true, source: 'google-sheets-uninitialized', needsImport: true, code: 'YEAR_NOT_INITIALIZED', message: `TA ${year} belum memiliki kertas kerja di Google Sheets. Gunakan Import Excel untuk membuat/menulis 14 sheet.`, year, availableTitles: wb.availableTitles || [], payload: seedPayload(year) });
    }
    return json({ ok: true, source: 'seed', year, payload: seedPayload(year) });
  } catch (e) {
    return json({ ok: false, code: 'GOOGLE_SHEETS_READ_FAILED', message: 'Database pusat tidak dapat dibaca. Periksa koneksi Google Sheets pada backend.', diagnostic: { status: e.status || 500 } }, e.status >= 400 && e.status < 600 ? e.status : 502);
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await requireAuth(request, env))) return json({ ok: false, message: 'Unauthorized' }, 401);
  try {
    const body = await request.json();
    const payload = body?.payload;
    const year = Number(body?.year || payload?.meta?.year || env.DEFAULT_YEAR || 2026);
    if (!payload?.sheets) return json({ ok: false, code: 'PAYLOAD_INVALID', message: 'Payload tidak valid.' }, 400);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return json({ ok: false, code: 'YEAR_INVALID', message: 'Tahun tidak valid.' }, 400);
    if (!(env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON)) return json({ ok: false, code: 'SHEETS_NOT_CONFIGURED', message: 'Google Sheets belum dikonfigurasi pada backend.' }, 503);
    const result = await writeWorkbook(env, payload, year);
    return json({ ok: true, savedAt: new Date().toISOString(), source: 'google-sheets', ...result });
  } catch (e) {
    return json({ ok: false, code: 'GOOGLE_SHEETS_WRITE_FAILED', message: 'Gagal menyimpan ke database pusat Google Sheets.', diagnostic: { status: e.status || 502, restoreAttempted: Boolean(e.restoreAttempted), restoreSucceeded: e.restoreSucceeded !== false } }, e.status === 401 ? 401 : 502);
  }
}
