const encoder = new TextEncoder();

function base64url(input) {
  const bytes = input instanceof Uint8Array ? input : encoder.encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64url(new Uint8Array(sig));
}

export async function createSession(env) {
  const payload = { u: env.ADMIN_USERNAME, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 12 };
  const body = base64url(JSON.stringify(payload));
  const signature = await hmac(env.SESSION_SECRET, body);
  return `${body}.${signature}`;
}

export async function verifySession(env, token) {
  if (!token || !env.SESSION_SECRET) return false;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return false;
  const expected = await hmac(env.SESSION_SECRET, body);
  if (expected !== sig) return false;
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp > Date.now() && payload.u === env.ADMIN_USERNAME;
  } catch {
    return false;
  }
}

export function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const part = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
  });
}

export function authCookie(token, maxAge = 60 * 60 * 12) {
  return `__Host-kk_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearAuthCookie() {
  return '__Host-kk_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}
