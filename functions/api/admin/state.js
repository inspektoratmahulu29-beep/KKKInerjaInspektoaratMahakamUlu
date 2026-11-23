import { classifyBackendError } from '../../lib/errors.js';
import { getCookie, json, verifySession } from '../../lib/security.js';
import { readWorkbook, writeWorkbook, rewriteFormulaCells, normalizePeriod } from '../../lib/sheets.js';
import { SEED_WORKBOOK } from '../../lib/seed.js';
import { officialReportName } from '../../lib/report-schema.js';
import { publishRevision } from '../../lib/sync-revision.js';

const canonicalNames = ["IKU", "Rencana Aksi", "Capaian Sasaran Strategis", "Capaian Sasaran Program", "Capaian Sasaran Kegiatan Utama", "Capaian Sasaran Kegiatan(Penun)", "Capaian Sasaran SUBKegiatan(U)", "Capaian Sasaran SUBKegiatan (P)", "Monev Renaksi IKU", "Monev Program", "Monev output Subkegiatan Utama", "Monev Subkegiatan Penunjang", "Rekap realisasi PKPT", "Realisasi Fisik & Keu", "Laporan Monev Renaksi", "Rekap NON PKPT 2026", "ST Belum Klasifikasi", "Rekonsiliasi DPPA 2026", "Validasi Data 2026", "Dasar Indikator DPA 2026", "Jadwal PKPT dan Bukti 2026", "Register Bukti Capaian 2026", "Audit Isian 12 Sheet 2026", "Capaian Detail Penunjang 2026", "ST Perlu Pemetaan Okt 2026", "Ringkasan Anggaran PKPT Non", "Rincian Anggaran PKPT 2026", "TOTAL REKAP PKPT NON 2026"];
const mandatoryNames=canonicalNames.filter(n=>n!=='Laporan Monev Renaksi');

async function requireAuth(request, env) {
  return verifySession(env, getCookie(request, '__Host-kk_session'));
}

function seedPayload(year) {
  const p = structuredClone(SEED_WORKBOOK);
  if (!p.meta) p.meta = {};
  p.meta.year = Number(year);
  p.activeYear = Number(year);
  if(Number(year)!==2026 && p.sheets?.Laporan_Monev_Renaksi_2026){
    const target=officialReportName(year);p.sheets[target]={...p.sheets.Laporan_Monev_Renaksi_2026,name:target};delete p.sheets.Laporan_Monev_Renaksi_2026;
  }
  return p;
}

export async function onRequestGet({ request, env }) {
  if (!(await requireAuth(request, env))) return json({ ok: false, message: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year') || env.DEFAULT_YEAR || 2026);
  const period=normalizePeriod(url.searchParams.get('period')||'annual');
  try {
    if (env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      let wb = await readWorkbook(env, [...mandatoryNames, officialReportName(year), 'Laporan Monev Renaksi'], year, period);
      if (Object.keys(wb.sheets).length) {
        return json({
          ok: true,
          source: 'google-sheets',
          year,
          needsImport: false,
          officialMonevMissing: Number(year)===2026 && (wb.missing||[]).includes(officialReportName(year)),
          missingSheets: wb.missing||[],
          period,
          formulaRepairCount: Array.isArray(wb.formulaErrors) ? wb.formulaErrors.length : 0,
          payload: { ...wb, meta: { formulaAuthority:'google-sheets', year, sheetCount: Object.keys(wb.sheets).length }, activeYear: year }
        });
      }
      const seed = seedPayload(year);
      return json({
        ok: true,
        source: 'google-sheets-uninitialized',
        needsImport: true,
        code: period==='annual'?'YEAR_NOT_INITIALIZED':'PERIOD_NOT_INITIALIZED',
        period,
        message: `TA ${year} belum memiliki kertas kerja di Google Sheets. Gunakan Import Excel untuk membuat/menulis seluruh sheet kertas kerja termasuk Laporan Monev Renaksi.`,
        year,
        availableTitles: wb.availableTitles || [],
        payload: seed
      }, 200);
    }
    return json({ ok:false, source:'unconfigured', code:'GOOGLE_CONFIG_MISSING', message:'Google Sheets belum dikonfigurasi. Atur GOOGLE_SHEETS_SPREADSHEET_ID dan GOOGLE_SERVICE_ACCOUNT_JSON di Settings → Variables and secrets (Production).', year, period }, 503);
  } catch (e) {
    const error=classifyBackendError(e,'Tidak dapat membaca Google Sheets');
    console.error(JSON.stringify({event:'sheet_read_failed',code:error.code,googleStatus:Number(e?.status||0),at:new Date().toISOString()}));
    return json({ok:false,source:'error',...error,year,period},error.status);
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
    await writeWorkbook(env, payload, Number(body?.year || payload?.meta?.year || 2026), normalizePeriod(body?.period));
    const sync=await publishRevision(env,{year:Number(body?.year || payload?.meta?.year || 2026),period:normalizePeriod(body?.period),action:'workbook',count:Object.keys(payload.sheets).length});
    return json({ ok: true, savedAt: new Date().toISOString(), source: 'google-sheets',sync });
  } catch (e) {
    const error=classifyBackendError(e,'Gagal menyimpan workbook');return json({ok:false,...error},error.status);
  }
}
