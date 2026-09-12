const encoder = new TextEncoder();

function b64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function utf8b64url(text) {
  return b64url(encoder.encode(text));
}

function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(privateKey, header, claims) {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = utf8b64url(JSON.stringify(header));
  const body = utf8b64url(JSON.stringify(claims));
  const input = `${head}.${body}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

export async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON belum diatur');
  const sa = typeof env.GOOGLE_SERVICE_ACCOUNT_JSON === 'string' ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) : env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt(sa.private_key, { alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.access_token;
}
