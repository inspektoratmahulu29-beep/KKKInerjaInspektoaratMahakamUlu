import { getCookie, json, verifySession } from '../../lib/security.js';

export async function onRequestPost({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) return json({ ok: false, message: 'Unauthorized' }, 401);
  try {
    const body = await request.json();
    if (!body?.entry) return json({ ok: false, message: 'Audit entry kosong' }, 400);
    if (env.DB) {
      await env.DB.prepare('INSERT INTO audit_log (id, action, at, details) VALUES (?, ?, ?, ?)')
        .bind(String(body.entry.id || crypto.randomUUID()), String(body.entry.action || 'UNKNOWN'), String(body.entry.at || new Date().toISOString()), JSON.stringify(body.entry.details || {}))
        .run();
    }
    return json({ ok: true, persisted: Boolean(env.DB), at: new Date().toISOString() });
  } catch (e) {
    return json({ ok: false, message: e.message }, 400);
  }
}
