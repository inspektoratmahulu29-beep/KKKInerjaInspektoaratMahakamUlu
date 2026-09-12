import { createSession, json, authCookie } from '../../lib/security.js';

export async function onRequestPost({ request, env }) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) return json({ ok: false, message: 'Username dan password wajib diisi' }, 400);
    if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) return json({ ok: false, message: 'Username atau password salah' }, 401);
    const token = await createSession(env);
    return json({ ok: true, user: { username } }, 200, { 'Set-Cookie': authCookie(token) });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}
