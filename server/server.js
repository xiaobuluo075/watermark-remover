const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');

// 旧版 Node/Express 服务器，仅保留作本地参考。
// 生产环境请改用 Cloudflare Pages + Worker 架构。

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const D1_DATABASE_ID = process.env.D1_DATABASE_ID;
const D1_BASE_URL = CF_ACCOUNT_ID && D1_DATABASE_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}`
  : null;

async function d1Query(sql, params = []) {
  if (!D1_BASE_URL || !CF_API_TOKEN) {
    throw new Error('Missing D1 environment variables for legacy server');
  }
  const res = await fetch(`${D1_BASE_URL}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result[0];
}

async function upsertUser({ google_id, email, name, picture }) {
  await d1Query(
    `INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)
     ON CONFLICT(google_id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       last_login = CURRENT_TIMESTAMP`,
    [google_id, email, name, picture]
  );
  const result = await d1Query('SELECT * FROM users WHERE google_id = ?', [google_id]);
  return result.results[0];
}

async function logUsage(user_id, action) {
  await d1Query('INSERT INTO usage_logs (user_id, action) VALUES (?, ?)', [user_id, action]);
}

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1);

const CLIPDROP_API_KEY = process.env.CLIPDROP_API_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:8080/auth/google/callback';
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-only-change-me';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.raw({ type: 'multipart/form-data', limit: '50mb' }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await upsertUser({
        google_id: profile.id,
        email: profile.emails?.[0]?.value || '',
        name: profile.displayName,
        picture: profile.photos?.[0]?.value || '',
      });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/auth/logout', (req, res) => req.logout(() => res.redirect('/')));
app.get('/auth/user', (req, res) => res.json(req.user || null));

app.post('/cleanup', async (req, res) => {
  try {
    if (req.user) {
      await logUsage(req.user.id, 'cleanup');
    }

    const response = await fetch('https://clipdrop-api.co/cleanup/v1', {
      method: 'POST',
      headers: {
        'x-api-key': CLIPDROP_API_KEY,
        'content-type': req.headers['content-type'],
      },
      body: req.body,
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `ClipDrop error: ${response.status}`, detail: errText });
    }

    const resultBuffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', response.headers.get('content-type') || 'image/png');
    res.set('Content-Disposition', 'attachment; filename="result.png"');
    res.send(resultBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '../frontend')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Legacy server running at http://0.0.0.0:${PORT}`);
});
