'use strict';
/** MySQL connection pool. Every API request borrows one connection (so transactions work like PDO). */
const fs = require('fs');
const mysql = require('mysql2/promise');
const config = require('./config');
const { tzOffset } = require('./util');

// Where MySQL usually listens for local connections on Linux hosting.
const SOCKETS = ['/var/lib/mysql/mysql.sock', '/run/mysqld/mysqld.sock', '/var/run/mysqld/mysqld.sock', '/tmp/mysql.sock'];
// Errors that mean "nothing answered there" (as opposed to a wrong user, password or database name).
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOENT', 'EACCES', 'EAI_AGAIN', 'ECONNRESET']);

let pool = null;
let resolving = null;

/**
 * Ways to reach the server. Node may resolve "localhost" to IPv6 (::1) while MySQL listens on
 * 127.0.0.1 or a socket only (PHP uses the socket), so for a local host every option is tried.
 */
function candidates() {
  const c = config.db;
  if (c.socket) return [{ socketPath: c.socket }];
  if (!['localhost', '127.0.0.1', '::1'].includes(c.host.toLowerCase())) return [{ host: c.host, port: c.port }];
  return [
    { host: '127.0.0.1', port: c.port },
    ...SOCKETS.filter((s) => { try { return fs.statSync(s).isSocket(); } catch (e) { return false; } }).map((s) => ({ socketPath: s })),
    { host: 'localhost', port: c.port },
    { host: '::1', port: c.port },
  ];
}

/** First option where a MySQL server answers. A wrong password still counts: the server was reached. */
async function findServer() {
  const c = config.db;
  if (!c.name || !c.user) throw Object.assign(new Error('DB_NAME / DB_USER are not set.'), { code: 'CRM_DB_SETTINGS_MISSING' });
  let firstError = null;
  for (const target of candidates()) {
    try {
      const conn = await mysql.createConnection({ ...target, user: c.user, password: c.password, database: c.name, connectTimeout: 5000 });
      await conn.end();
      return target;
    } catch (e) {
      if (!UNREACHABLE.has(e.code)) {
        e.dbTarget = target;
        throw e; // reached MySQL: the user, password or database name is wrong
      }
      if (!firstError) firstError = e;
    }
  }
  throw firstError;
}

async function getPool() {
  if (pool) return pool;
  if (!resolving) {
    resolving = findServer().then((target) => {
      const c = config.db;
      console.log(`CRM: connected to MySQL at ${target.socketPath || target.host + ':' + target.port}.`);
      pool = mysql.createPool({
        ...target,
        database: c.name,
        user: c.user,
        password: c.password,
        charset: 'utf8mb4',
        dateStrings: true,        // DATE / DATETIME come back as plain "Y-m-d H:i:s" strings, like PDO
        stringifyObjects: true,   // never expand an object value into SQL
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: 10000,
      });
      return pool;
    }).finally(() => { resolving = null; });
  }
  return resolving;
}

/** A pooled connection with MySQL's NOW()/CURDATE() kept in step with the CRM timezone. */
async function connect() {
  const conn = await (await getPool()).getConnection();
  const off = tzOffset();
  if (conn.connection.__crmTz !== off) {
    await conn.query(`SET time_zone = '${off}'`);
    conn.connection.__crmTz = off;
  }
  return conn;
}

/** Runs fn(conn) on a short-lived connection (start-up tasks, clean-up). */
async function withConnection(fn) {
  const conn = await connect();
  try { return await fn(conn); } finally { conn.release(); }
}

module.exports = { getPool, connect, withConnection };
