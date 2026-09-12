import { getCookie, json, verifySession } from '../../lib/security.js';
export async function onRequestGet({ request, env }) {
  const ok = await verifySession(env, getCookie(request, '__Host-kk_session'));
  return json({ ok, user: ok ? { username: env.ADMIN_USERNAME } : null }, ok ? 200 : 401);
}
