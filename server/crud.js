'use strict';
/**
 * Generic, resource-driven CRUD engine. Mirrors api/lib/crud.php.
 *   GET    ?r=leads              list (filters: any writable field, q=search, limit=N)
 *   GET    ?r=leads&id=5         one record
 *   POST   ?r=leads              create
 *   PUT    ?r=leads&id=5         update (partial — only sent fields change)
 *   DELETE ?r=leads&id=5         delete
 */
const { RESOURCES } = require('./resources');
const { HttpError, isoDatetime, toInt, toNum, mbLen, ymdHis, parseLocal } = require('./util');

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const entries = (res) => Object.entries(res.fields);

function resource(name) {
  if (!has(RESOURCES, name)) throw new HttpError(404, `Unknown resource '${name}'.`);
  return RESOURCES[name];
}

function selectSql(res) {
  const parts = ['t.id AS `id`'];
  for (const [key, f] of entries(res)) {
    if (f.hidden || (f.expr === undefined && f.col === undefined)) continue;
    parts.push(`${f.expr ?? 't.' + f.col} AS \`${key}\``);
  }
  parts.push('t.created_at AS `createdAt`');
  return 'SELECT ' + parts.join(', ') + ' FROM ' + (res.from ?? res.table + ' t');
}

function castRow(res, row) {
  row.id = toInt(row.id);
  row.createdAt = isoDatetime(row.createdAt);
  for (const [key, f] of entries(res)) {
    if (!has(row, key)) continue;
    const v = row[key];
    if (v === null) {
      if (f.type === 'csv') row[key] = [];
      continue;
    }
    switch (f.type || 'str') {
      case 'int': row[key] = toInt(v); break;
      case 'num': row[key] = toNum(v); break;
      case 'bool': row[key] = Boolean(toInt(v)); break;
      case 'datetime': row[key] = isoDatetime(v); break;
      case 'csv': row[key] = v === '' ? [] : String(v).split(','); break;
    }
  }
  return row;
}

const INT_RE = /^\s*[+-]?(0|[1-9]\d*)\s*$/;
const NUM_RE = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;

function validDate(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Any date/time the browser may send → "Y-m-d H:i:s" in the CRM timezone, or null. */
function toDatetime(v) {
  const s = String(v).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(s)) d = parseLocal(s); // no offset → local time
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) d = new Date(s.replace(' ', 'T').replace(/\s+/, ''));
  else d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : ymdHis(d);
}

/** Validate input against the field map and return {column: value}. */
function inputToColumns(res, input, create) {
  const cols = {};
  const errors = {};
  for (const [key, f] of entries(res)) {
    const writable = f.col !== undefined && !f.ro && !f.virtual;
    if (!has(input, key)) {
      if (create && f.required) errors[key] = 'is required';
      continue;
    }
    if (!writable) continue;
    let v = input[key];
    const type = f.type || 'str';
    const empty = v === null || (typeof v === 'string' && v.trim() === '');

    if (empty) {
      if (f.required) errors[key] = 'is required';
      else if (f.nullable) cols[f.col] = null;
      else if (type === 'str' && !f.enum) cols[f.col] = '';
      continue; // non-nullable typed field left empty → keep default / current value
    }
    if (typeof v === 'object') {
      errors[key] = 'must be a single value';
      continue;
    }
    if (f.enum && !f.enum.includes(v)) {
      errors[key] = 'must be one of: ' + f.enum.join(', ');
      continue;
    }

    switch (type) {
      case 'int':
        if (typeof v === 'boolean') v = v ? 1 : 0;
        if (typeof v === 'number' ? !Number.isInteger(v) : !INT_RE.test(v)) { errors[key] = 'must be a whole number'; continue; }
        v = parseInt(v, 10);
        break;
      case 'num':
        if (typeof v === 'number' ? !Number.isFinite(v) : !(typeof v === 'string' && NUM_RE.test(v))) { errors[key] = 'must be a number'; continue; }
        v = parseFloat(v);
        break;
      case 'bool':
        v = (v === true || v === 1 || /^(1|true|on|yes)$/i.test(String(v).trim())) ? 1 : 0;
        break;
      case 'date':
        v = String(v).slice(0, 10);
        if (!validDate(v)) { errors[key] = 'must be a date (YYYY-MM-DD)'; continue; }
        break;
      case 'datetime':
        v = toDatetime(v);
        if (v === null) { errors[key] = 'must be a date and time'; continue; }
        break;
      default:
        v = (typeof v === 'boolean' ? (v ? '1' : '') : String(v)).trim();
        if (mbLen(v) > (f.max ?? 255)) { errors[key] = 'is too long'; continue; }
    }
    cols[f.col] = v;
  }
  // Validate virtual enums too (e.g. invoice payment method).
  for (const [key, f] of entries(res)) {
    if (f.virtual && f.enum && input[key] !== undefined && input[key] !== null && input[key] !== '' && !f.enum.includes(input[key])) {
      errors[key] = 'must be one of: ' + f.enum.join(', ');
    }
  }
  const keys = Object.keys(errors);
  if (keys.length) {
    throw new HttpError(422, 'Please check: ' + keys.map((k) => `${k} ${errors[k]}`).join('; ') + '.', errors);
  }
  return cols;
}

