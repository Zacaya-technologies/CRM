'use strict';
/**
 * Creative Advs CRM — REST API entry point (served at /api/index.php, like the PHP version).
 *
 *   GET  api/index.php?r=auth/status          session + first-run status
 *   POST api/index.php?r=auth/setup           create first admin (only when none exists)
 *   POST api/index.php?r=auth/login           { email, password }
 *   POST api/index.php?r=auth/logout
 *   POST api/index.php?r=auth/password        { current, new }
 *   GET  api/index.php?r=dashboard            command-center aggregates
 *   GET|POST api/index.php?r=demo/status|load|remove   free demo data (admin)
 *   GET|POST|PUT|DELETE api/index.php?r=<resource>[&id=N]   see resources.js
 *
 * Every request must send the header "X-CRM: 1" (blocks cross-site form posts).
 * PUT/DELETE may also be sent as POST with "X-HTTP-Method-Override".
 */
const config = require('./config');
const { Context, isHttps } = require('./context');
const { ensureSchema } = require('./schema');
const { handleAuth, handleDashboard } = require('./endpoints');
const { handleDemo } = require('./demo');
const { handleResource } = require('./crud');
const { HttpError, isoDatetime, ymdHis } = require('./util');

/** Headers sent with every API response: JSON is never cached, framed or sniffed. */
function securityHeaders(req, res) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  if (isHttps(req)) res.set('Strict-Transport-Security', 'max-age=31536000');
}

/**
 * Reject writes coming from another site. The X-CRM header already forces a CORS
 * pre-flight; this is defence in depth for browsers that send an Origin header.
 */
function checkOrigin(req, method) {
  const origin = req.headers.origin;
  if (method === 'GET' || !origin) return;
  let host = null;
  try { host = new URL(origin).hostname.toLowerCase(); } catch (e) { /* invalid → blocked */ }
  const strip = (h) => String(h || '').split(',')[0].trim().replace(/:\d+$/, '').toLowerCase();
  const allowed = [strip(req.headers.host), strip(req.headers['x-forwarded-host'])].filter(Boolean);
  if (!host || !allowed.includes(host)) throw new HttpError(403, 'Cross-site request blocked.');
}

const DB_CONNECT_CODES = new Set(['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ECONNREFUSED', 'ENOTFOUND',
  'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ER_HOST_NOT_PRIVILEGED', 'ER_NOT_SUPPORTED_AUTH_MODE', 'CRM_DB_SETTINGS_MISSING']);

/** Which setting to fix, from the MySQL error. Names settings only, never their values. */
function connectHint(e) {
  const c = config.db;
  const missing = [['DB_NAME', c.name], ['DB_USER', c.user], ['DB_PASSWORD', c.password]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set. Add ${missing.length > 1 ? 'them' : 'it'} in the app's environment variables and redeploy. (${e.code})`;
  switch (e.code) {
    case 'ER_ACCESS_DENIED_ERROR':
      return `MySQL rejected user "${c.user}" or its password. Check DB_USER (the full name with the u…_ prefix) and DB_PASSWORD. (${e.code})`;
    case 'ER_DBACCESS_DENIED_ERROR':
      return `user "${c.user}" has no access to database "${c.name}". In hPanel, make sure this user belongs to this database. (${e.code})`;
    case 'ER_BAD_DB_ERROR':
      return `database "${c.name}" does not exist. Check DB_NAME (the full name with the u…_ prefix). (${e.code})`;
    case 'ER_HOST_NOT_PRIVILEGED':
      return `MySQL does not accept connections from this app's server. Use the MySQL host shown in hPanel → Databases, or allow this server under Remote MySQL. (${e.code})`;
    default:
      return `no MySQL server answered at DB_HOST "${c.host}". Use the MySQL host shown in hPanel → Databases. (${e.code || e.errno})`;
  }
}

/** Error → [status, body]. */
function errorResponse(e) {
  if (e instanceof HttpError) return [e.status, { error: e.message, details: e.details }];
  const debug = config.debug;
  if (e && (e.sqlState || e.code || e.errno) && !(e instanceof TypeError) && !(e instanceof ReferenceError)) {
    console.error('CRM DB error:', e.code || '', e.message);
    if (e.sqlState === '23000') {
      const msg = /Duplicate/i.test(e.message)
        ? 'That value is already used by another record (e.g. email or number).'
        : 'This record is linked to other records (or references one that does not exist), so it cannot be saved or deleted.';
      return [409, { error: msg, details: debug ? e.message : null }];
    }
    let msg = 'Database error.';
    if (DB_CONNECT_CODES.has(e.code) || [1044, 1045, 1049, 2002, 2005, 2006].includes(e.errno)) {
      msg = 'Cannot connect to the database: ' + connectHint(e);
    } else if (e.code === 'ER_NO_SUCH_TABLE') {
      msg = 'Database tables are missing. Restart the app so it can create them.';
    }
    return [500, { error: msg, details: debug ? e.message : null }];
  }
  console.error('CRM error:', e);
  return [500, { error: 'Server error.', details: debug && e ? e.message : null }];
}

async function route(ctx, req) {
  if (req.headers['x-crm'] !== '1') throw new HttpError(400, 'Missing X-CRM request header.');

  let method = req.method;
  if (method === 'POST' && req.headers['x-http-method-override']) {
    method = String(req.headers['x-http-method-override']).toUpperCase();
  }
  checkOrigin(req, method);

  await ensureSchema();
  await ctx.startSession();

  const q = {};
  for (const [k, v] of Object.entries(req.query)) q[k] = Array.isArray(v) ? v[v.length - 1] : v; // last value wins, like PHP
  const r = String(q.r ?? '').replace(/^\/+|\/+$/g, '');
  const id = /^\d+$/.test(String(q.id ?? '')) ? parseInt(q.id, 10) : null;

  if (r === 'health') {
    await ctx.q('SELECT 1');
    // Version details only while debugging — they help attackers more than admins.
    return [200, { ok: true, time: isoDatetime(ymdHis()), ...(config.debug ? { node: process.version } : {}) }];
  }
  if (r.startsWith('auth/')) return handleAuth(ctx, r.slice(5), method);

  // Maintenance mode: sign-in still works, but only admins can use the CRM.
  if (config.maintenance) {
    const u = await ctx.currentUser();
    if (!u || u.role !== 'admin') throw new HttpError(503, 'The CRM is down for maintenance. Please try again shortly.', { maintenance: true });
  }
  if (r.startsWith('demo/')) return handleDemo(ctx, r.slice(5), method);
  if (r === 'dashboard') return handleDashboard(ctx);
  if (!/^[a-z_]+$/.test(r)) throw new HttpError(404, 'Not found.');
  return handleResource(ctx, r, method, id, q);
}

async function handleApi(req, res) {
  securityHeaders(req, res);
  const ctx = new Context(req, res);
  let status;
  let body;
  try {
    [status, body] = await route(ctx, req);
  } catch (e) {
    if (ctx.conn) await ctx.rollback(); // a failed transaction must never leak into the pool
    [status, body] = errorResponse(e);
  }
  try {
    if (ctx.conn || ctx.session.id || ctx.session.ended) await ctx.saveSession();
  } catch (e) {
    console.error('session save failed:', e.message);
  } finally {
    ctx.release();
  }
  res.status(status).type('application/json; charset=utf-8').send(JSON.stringify(body));
}

module.exports = { handleApi };
