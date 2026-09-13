import { getCookie, json, verifySession } from '../../lib/security.js';
import { writeCells } from '../../lib/sheets.js';

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
    const result = await writeCells(env, changes, year);
    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO revision_state (id, revision, updated_at)
         VALUES ('global', 1, ?)
         ON CONFLICT(id) DO UPDATE SET revision = revision_state.revision + 1, updated_at = excluded.updated_at`
      ).bind(new Date().toISOString()).run();
    }
    return json({ ok: true, source: 'google-sheets', year, ...result });
  } catch (e) {
    return json({ ok: false, message: e.message || 'Gagal menyimpan perubahan sel' }, e?.status === 401 ? 401 : 503);
  }
}
