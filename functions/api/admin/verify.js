import { getCookie, json, verifySession } from '../../lib/security.js';
import { getSpreadsheet } from '../../lib/sheets.js';

export async function onRequestGet({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) return json({ ok: false, message: 'Unauthorized' }, 401);
  try {
    const wb = await getSpreadsheet(env);
    return json({
      ok: true,
      spreadsheetId: wb.spreadsheetId,
      title: wb.properties?.title || null,
      sheetCount: (wb.sheets || []).length,
      sheets: (wb.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title, hidden: Boolean(s.properties.hidden) }))
    });
  } catch (e) {
    return json({ ok: false, code: 'GOOGLE_SHEETS_VERIFY_FAILED', message: 'Backend belum dapat mengakses Google Sheets.' }, 502);
  }
}
