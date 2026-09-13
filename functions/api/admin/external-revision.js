import { getCookie, json, verifySession } from '../../lib/security.js';
import { getDriveFileModifiedTime } from '../../lib/google.js';

export async function onRequestGet({ request, env }) {
  if (!(await verifySession(env, getCookie(request, '__Host-kk_session')))) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }
  try {
    const meta = await getDriveFileModifiedTime(env);
    return json({
      ok: true,
      revision: `${meta.modifiedTime || '0'}:${meta.version || '0'}`,
      modifiedTime: meta.modifiedTime,
      version: meta.version,
      source: 'google-drive-metadata'
    });
  } catch (e) {
    // Keep polling failures quiet; the editor can continue using local/last-known data.
    return json({
      ok: false,
      revision: null,
      source: 'unavailable'
    }, 200);
  }
}
