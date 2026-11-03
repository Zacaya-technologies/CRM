'use strict';
/**
 * Per-request context: database connection, JSON body, session, signed-in user and audit logging.
 * Mirrors api/lib/bootstrap.php.
 */
const crypto = require('crypto');
const config = require('./config');
const { connect } = require('./db');
const { HttpError, nowSec, mbCut } = require('./util');

const ROLE_RANK = { viewer: 0, member: 1, manager: 2, admin: 3 };
const MAX_BODY_BYTES = 1048576; // 1 MB of JSON is far more than any form sends

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Short fingerprint of a password hash: changing the password signs out every other session. */
const passwordStamp = (hash) => sha256(hash === null || hash === undefined ? '' : hash).slice(0, 16);

function isHttps(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

class Context {
  constructor(req, res) {
    this.req = req;
    this.res = res;
    this.conn = null;
    this.session = { id: null, token: null, data: {}, changedId: false, ended: false };
    this._user = undefined;
    this._body = undefined;
  }

  /* ---------------- Database ---------------- */

  async db() {
    if (!this.conn) this.conn = await connect();
    return this.conn;
  }

  /** Rows of a query (or the result header for INSERT/UPDATE/DELETE). */
  async q(sql, args = []) {
    const [rows] = await (await this.db()).query(sql, args);
    return rows;
  }

  async one(sql, args = []) {
    const rows = await this.q(sql, args);
    return rows[0] || null;
  }

  /** First column of the first row (PDO fetchColumn), or null. */
  async col(sql, args = []) {
    const [rows] = await (await this.db()).query({ sql, rowsAsArray: true }, args);
    return rows.length ? rows[0][0] : null;
  }

  /** First column of every row. */
  async column(sql, args = []) {
    const [rows] = await (await this.db()).query({ sql, rowsAsArray: true }, args);
    return rows.map((r) => r[0]);
  }

  async begin() { await (await this.db()).beginTransaction(); }
  async commit() { await this.conn.commit(); }
  async rollback() { try { await this.conn.rollback(); } catch (e) { /* connection already gone */ } }

  release() {
    if (this.conn) { this.conn.release(); this.conn = null; }
  }

  /* ---------------- Request ---------------- */

  get ip() {
    return String(this.req.ip || this.req.socket.remoteAddress || '0.0.0.0').replace(/^::ffff:/, '').slice(0, 45);
  }

  get userAgent() {
    return String(this.req.headers['user-agent'] || '');
  }

  /** Parsed JSON body (an object), max 1 MB. */
  async body() {
    if (this._body === undefined) {
      const chunks = [];
      let size = 0;
      for await (const chunk of this.req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let data;
      if (raw === '') data = {};
      else {
        try { data = JSON.parse(raw); } catch (e) { data = null; }
      }
      if (data === null || typeof data !== 'object') throw new HttpError(400, 'Request body must be a JSON object.');
      this._body = data;
    }
    return this._body;
  }

  /* ---------------- Sessions (stored in the "sessions" table) ---------------- */

  async startSession() {
    const token = readCookie(this.req, config.sessionName);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const row = await this.one('SELECT data FROM sessions WHERE id = ?', [sha256(token)]);
      if (row) {
        let data = {};
        try { data = JSON.parse(row.data) || {}; } catch (e) { /* corrupt → empty */ }
        this.session = { id: sha256(token), token, data, changedId: false, ended: false };
      } else {
        this.session.ended = true; // stale cookie: clear it
      }
    }
    // Expire idle sessions, and every session after an absolute maximum age.
    const now = nowSec();
    const s = this.session.data;
    if ((s.seen && now - s.seen > config.sessionLifetime) || (s.born && now - s.born > config.sessionAbsolute)) {
      this.session.data = {};
    }
    this.session.data.seen = now;
  }

  /** New session id (prevents session fixation); the old one stops working. */
  async regenerateSession() {
    if (this.session.id) await this.q('DELETE FROM sessions WHERE id = ?', [this.session.id]);
    const token = crypto.randomBytes(32).toString('hex');
    this.session.id = sha256(token);
    this.session.token = token;
    this.session.changedId = true;
    this.session.ended = false;
  }

  async endSession() {
    if (this.session.id) await this.q('DELETE FROM sessions WHERE id = ?', [this.session.id]);
    this.session = { id: null, token: null, data: {}, changedId: false, ended: true };
  }

  /** Writes the session and sets / clears the cookie. Called once, before the response is sent. */
  async saveSession() {
    const s = this.session;
    const cookie = (value, extra = '') => `${config.sessionName}=${value}; Path=/; HttpOnly; SameSite=Lax${isHttps(this.req) ? '; Secure' : ''}${extra}`;
    if (s.data.uid) {
      if (!s.id) await this.regenerateSession();
      await this.q('REPLACE INTO sessions (id, uid, data, seen) VALUES (?, ?, ?, ?)', [s.id, s.data.uid, JSON.stringify(s.data), nowSec()]);
      if (s.changedId) this.res.append('Set-Cookie', cookie(s.token));
    } else {
      if (s.id) await this.q('DELETE FROM sessions WHERE id = ?', [s.id]);
      if (s.id || s.ended) this.res.append('Set-Cookie', cookie('', '; Max-Age=0'));
    }
  }

  /* ---------------- Current user ---------------- */

  /** The logged-in user row (without password hash), or null. */
  async currentUser() {
    if (this._user === undefined) {
      this._user = null;
      const uid = this.session.data.uid;
      if (uid) {
        const u = await this.one('SELECT id, name, initials, email, role, title, password_hash FROM users WHERE id = ? AND active = 1', [uid]);
        // Password changed (or removed) since this session signed in → treat as signed out.
        if (u && !crypto.timingSafeEqual(Buffer.from(sha256(this.session.data.pw || '')), Buffer.from(sha256(passwordStamp(u.password_hash))))) {
          this.session.data = {};
        } else if (u) {
          delete u.password_hash;
          u.id = Number(u.id);
          this._user = u;
        } else {
          this.session.data = {};
        }
      }
    }
    return this._user;
  }

  forgetUser() { this._user = undefined; }

  async requireUser() {
    const u = await this.currentUser();
    if (!u) throw new HttpError(401, 'Please sign in.');
    return u;
  }

  async requireRole(min) {
    const u = await this.requireUser();
    if (ROLE_RANK[u.role] < ROLE_RANK[min]) throw new HttpError(403, 'Your role does not allow this action.');
    return u;
  }

  /* ---------------- Logs ---------------- */

  /** Append an entry to the activity / audit feed. Never breaks the request. */
  async logActivity(kind, title, detail = null, entity = null, entityId = null) {
    try {
      const u = await this.currentUser();
      await this.q('INSERT INTO activity (user_id, kind, title, detail, entity, entity_id) VALUES (?,?,?,?,?,?)',
        [u ? u.id : null, kind, mbCut(title, 200), detail ? mbCut(detail, 255) : null, entity, entityId]);
    } catch (e) {
      console.error('activity log failed:', e.message);
    }
  }

  /** Record a sign-in / account security event for the admin Security Log. Never breaks the request. */
  async logSecurity(event, email = null, userId = null, detail = null) {
    try {
      await this.q('INSERT INTO security_log (event, user_id, email, ip, user_agent, detail) VALUES (?,?,?,?,?,?)',
        [event, userId, email ? mbCut(email, 190) : null, this.ip, mbCut(this.userAgent, 255), detail ? mbCut(detail, 255) : null]);
    } catch (e) {
      console.error('security log failed:', e.message);
    }
  }
}

module.exports = { Context, ROLE_RANK, passwordStamp, isHttps };
