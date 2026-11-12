// Login gate for the hosted demo.
// - Credentials come from env: APP_USER and APP_PASS_HASH ("scrypt$<saltHex>$<hashHex>").
//   The plain password is never stored in the repo or the server environment.
// - Brute-force protection: per-IP and per-username failure windows with lockout,
//   a constant delay on every failed attempt, and timing-safe comparisons.
// - Session: HMAC-signed cookie (HttpOnly, Secure in production, SameSite=Lax), valid 30 days.
//   It holds only the username and expiry, never the password.
// If APP_PASS_HASH is not set, the gate is disabled (local development).
import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';

const COOKIE = 'ai7_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_PER_USER = 10;
const LOCK_MS = 15 * 60 * 1000;
const FAIL_DELAY_MS = 800;

const USER = process.env.APP_USER || '';
const PASS_HASH = process.env.APP_PASS_HASH || '';
// Optional, for a judged demo: APP_PREFILL_PASS fills the password field so judges only click Sign in,
// and APP_EXTRA_PASS_HASHES (comma-separated scrypt hashes) accepts other spellings of the demo password.
// Neither is set by default; no password or password hash lives in the repo.
const PREFILL_PASS = process.env.APP_PREFILL_PASS || '';
const EXTRA_HASHES = (process.env.APP_EXTRA_PASS_HASHES || '').split(',').map((h) => h.trim()).filter(Boolean);
export const authEnabled = Boolean(USER && PASS_HASH);

// Signing key derived from server-side secrets that already exist; rotating them logs everyone out.
const KEY = crypto.createHash('sha256').update(`ai7-session|${PASS_HASH}|${process.env.ELEVENLABS_API_KEY || ''}|${process.env.DAYTONA_API_KEY || ''}`).digest();

type Bucket = { fails: number[]; lockedUntil: number };
const byIp = new Map<string, Bucket>();
const byUser = new Map<string, Bucket>();

function bucket(map: Map<string, Bucket>, k: string) {
  let b = map.get(k);
  if (!b) map.set(k, (b = { fails: [], lockedUntil: 0 }));
  const now = Date.now();
  b.fails = b.fails.filter((t) => now - t < WINDOW_MS);
  return b;
}
function fail(map: Map<string, Bucket>, k: string, max: number) {
  const b = bucket(map, k);
  b.fails.push(Date.now());
  if (b.fails.length >= max) b.lockedUntil = Date.now() + LOCK_MS;
}
setInterval(() => {
  const now = Date.now();
  for (const m of [byIp, byUser]) for (const [k, b] of m) if (b.lockedUntil < now && b.fails.every((t) => now - t > WINDOW_MS)) m.delete(k);
}, 60_000).unref();

const clientIp = (req: Request) => String(req.headers['cf-connecting-ip'] || req.ip || req.socket.remoteAddress || 'unknown');
const safeEq = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkOne(pw: string, h: string) {
  const [, saltHex, hashHex] = h.split('$');
  if (!saltHex || !hashHex) return false;
  return safeEq(crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32), Buffer.from(hashHex, 'hex'));
}
function checkPassword(pw: string) {
  return [PASS_HASH, ...EXTRA_HASHES].some((h) => checkOne(pw, h));
}

function sign(payload: string) { return crypto.createHmac('sha256', KEY).update(payload).digest('base64url'); }
function makeToken(user: string) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(token?: string) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEq(Buffer.from(sig), Buffer.from(sign(payload)))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return d.exp > Date.now() && d.u === USER ? d : null;
  } catch { return null; }
}
function cookieOf(req: Request) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : undefined;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function page(error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · AI7 Tech Support</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap">
<style>
:root{--bg:#070f22;--card:#0f1d3d;--ink:#f3f6fc;--muted:#a3b2cf;--line:rgba(120,160,255,.22);--accent:#2f7bf6;--bad:#ef4444}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 85% -10%,rgba(47,123,246,.28),transparent 60%),linear-gradient(180deg,#0b1733,#070f22);color:var(--ink);font:15px/1.5 "Plus Jakarta Sans",system-ui,sans-serif;padding:16px;box-sizing:border-box}
form{background:linear-gradient(180deg,#13254b,#0f1d3d);border:1.5px solid var(--line);border-radius:18px;padding:30px;width:100%;max-width:360px;display:grid;gap:14px}
h1{margin:0;font-size:1.3rem}p{margin:0;color:var(--muted);font-size:.9rem}
label{display:grid;gap:6px;font-weight:600;font-size:.88rem}
input{font:inherit;color:inherit;background:#0a1630;border:1.5px solid var(--line);border-radius:12px;padding:11px 13px}
button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px;background:linear-gradient(180deg,#3b86ff,#2463e6);color:#fff;cursor:pointer;box-shadow:0 8px 22px rgba(47,123,246,.35)}
.err{color:var(--bad);font-size:.88rem}
</style></head><body>
<form method="post" action="/login" autocomplete="on">
<h1>Website Doctor</h1><p style="margin-top:-8px">by AI7 Tech Support</p>${PREFILL_PASS ? '<p>Demo login is prefilled. Just click Sign in.</p>' : ''}
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<label for="u">Username<input id="u" name="username" autocomplete="username" value="${esc(USER)}" required></label>
<label for="p">Password<input id="p" name="password" type="password" autocomplete="current-password" ${PREFILL_PASS ? `value="${esc(PREFILL_PASS)}"` : ''} required></label>
<button type="submit">Sign in</button>
<p>You stay signed in on this device for 30 days.</p>
</form></body></html>`;
}

export function installAuth(app: Express, express: { urlencoded: (o: { extended: boolean; limit: string }) => any }) {
  if (!authEnabled) {
    console.warn('[auth] APP_USER / APP_PASS_HASH not set: login gate disabled');
    return;
  }
  app.set('trust proxy', true);

  app.get('/login', (_req, res) => { res.set('Cache-Control', 'no-store').type('html').send(page()); });

  app.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), async (req: Request, res: Response) => {
    const ip = clientIp(req);
    const user = String(req.body?.username || '').slice(0, 64);
    const pass = String(req.body?.password || '').slice(0, 128);
    const ipB = bucket(byIp, ip), userB = bucket(byUser, user.toLowerCase());
    const now = Date.now();
    const lockedUntil = Math.max(ipB.lockedUntil, userB.lockedUntil);
    if (lockedUntil > now) {
      const mins = Math.ceil((lockedUntil - now) / 60000);
      res.set('Retry-After', String(Math.ceil((lockedUntil - now) / 1000))).status(429).type('html')
        .send(page(`Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`));
      return;
    }
    const ok = safeEq(Buffer.from(user), Buffer.from(USER)) && checkPassword(pass);
    if (!ok) {
      fail(byIp, ip, MAX_FAILS_PER_IP);
      fail(byUser, user.toLowerCase(), MAX_FAILS_PER_USER);
      await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
      res.status(401).type('html').send(page('Wrong username or password.'));
      return;
    }
    byIp.delete(ip);
    res.cookie(COOKIE, makeToken(USER), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: MAX_AGE_MS, path: '/',
    });
    res.redirect(303, '/');
  });

  app.post('/logout', (_req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.redirect(303, '/login'); });

  // Everything else needs a valid session.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (readToken(cookieOf(req))) return next();
    if (req.path.startsWith('/api/')) { res.status(401).json({ error: 'Sign in required' }); return; }
    res.redirect(302, '/login');
  });
}
