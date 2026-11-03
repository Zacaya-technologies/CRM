'use strict';
/**
 * Server settings. Set them as environment variables (Hostinger hPanel → your Node.js app →
 * Environment variables) or in a ".env" file next to server.js. See .env.example.
 */
const fs = require('fs');
const path = require('path');

function loadDotEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue; // real environment variables win
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

const env = process.env;
const bool = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const int = (v, d) => (/^\d+$/.test(String(v || '').trim()) ? parseInt(v, 10) : d);

const config = {
  port: int(env.PORT, 3000),
  db: {
    host: env.DB_HOST || 'localhost',
    port: int(env.DB_PORT, 3306),
    name: env.DB_NAME || env.DB_DATABASE || '',
    user: env.DB_USER || env.DB_USERNAME || '',
    password: env.DB_PASSWORD || '',
  },
  // Session cookie name; idle timeout (12 hours) and absolute maximum age (7 days), in seconds.
  sessionName: env.SESSION_NAME || 'omnicrm_sid',
  sessionLifetime: int(env.SESSION_LIFETIME, 43200),
  sessionAbsolute: int(env.SESSION_ABSOLUTE, 604800),
  // true shows the maintenance page to everyone except signed-in admins.
  maintenance: bool(env.MAINTENANCE),
  // true only while debugging: shows SQL errors in API responses.
  debug: bool(env.DEBUG),
  // Timezone used for "today", overdue checks and timestamps.
  timezone: env.TIMEZONE || 'Asia/Kolkata',
  // Redirect http:// to https:// (turn on once SSL is active).
  forceHttps: bool(env.FORCE_HTTPS),
  // Number of reverse proxies in front of the app (Hostinger: 1), so sign-in throttling sees real IPs.
  trustProxy: int(env.TRUST_PROXY, 1),
};

// All dates are computed in the CRM's timezone, like PHP's date_default_timezone_set().
process.env.TZ = config.timezone;

module.exports = config;
