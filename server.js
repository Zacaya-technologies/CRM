'use strict';
/**
 * Creative Advs CRM — Node.js server.
 * Serves the pages (*.html, styles.css, assets/) and the REST API at /api/index.php.
 *
 *   npm install
 *   npm start            → http://localhost:3000 (or $PORT)
 *
 * Settings come from environment variables or a .env file — see .env.example.
 */
const config = require('./server/config'); // first: sets the timezone
const path = require('path');
const express = require('express');
const { handleApi } = require('./server/api');
const { ensureSchema } = require('./server/schema');
const { withConnection } = require('./server/db');
const { isHttps } = require('./server/context');

const ROOT = __dirname;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('query parser', 'simple');

// Pages may only load code and data from this site (plus Google Fonts).
// 'unsafe-inline' is needed because each page keeps its script inline.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
  + "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  });
  if (isHttps(req)) res.set('Strict-Transport-Security', 'max-age=31536000');
  else if (config.forceHttps && req.headers.host) return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  next();
});

app.all(['/api', '/api/', '/api/index.php'], (req, res, next) => handleApi(req, res).catch(next));

// Only the pages, styles.css and assets/ are public. Server code, database/, .env and node_modules are not.
const PUBLIC = /^\/(?:[\w-]+\.html|styles\.css|assets\/[\w.-]+\.(?:css|js|svg|png|jpe?g|gif|webp|ico|woff2?))$/;

function sendPage(res, file, status = 200) {
  res.status(status).set({ 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-cache' });
  res.sendFile(path.join(ROOT, file), (err) => {
    if (err && !res.headersSent) res.status(500).type('text/plain').send('Server error.');
  });
}

// Browsers ask for /favicon.ico on their own.
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(ROOT, 'assets', 'favicon.ico'), { maxAge: '30d' }));

app.get('*', (req, res, next) => {
  const p = req.path === '/' ? '/index.html' : req.path;
  if (!PUBLIC.test(p)) return next();
  const file = path.join(ROOT, p);
  if (p.endsWith('.html')) {
    res.set({ 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-cache' });
    return res.sendFile(file, (err) => { if (err && !res.headersSent) next(); });
  }
  // CSS/JS/SVG are linked with "?v=N": bump N in the pages whenever you change them.
  res.sendFile(file, { maxAge: '30d' }, (err) => { if (err && !res.headersSent) next(); });
});

// Branded error pages.
app.use((req, res) => sendPage(res, '404.html', 404));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('CRM error:', err);
  if (res.headersSent) return;
  sendPage(res, '500.html', 500);
});

// Housekeeping: drop expired sessions and old failed-login records every hour.
async function cleanUp() {
  try {
    await withConnection(async (conn) => {
      await conn.query('DELETE FROM sessions WHERE seen < ?', [Math.floor(Date.now() / 1000) - config.sessionLifetime]);
      await conn.query('DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL 1 DAY');
    });
  } catch (e) { /* database not ready yet */ }
}

app.listen(config.port, () => {
  console.log(`Creative Advs CRM running on port ${config.port} (timezone ${config.timezone}).`);
  if (!config.db.name || !config.db.user) {
    console.warn('CRM: DB_NAME / DB_USER are not set. Add them as environment variables or in a .env file (see .env.example).');
  }
  ensureSchema()
    .then(cleanUp)
    .catch((e) => console.error('CRM: database not reachable yet —', e.code || e.message, '(will retry on the next request)'));
  setInterval(cleanUp, 3600 * 1000).unref();
});
