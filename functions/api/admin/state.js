import { getCookie, json, verifySession } from '../../lib/security.js';
import { readWorkbook, writeWorkbook } from '../../lib/sheets.js';
import { SEED_WORKBOOK } from '../../lib/seed.js';

const canonicalNames = ['IKU','Rencana Aksi','Capaian Sasaran Strategis','Capaian Sasaran Program','Capaian Sasaran Kegiatan Utama','Capaian Sasaran Kegiatan(Penun)','Capaian Sasaran SUBKegiatan(U)','Capaian Sasaran SUBKegiatan (P)','Monev Renaksi IKU','Monev Program','Monev output Subkegiatan Utama','Monev Subkegiatan Penunjang','Rekap realisasi PKPT','Realisasi Fisik & Keu'];

async function requireAuth(request, env) {
  return verifySession(env, getCookie(request, '__Host-kk_session'));
}

function seedPayload(year) {
  const p = structuredClone(SEED_WORKBOOK);
  if (!p.meta) p.meta = {};
  p.meta.year = Number(year);
  p.activeYear = Number(year);
  return p;
}

export async function onRequestGet({ request, env }) {
  if (!(await requireAuth(request, env))) return json({ ok: false, message: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year') || env.DEFAULT_YEAR || 2026);
  try {
    if (env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      const wb = await readWorkbook(env, canonicalNames, year);
      if (Object.keys(wb.sheets).length) {
        return json({ ok: true, source: 'google-sheets', year, payload: { ...wb, meta: { year, sheetCount: Object.keys(wb.sheets).length }, activeYear: year } });
      }
      return json({
        ok: false,
        code: 'YEAR_NOT_INITIALIZED',
        message: `TA ${year} belum memiliki kertas kerja pada database Google Sheets.`,
        year,
        availableTitles: wb.availableTitles || []
      }, 404);
    }
    return json({ ok: true, source: 'seed', year, payload: seedPayload(year) });
  } catch (e) {
    return json({ ok: false, source: 'error', message: e.message, payload: seedPayload(year) }, 200);
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await requireAuth(request, env))) return json({ ok: false, message: 'Unauthorized' }, 401);
  try {
    const body = await request.json();
    const payload = body?.payload;
    if (!payload?.sheets) return json({ ok: false, message: 'Payload tidak valid' }, 400);
    if (!(env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON)) {
      return json({ ok: false, message: 'Google Sheets belum dikonfigurasi di backend. Simpan lokal tidak diaktifkan pada mode aman ini.' }, 503);
    }
    await writeWorkbook(env, payload, Number(body?.year || payload?.meta?.year || 2026));
    return json({ ok: true, savedAt: new Date().toISOString(), source: 'google-sheets' });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}
