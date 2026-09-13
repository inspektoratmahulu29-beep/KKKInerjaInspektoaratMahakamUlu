const encoder = new TextEncoder();
let tokenCache = null;

function b64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function utf8b64url(text) {
  return b64url(encoder.encode(text));
}

function pemToDer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(privateKey, header, claims) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const head = utf8b64url(JSON.stringify(header));
  const body = utf8b64url(JSON.stringify(claims));
  const input = `${head}.${body}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(input)
  );
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

export async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON belum diatur');
  }

  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache;
  if (cached && cached.expiresAt - now > 120) return cached.accessToken;

  let sa;
  try {
    sa = typeof env.GOOGLE_SERVICE_ACCOUNT_JSON === 'string'
      ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)
      : env.GOOGLE_SERVICE_ACCOUNT_JSON;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON tidak valid');
  }

  if (!sa?.client_email || !sa?.private_key) {
    throw new Error('Service Account JSON tidak lengkap');
  }

  const jwt = await signJwt(sa.private_key, { alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}`);
  }

  let data;
  try { data = JSON.parse(bodyText); } catch {
    throw new Error('Respons token Google tidak valid');
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600)
  };
  return data.access_token;
}


export async function getDriveFileModifiedTime(env, fileId = env.GOOGLE_SHEETS_SPREADSHEET_ID) {
  if (!fileId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID belum diatur');
  const token = await getGoogleAccessToken(env);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,modifiedTime,version`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Google Drive ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return {
    id: data.id,
    modifiedTime: data.modifiedTime || null,
    version: data.version || null
  };
}
