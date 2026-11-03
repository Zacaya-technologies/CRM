'use strict';
/** MySQL connection pool. Every API request borrows one connection (so transactions work like PDO). */
const mysql = require('mysql2/promise');
const config = require('./config');
const { tzOffset } = require('./util');

let pool = null;

function getPool() {
  if (!pool) {
    const c = config.db;
    pool = mysql.createPool({
      host: c.host,
      port: c.port,
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
  }
  return pool;
}

/** A pooled connection with MySQL's NOW()/CURDATE() kept in step with the CRM timezone. */
async function connect() {
  const conn = await getPool().getConnection();
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
