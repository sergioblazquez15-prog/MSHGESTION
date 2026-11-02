const crypto = require('crypto');
const { db } = require('./db');

const SESSION_DAYS = 30;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(String(pw), salt, 64);
    const real = Buffer.from(hash, 'hex');
    return real.length === test.length && crypto.timingSafeEqual(real, test);
  } catch (e) {
    return false;
  }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sessionMiddleware(req, res, next) {
  req.user = null;
  const token = parseCookies(req).sid;
  if (token) {
    const row = db.prepare(
      'SELECT u.id,u.email,u.name,u.role,u.client_id,u.active,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?'
    ).get(token);
    if (row && row.active && row.expires > Date.now()) req.user = row;
    else if (row) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  }
  next();
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)').run(token, userId, expires);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}
function endSession(req, res) {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
  attempts.set(key, list);
  return list.length >= 8;
}
function noteAttempt(key) {
  const list = attempts.get(key) || [];
  list.push(Date.now());
  attempts.set(key, list);
}

const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Necesitas iniciar sesión' });
const requireAdmin = (req, res, next) =>
  req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Solo para administradores' });

module.exports = {
  hashPassword, verifyPassword, sessionMiddleware, startSession, endSession,
  tooManyAttempts, noteAttempt, requireUser, requireAdmin
};
