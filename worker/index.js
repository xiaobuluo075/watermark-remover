const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SESSION_COOKIE = 'wm_session';
const OAUTH_STATE_COOKIE = 'wm_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const STATE_TTL_SECONDS = 60 * 10;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/auth/google' && request.method === 'GET') {
        return handleGoogleAuth(request, env);
      }

      if (url.pathname === '/auth/google/callback' && request.method === 'GET') {
        return handleGoogleCallback(request, env);
      }

      if (url.pathname === '/auth/user' && request.method === 'GET') {
        return handleAuthUser(request, env);
      }

      if (url.pathname === '/auth/logout' && request.method === 'GET') {
        return handleLogout(request, env);
      }

      if (url.pathname === '/cleanup' && request.method === 'POST') {
        return handleCleanup(request, env);
      }

      return json({ error: 'Not Found' }, 404);
    } catch (err) {
      return json({ error: err.message || 'Internal error' }, 500);
    }
  },
};

async function handleCleanup(request, env) {
  const formData = await request.formData();
  const imageFile = formData.get('image_file');
  const maskFile = formData.get('mask_file');

  if (!imageFile || !maskFile) {
    return json({ error: 'Missing image_file or mask_file' }, 400);
  }

  const user = await getSessionUser(request, env);
  if (user?.id && env.DB) {
    await env.DB.prepare('INSERT INTO usage_logs (user_id, action) VALUES (?, ?)').bind(user.id, 'cleanup').run();
  }

  const clipdropForm = new FormData();
  clipdropForm.append('image_file', imageFile);
  clipdropForm.append('mask_file', maskFile);

  const response = await fetch('https://clipdrop-api.co/cleanup/v1', {
    method: 'POST',
    headers: {
      'x-api-key': env.CLIPDROP_API_KEY,
    },
    body: clipdropForm,
  });

  if (!response.ok) {
    const errText = await response.text();
    return json({ error: `ClipDrop API error: ${response.status}`, detail: errText }, response.status);
  }

  const resultBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'image/png';

  return new Response(resultBuffer, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Content-Disposition': 'attachment; filename="result.png"',
    },
  });
}

async function handleGoogleAuth(request, env) {
  ensureAuthEnv(env);

  const state = randomString(24);
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      'Set-Cookie': cookieString(OAUTH_STATE_COOKIE, state, STATE_TTL_SECONDS),
      ...CORS_HEADERS,
    },
  });
}

async function handleGoogleCallback(request, env) {
  ensureAuthEnv(env);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request.headers.get('Cookie'));

  if (!code || !state || cookies[OAUTH_STATE_COOKIE] !== state) {
    return redirectWithMessage(env.APP_BASE_URL, 'Google 登录校验失败，请重试');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    return redirectWithMessage(env.APP_BASE_URL, 'Google token 获取失败');
  }

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();

  if (!profileRes.ok || !profile.sub) {
    return redirectWithMessage(env.APP_BASE_URL, 'Google 用户信息获取失败');
  }

  const user = await upsertUser(env, {
    google_id: profile.sub,
    email: profile.email || '',
    name: profile.name || '',
    picture: profile.picture || '',
  });

  const sessionValue = await signSession(
    {
      id: user?.id || null,
      google_id: profile.sub,
      email: profile.email || '',
      name: profile.name || '',
      picture: profile.picture || '',
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    env.SESSION_SECRET
  );

  const headers = new Headers({
    Location: env.APP_BASE_URL,
    ...CORS_HEADERS,
  });
  headers.append('Set-Cookie', cookieString(SESSION_COOKIE, sessionValue, SESSION_TTL_SECONDS));
  headers.append('Set-Cookie', cookieString(OAUTH_STATE_COOKIE, '', 0));

  return new Response(null, {
    status: 302,
    headers,
  });
}

async function handleAuthUser(request, env) {
  const user = await getSessionUser(request, env);
  return json(user || null, 200);
}

async function handleLogout(_request, env) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: env.APP_BASE_URL,
      'Set-Cookie': cookieString(SESSION_COOKIE, '', 0),
      ...CORS_HEADERS,
    },
  });
}

async function upsertUser(env, profile) {
  if (!env.DB) return { ...profile, id: null };

  await env.DB.prepare(
    `INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)
     ON CONFLICT(google_id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       last_login = CURRENT_TIMESTAMP`
  ).bind(profile.google_id, profile.email, profile.name, profile.picture).run();

  const result = await env.DB.prepare('SELECT id, google_id, email, name, picture FROM users WHERE google_id = ?')
    .bind(profile.google_id)
    .first();

  return result || { ...profile, id: null };
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const raw = cookies[SESSION_COOKIE];
  if (!raw || !env.SESSION_SECRET) return null;

  const payload = await verifySession(raw, env.SESSION_SECRET);
  if (!payload) return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return {
    id: payload.id || null,
    google_id: payload.google_id,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}

function ensureAuthEnv(env) {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'SESSION_SECRET', 'APP_BASE_URL'];
  for (const key of required) {
    if (!env[key]) throw new Error(`Missing required env: ${key}`);
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function cookieString(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function redirectWithMessage(baseUrl, message) {
  const target = new URL(baseUrl);
  target.searchParams.set('auth_error', message);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      ...CORS_HEADERS,
    },
  });
}

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function signSession(payload, secret) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256(body, secret);
  return `${body}.${signature}`;
}

async function verifySession(value, secret) {
  const [body, signature] = value.split('.');
  if (!body || !signature) return null;
  const expected = await hmacSha256(body, secret);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const jsonStr = new TextDecoder().decode(base64UrlDecode(body));
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

async function hmacSha256(input, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
