import { getCookie, json, verifySession } from '../../lib/security.js';
import { readRevision } from '../../lib/sheets.js';

export async function onRequestGet({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) return json({ ok: false, message: 'Unauthorized' }, 401);
  try {
    const revision = await readRevision(env);
    return json({ ok: true, ...revision });
  } catch (e) {
    return json({ ok: false, code: 'REVISION_READ_FAILED', message: 'Gagal membaca status sinkronisasi.' }, e.status === 401 ? 401 : 502);
  }
}
