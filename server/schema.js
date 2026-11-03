'use strict';
/**
 * Creates the database tables automatically, so no phpMyAdmin import is needed.
 * Tables come from database/schema.sql (everything above the SEED DATA section).
 * Existing tables and data are never changed or dropped.
 */
const fs = require('fs');
const path = require('path');
const { withConnection } = require('./db');

const SCHEMA_FILE = path.join(__dirname, '..', 'database', 'schema.sql');

// Tables only the Node.js server uses.
const EXTRA_TABLES = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id    CHAR(64)     NOT NULL PRIMARY KEY,
    uid   INT UNSIGNED NULL,
    data  TEXT         NOT NULL,
    seen  INT UNSIGNED NOT NULL,
    INDEX idx_sessions_seen (seen)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/** CREATE TABLE and ALTER TABLE statements from schema.sql, keyed by table name. */
function readSchema() {
  let sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const seed = sql.indexOf('SEED DATA');
  if (seed > 0) sql = sql.slice(0, sql.lastIndexOf('\n', seed));
  sql = sql.split(/\r?\n/).map((l) => l.replace(/\s--\s.*$/, '').replace(/^\s*--.*$/, '')).join('\n');
  const creates = [];
  const alters = [];
  for (const raw of sql.split(/;\s*(?:\n|$)/)) {
    const st = raw.trim();
    let m;
    if ((m = st.match(/^CREATE TABLE\s+`?(\w+)`?/i))) creates.push({ table: m[1], sql: st });
    else if ((m = st.match(/^ALTER TABLE\s+`?(\w+)`?/i))) alters.push({ table: m[1], sql: st });
  }
  return { creates, alters };
}

let ready = null;

/** Safe to call on every request: runs once, and retries later if the database was unreachable. */
function ensureSchema() {
  if (!ready) {
    ready = createMissingTables().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function createMissingTables() {
  const { creates, alters } = readSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query('SHOW TABLES');
    const existing = new Set(rows.map((r) => String(Object.values(r)[0]).toLowerCase()));
    const created = [];
    for (const c of creates) {
      if (existing.has(c.table.toLowerCase())) continue;
      await conn.query(c.sql);
      created.push(c.table);
    }
    // Speed indexes, only for tables created just now (older ones got them from schema.sql or the migration).
    for (const a of alters) {
      if (created.includes(a.table)) await conn.query(a.sql);
    }
    for (const sql of EXTRA_TABLES) await conn.query(sql);
    if (created.length) console.log(`CRM: created ${created.length} database tables.`);
    return created;
  });
}

module.exports = { ensureSchema };
