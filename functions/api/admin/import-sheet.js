import { getCookie, json, verifySession } from '../../lib/security.js';
import { writeSingleSheet, writeSheetsBatch } from '../../lib/sheets.js';

export async function onRequestPost({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }

  let body = null;
  try {
    body = await request.json();
    const year = Number(body?.year || env.DEFAULT_YEAR || 2026);
    const mode = body?.mode || 'replace';
    const incoming = Array.isArray(body?.sheets)
      ? body.sheets.reduce((acc, sheet) => {
          if (sheet?.name) acc[String(sheet.name)] = sheet;
          return acc;
        }, {})
      : body?.sheet?.name ? { [String(body.sheet.name)]: body.sheet } : {};
    if (!Object.keys(incoming).length) return json({ ok: false, message: 'Sheet import tidak valid' }, 400);

    // One authenticated request can now import the full workbook. The backend
    // batches clear/write calls and splits large payloads to avoid the timeout
    // pattern that previously caused repeated 503 responses.
    const result = Object.keys(incoming).length === 1
      ? await writeSingleSheet(env, Object.values(incoming)[0], year, { import: true, mode })
      : await writeSheetsBatch(env, incoming, year, { import: true, mode });

    if (env.DB) {
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO revision_state (id, revision, updated_at)
         VALUES ('global', 1, ?)
         ON CONFLICT(id) DO UPDATE SET revision = revision_state.revision + 1, updated_at = excluded.updated_at`
      ).bind(now).run();
      for (const sheetName of Object.keys(incoming)) {
        await env.DB.prepare(
          `INSERT INTO import_log (id, year, sheet_name, status, created_at)
           VALUES (?, ?, ?, 'SUCCESS', ?)`
        ).bind(crypto.randomUUID(), year, sheetName, now).run();
      }
    }

    return json({
      ok: true,
      year,
      mode,
      sheetCount: Object.keys(incoming).length,
      result,
      message: Object.keys(incoming).length === 1
        ? (result.created ? 'Sheet baru dibuat dan diisi' : 'Sheet diperbarui')
        : `Import ${Object.keys(incoming).length} sheet berhasil diterapkan`
    });
  } catch (e) {
    if (env.DB) {
      try {
        const now = new Date().toISOString();
        const names = Array.isArray(body?.sheets)
          ? body.sheets.map(s => String(s?.name || '')).filter(Boolean)
          : [String(body?.sheet?.name || '')].filter(Boolean);
        for (const name of names) {
          await env.DB.prepare(
            `INSERT INTO import_log (id, year, sheet_name, status, created_at)
             VALUES (?, ?, ?, 'FAILED', ?)`
          ).bind(crypto.randomUUID(), Number(body?.year || env.DEFAULT_YEAR || 2026), name, now).run();
        }
      } catch {}
    }
    return json({ ok: false, message: e.message || 'Import sheet gagal' }, e?.status === 401 ? 401 : 503);
  }
}
