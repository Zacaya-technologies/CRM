'use strict';
/** Small shared helpers: errors, date formatting and PHP-style casts. */

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** "+05:30" for the CRM timezone at the given moment. */
function tzOffset(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Y-m-d in the CRM timezone. */
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Y-m-d H:i:s in the CRM timezone. */
const ymdHis = (d = new Date()) => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Parses a MySQL "Y-m-d[ H:i:s]" string as CRM-local time. */
function parseLocal(v) {
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return new Date(v);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** MySQL DATETIME string → ISO 8601 with offset (PHP DATE_ATOM). */
function isoDatetime(v) {
  if (v === null || v === undefined) return null;
  const d = parseLocal(v);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tzOffset(d)}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** PHP (int) cast. */
const toInt = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** PHP (float) cast. */
const toNum = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Multibyte-safe substring (PHP mb_substr($s, 0, $n)). */
const mbCut = (s, n) => [...String(s)].slice(0, n).join('');

const mbLen = (s) => [...String(s)].length;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);

function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/);
  const ini = parts.slice(0, 2).map((p) => ([...p][0] || '').toUpperCase()).join('');
  return ini || '?';
}

module.exports = { HttpError, pad, tzOffset, ymd, ymdHis, parseLocal, isoDatetime, nowSec, toInt, toNum, mbCut, mbLen, sleep, isEmail, initialsOf };