async function fetchOne(ctx, res, id) {
  const row = await ctx.one(selectSql(res) + ' WHERE t.id = ?', [id]);
  return row ? castRow(res, row) : null;
}

async function fetchRaw(ctx, res, id) {
  return ctx.one(`SELECT * FROM ${res.table} WHERE id = ?`, [id]);
}

async function crudList(ctx, res, query) {
  const where = [];
  const args = [];
  for (const [key, f] of entries(res)) {
    if (f.col !== undefined && typeof query[key] === 'string' && query[key] !== '') {
      where.push(`t.${f.col} = ?`);
      args.push(query[key]);
    }
  }
  if (typeof query.q === 'string' && query.q !== '') {
    const like = [];
    for (const [, f] of entries(res)) {
      if (f.col !== undefined && (f.type || 'str') === 'str' && !f.enum) {
        like.push(`t.${f.col} LIKE ?`);
        args.push('%' + query.q + '%');
      }
    }
    if (like.length) where.push('(' + like.join(' OR ') + ')');
  }
  let sql = selectSql(res) + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY ' + res.order;
  const asked = typeof query.limit === 'string' ? toInt(query.limit) : (res.limit ?? 1000);
  const limit = Math.min(1000, Math.max(1, asked));
  sql += ` LIMIT ${limit}`;
  const rows = await ctx.q(sql, args);
  return rows.map((r) => castRow(res, r));
}

async function crudWrite(ctx, name, res, id) {
  await ctx.requireRole(res.write ?? 'member');
  const input = await ctx.body();
  let old = null;
  if (id) {
    old = await fetchRaw(ctx, res, id);
    if (!old) throw new HttpError(404, res.singular + ' not found.');
  }
  const op = id ? 'update' : 'create';
  const cols = inputToColumns(res, input, !id);

  await ctx.begin();
  let row;
  try {
    if (res.before) await res.before(ctx, cols, old, input, op);
    const names = Object.keys(cols);
    if (id) {
      if (names.length) {
        await ctx.q(`UPDATE ${res.table} SET ${names.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, [...names.map((c) => cols[c]), id]);
      }
    } else {
      const sql = names.length
        ? `INSERT INTO ${res.table} (${names.map((c) => `\`${c}\``).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
        : `INSERT INTO ${res.table} () VALUES ()`;
      const r = await ctx.q(sql, names.map((c) => cols[c]));
      id = Number(r.insertId);
    }

    const override = res.after ? await res.after(ctx, id, input, old, op, await fetchOne(ctx, res, id)) : null;
    row = await fetchOne(ctx, res, id);

    if (res.log !== false) {
      if (override) {
        await ctx.logActivity(override[0], override[1], override[2] ?? null, name, id);
      } else if (op === 'create' || name !== 'onboarding_items') {
        const label = String(row[res.label] ?? '');
        await ctx.logActivity(op === 'create' ? 'primary' : 'muted', res.singular + (op === 'create' ? ' added' : ' updated'), label, name, id);
      }
    }
    await ctx.commit();
  } catch (e) {
    await ctx.rollback();
    throw e;
  }
  return row;
}

async function crudDelete(ctx, name, res, id) {
  const me = await ctx.requireRole(res.delete ?? 'manager');
  const row = await fetchOne(ctx, res, id);
  if (!row) throw new HttpError(404, res.singular + ' not found.');
  if (name === 'users' && id === me.id) throw new HttpError(422, 'You cannot delete your own account.');
  await ctx.q(`DELETE FROM ${res.table} WHERE id = ?`, [id]);
  if (res.log !== false) {
    await ctx.logActivity('danger', res.singular + ' deleted', String(row[res.label] ?? ''), name, id);
  }
  return { ok: true };
}

/** Returns [status, body]. */
async function handleResource(ctx, name, method, id, query) {
  const res = resource(name);
  switch (method) {
    case 'GET': {
      await ctx.requireRole(res.read ?? 'viewer');
      if (id) {
        const row = await fetchOne(ctx, res, id);
        if (!row) throw new HttpError(404, res.singular + ' not found.');
        return [200, row];
      }
      return [200, await crudList(ctx, res, query)];
    }
    case 'POST':
      if (res.write === 'none') throw new HttpError(405, 'This resource is read-only.');
      return [id ? 200 : 201, await crudWrite(ctx, name, res, id || null)];
    case 'PUT':
    case 'PATCH':
      if (!id) throw new HttpError(400, 'An id is required.');
      if (res.write === 'none') throw new HttpError(405, 'This resource is read-only.');
      return [200, await crudWrite(ctx, name, res, id)];
    case 'DELETE':
      if (!id) throw new HttpError(400, 'An id is required.');
      return [200, await crudDelete(ctx, name, res, id)];
    default:
      throw new HttpError(405, 'Method not allowed.');
  }
}

module.exports = { handleResource };
