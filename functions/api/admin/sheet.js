import { getCookie, json, verifySession } from '../../lib/security.js';
import { writeSingleSheet } from '../../lib/sheets.js';

export async function onRequestPut({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }
  try {
    const body = await request.json();
    const year = Number(body?.year || env.DEFAULT_YEAR || 2026);
    const name = String(body?.sheet?.name || '').trim();
    if (!name) return json({ ok: false, message: 'Sheet tidak valid' }, 400);
    const result = await writeSingleSheet(env, body.sheet, year);
    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO revision_state (id, revision, updated_at)
         VALUES ('global', 1, ?)
         ON CONFLICT(id) DO UPDATE SET revision = revision_state.revision + 1, updated_at = excluded.updated_at`
      ).bind(new Date().toISOString()).run();
    }
    return json({ ok: true, source: 'google-sheets', year, result }, 200);
  } catch (e) {
    return json({ ok: false, message: e.message || 'Gagal menyimpan sheet' }, e?.status === 401 ? 401 : 503);
  }
}
