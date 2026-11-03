'use strict';
/**
 * Non-CRUD endpoints: authentication and the dashboard summary. Mirrors api/lib/endpoints.php.
 * Each handler returns [status, body].
 */
const bcrypt = require('bcryptjs');
const { HttpError, nowSec, mbCut, mbLen, sleep, isEmail, initialsOf, toInt, toNum } = require('./util');
const { passwordStamp } = require('./context');
const { hashPassword, checkNewPassword } = require('./resources');

const MAX_LOGIN_FAILURES = 8;   // per IP …
const MAX_ACCOUNT_FAILURES = 5; // … or per account (stops slow attacks spread across IPs) …
const LOGIN_WINDOW_MIN = 15;    // … within this many minutes
// A real bcrypt hash (cost 10) of a throw-away string; checked when the email is unknown.
const DUMMY_HASH = '$2y$10$.vGA1O9wmRjrwAVXD98HNOgsNpDczlqm3Jq7KnEd1rVAGv3Fykk1a';

/** bcrypt check that also accepts hashes made by PHP ($2y$). */
async function verifyPassword(pass, hash) {
  if (!hash || !/^\$2[aby]\$\d\d\$/.test(hash)) return false;
  try { return await bcrypt.compare(pass, hash); } catch (e) { return false; }
}

async function needsSetup(ctx) {
  return !(await ctx.col("SELECT 1 FROM users WHERE password_hash IS NOT NULL AND role = 'admin' AND active = 1 LIMIT 1"));
}

async function currentUserFresh(ctx, uid) {
  const u = await ctx.one('SELECT id, name, initials, email, role, title FROM users WHERE id = ?', [uid]);
  u.id = Number(u.id);
  return u;
}

async function signIn(ctx, uid) {
  await ctx.regenerateSession();
  ctx.session.data = { uid, born: nowSec(), seen: nowSec() };
  ctx.session.data.pw = passwordStamp(await ctx.col('SELECT password_hash FROM users WHERE id = ?', [uid]));
  ctx.forgetUser();
  await ctx.q('UPDATE users SET last_login_at = NOW() WHERE id = ?', [uid]);
  return currentUserFresh(ctx, uid);
}

