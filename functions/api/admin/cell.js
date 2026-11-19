import { classifyBackendError } from '../../lib/errors.js';
import { getCookie, json, verifySession } from '../../lib/security.js';
import { writeCells, normalizePeriod } from '../../lib/sheets.js';

export async function onRequestPost({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }
  try {
    const body = await request.json();
    const year = Number(body?.year || env.DEFAULT_YEAR || 2026);
    const changes = Array.isArray(body?.changes) ? body.changes : [];
    if (!changes.length) return json({ ok: true, updated: 0 });
    if (changes.length > 1000) return json({ ok: false, message: 'Terlalu banyak perubahan sel dalam satu batch.' }, 400);
    const result = await writeCells(env, changes, year, normalizePeriod(body?.period));
    // Google Sheets is authoritative; optional D1 revision tracking must never
    // turn a successful Google save into a fake HTTP 503 (then endless retries).
    if (env.DB) {
      try {
        await env.DB.prepare(
          `INSERT INTO revision_state (id, revision, updated_at)
           VALUES ('global', 1, ?)
           ON CONFLICT(id) DO UPDATE SET revision = revision_state.revision + 1, updated_at = excluded.updated_at`
        ).bind(new Date().toISOString()).run();
      } catch (auxError) {
        console.warn(JSON.stringify({event:'optional_d1_revision_failed',source:'cell.js',message:String(auxError?.message||'D1 unavailable').slice(0,180)}));
      }
    }
    return json({ ok: true, source: 'google-sheets', year, ...result });
  } catch (e) {
    const error=classifyBackendError(e,'Gagal menyimpan perubahan sel');
    console.error(JSON.stringify({event:'cell_save_failed',code:error.code,googleStatus:Number(e?.status||0),at:new Date().toISOString()}));
    return json({ok:false,...error},error.status);
  }
}
