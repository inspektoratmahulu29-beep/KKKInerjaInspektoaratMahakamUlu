import { getCookie, json, verifySession } from '../../lib/security.js';
import { writeSingleSheet } from '../../lib/sheets.js';

export async function onRequestPost({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }

  let body = null;
  try {
    body = await request.json();
    const year = Number(body?.year || env.DEFAULT_YEAR || 2026);
    const sheet = body?.sheet;
    if (!sheet?.name) return json({ ok: false, message: 'Sheet import tidak valid' }, 400);

    const result = await writeSingleSheet(env, sheet, year, { import: true, mode: body?.mode || 'replace' });

    if (env.DB) {
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO revision_state (id, revision, updated_at)
         VALUES ('global', 1, ?)
         ON CONFLICT(id) DO UPDATE SET revision = revision_state.revision + 1, updated_at = excluded.updated_at`
      ).bind(now).run();

      await env.DB.prepare(
        `INSERT INTO import_log (id, year, sheet_name, status, created_at)
         VALUES (?, ?, ?, 'SUCCESS', ?)`
      ).bind(crypto.randomUUID(), year, String(sheet.name), now).run();
    }

    return json({
      ok: true,
      year,
      sheet: sheet.name,
      result,
      message: result.created ? 'Sheet baru dibuat dan diisi' : 'Sheet diperbarui'
    });
  } catch (e) {
    if (env.DB) {
      try {
        await env.DB.prepare(
          `INSERT INTO import_log (id, year, sheet_name, status, created_at)
           VALUES (?, ?, ?, 'FAILED', ?)`
        ).bind(
          crypto.randomUUID(),
          Number(body?.year || env.DEFAULT_YEAR || 2026),
          String(body?.sheet?.name || ''),
          new Date().toISOString()
        ).run();
      } catch {}
    }
    return json(
      { ok: false, message: e.message || 'Import sheet gagal' },
      e?.status === 401 ? 401 : 503
    );
  }
}