async function handleAuth(ctx, action, method) {
  switch (action) {
    case 'status':
      return [200, { user: await ctx.currentUser(), needsSetup: await needsSetup(ctx) }];

    case 'setup': {
      // One-time creation of the first administrator.
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      if (!(await needsSetup(ctx))) throw new HttpError(403, 'Setup has already been completed.');
      const input = await ctx.body();
      const name = String(input.name ?? '').trim();
      const email = String(input.email ?? '').trim().toLowerCase();
      const pass = String(input.password ?? '');
      if (name === '' || mbLen(name) > 120 || !isEmail(email)) throw new HttpError(422, 'Enter your name and a valid email.');
      checkNewPassword(pass, email);
      const hash = await hashPassword(pass);

      let uid = await ctx.col('SELECT id FROM users WHERE email = ?', [email]);
      if (uid) {
        await ctx.q("UPDATE users SET name = ?, password_hash = ?, role = 'admin', active = 1 WHERE id = ?", [name, hash, uid]);
      } else {
        const r = await ctx.q("INSERT INTO users (name, initials, email, password_hash, role, title) VALUES (?,?,?,?, 'admin', 'Administrator')",
          [name, initialsOf(name), email, hash]);
        uid = r.insertId;
      }
      uid = Number(uid);
      const user = await signIn(ctx, uid);
      await ctx.logSecurity('setup', email, uid, 'First administrator created');
      await ctx.logActivity('success', 'CRM workspace set up', name + ' created the administrator account', 'users', uid);
      return [200, { user }];
    }

    case 'login': {
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      const ip = ctx.ip;
      const input = await ctx.body();
      const email = String(input.email ?? '').trim().toLowerCase();
      const counts = await ctx.one(
        `SELECT COALESCE(SUM(ip = ?), 0) AS byIp, COALESCE(SUM(email = ?), 0) AS byAccount FROM login_attempts
          WHERE attempted_at > NOW() - INTERVAL ${LOGIN_WINDOW_MIN} MINUTE AND (ip = ? OR email = ?)`, [ip, email, ip, email]);
      const byIp = toInt(counts.byIp);
      const byAccount = toInt(counts.byAccount);
      if (byIp >= MAX_LOGIN_FAILURES || byAccount >= MAX_ACCOUNT_FAILURES) {
        await ctx.logSecurity('login_locked', email, null, byAccount >= MAX_ACCOUNT_FAILURES ? 'Account temporarily locked' : 'IP temporarily locked');
        throw new HttpError(429, `Too many failed attempts. Try again in ${LOGIN_WINDOW_MIN} minutes.`);
      }
      const row = await ctx.one('SELECT id, password_hash FROM users WHERE email = ? AND active = 1', [email]);
      const pass = String(input.password ?? '').slice(0, 4096);
      // Unknown emails are checked against a dummy hash so timing doesn't reveal which accounts exist.
      const hash = row && row.password_hash ? row.password_hash : DUMMY_HASH;
      if (!(await verifyPassword(pass, hash)) || !row || !row.password_hash) {
        await ctx.q('INSERT INTO login_attempts (ip, email) VALUES (?, ?)', [ip, mbCut(email, 190)]);
        await ctx.logSecurity('login_failed', email, row ? Number(row.id) : null);
        await sleep(400);
        throw new HttpError(401, 'Incorrect email or password.');
      }
      if (bcrypt.getRounds(row.password_hash) < 10) {
        await ctx.q('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(pass), row.id]);
      }
      await ctx.q('DELETE FROM login_attempts WHERE ip = ? OR email = ? OR attempted_at < NOW() - INTERVAL 1 DAY', [ip, email]);
      const user = await signIn(ctx, Number(row.id));
      await ctx.logSecurity('login', email, Number(row.id));
      return [200, { user }];
    }

    case 'logout': {
      const u = await ctx.currentUser();
      if (u) await ctx.logSecurity('logout', u.email, u.id);
      await ctx.endSession();
      return [200, { ok: true }];
    }

    case 'password': {
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      const me = await ctx.requireUser();
      const input = await ctx.body();
      const current = String(input.current ?? '');
      const stored = await ctx.col('SELECT password_hash FROM users WHERE id = ?', [me.id]);
      if (!(await verifyPassword(current, stored))) {
        throw new HttpError(422, 'Your current password is incorrect.');
      }
      const next = String(input.new ?? '');
      checkNewPassword(next, String(me.email ?? ''));
      if (next === current) throw new HttpError(422, 'Choose a password different from your current one.');
      const hash = await hashPassword(next);
      await ctx.q('UPDATE users SET password_hash = ? WHERE id = ?', [hash, me.id]);
      // This session stays signed in; every other session for the account is signed out.
      const data = ctx.session.data;
      await ctx.regenerateSession();
      ctx.session.data = { ...data, pw: passwordStamp(hash) };
      await ctx.logSecurity('password_changed', me.email, me.id);
      return [200, { ok: true }];
    }

    default:
      throw new HttpError(404, 'Unknown auth action.');
  }
}

/** Aggregates for the Command Center dashboard. */
async function handleDashboard(ctx) {
  await ctx.requireUser();
  const leads = await ctx.one(`SELECT COUNT(*) total, SUM(status = 'New') new_count, SUM(status = 'Qualified') qualified,
                                      SUM(created_at >= NOW() - INTERVAL 7 DAY) this_week FROM leads`);
  const clients = await ctx.one("SELECT COUNT(*) active, COALESCE(SUM(mrr), 0) mrr FROM clients WHERE status = 'active'");
  const live = await ctx.one("SELECT COUNT(*) n FROM campaigns WHERE status = 'live'");
  const inv = await ctx.one(`SELECT COALESCE(SUM(CASE WHEN paid_date IS NULL THEN amount END), 0) outstanding,
                                    COALESCE(SUM(CASE WHEN paid_date IS NULL AND due_date < CURDATE() THEN amount END), 0) overdue,
                                    COALESCE(SUM(amount), 0) billed, COALESCE(SUM(CASE WHEN paid_date IS NOT NULL THEN amount END), 0) paid
                             FROM invoices`);
  const sources = await ctx.q('SELECT source, COUNT(*) n FROM leads GROUP BY source ORDER BY n DESC');
  const stages = await ctx.q("SELECT stage, COUNT(*) n, COALESCE(SUM(value), 0) value FROM deals WHERE stage <> 'lost' GROUP BY stage");
  const velocity = await ctx.one("SELECT ROUND(AVG(DATEDIFF(stage_changed_at, created_at))) days FROM deals WHERE stage = 'won'");
  const finance = await ctx.q('SELECT month, revenue, expenses FROM finance_monthly ORDER BY month DESC LIMIT 6');
  const activityCount = toInt(await ctx.col('SELECT COUNT(*) FROM activity'));

  const billed = toNum(inv.billed);
  return [200, {
    leads: {
      total: toInt(leads.total), new: toInt(leads.new_count),
      qualified: toInt(leads.qualified), thisWeek: toInt(leads.this_week),
    },
    clients: { active: toInt(clients.active), mrr: toNum(clients.mrr) },
    liveCampaigns: toInt(live.n),
    invoices: {
      outstanding: toNum(inv.outstanding), overdue: toNum(inv.overdue),
      collectedPct: billed > 0 ? Math.round(toNum(inv.paid) / billed * 100) : 0,
    },
    sources: sources.map((s) => ({ source: s.source, n: toInt(s.n) })),
    stages: stages.map((s) => ({ stage: s.stage, n: toInt(s.n), value: toNum(s.value) })),
    velocityDays: velocity.days !== null ? toInt(velocity.days) : null,
    revenue: finance.map((f) => ({ month: f.month, revenue: toNum(f.revenue), expenses: toNum(f.expenses) })).reverse(),
    activityCount,
  }];
}

module.exports = { handleAuth, handleDashboard };
