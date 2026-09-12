import { json, clearAuthCookie } from '../../lib/security.js';
export async function onRequestPost() { return json({ ok: true }, 200, { 'Set-Cookie': clearAuthCookie() }); }
