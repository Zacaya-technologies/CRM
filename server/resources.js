'use strict';
/**
 * Declarative resource map used by the generic CRUD engine (crud.js). Mirrors api/lib/resources.php.
 *
 * Each resource maps the JSON keys the front-end uses to database columns.
 * Field options:
 *   col       column on the base table (alias "t") — makes the field writable
 *   expr      read-only SQL expression (joins, sub-queries)
 *   type      str (default) | int | num | bool | date | datetime | csv
 *   enum      list of allowed values
 *   required  must be present and non-empty on create
 *   nullable  empty input is stored as NULL
 *   max       max string length (default 255)
 *   virtual   accepted on write but handled by a hook (no column)
 *   hidden    never returned (e.g. passwords)
 *
 * Resource options:
 *   table, from, order, label (field used in activity log), singular,
 *   write / delete / read (minimum role), log (false to skip activity log),
 *   before(ctx, cols, old, input, op)            may change cols
 *   after(ctx, id, input, old, op, row) → [kind, title, detail] activity override, or null
 */
const bcrypt = require('bcryptjs');
const { HttpError, ymd, ymdHis, parseLocal, isEmail, initialsOf } = require('./util');
const { passwordStamp } = require('./context');

function ownerFields(col = 'owner_id', alias = 'u', key = 'owner') {
  return {
    [key + 'Id']: { col, type: 'int', nullable: true },
    [key]: { expr: `COALESCE(${alias}.initials, '—')` },
    [key + 'Name']: { expr: `${alias}.name` },
  };
}

function clientFields(required = false) {
  return {
    clientId: { col: 'client_id', type: 'int', required, nullable: !required },
    client: { expr: "COALESCE(c.name, '—')" },
  };
}

/** The 15-gate checklist copied into every new onboarding. */
const ONBOARDING_TEMPLATE = [
  ['Legal, Contracts & Billing Validation', 'MSA & SOW Executed'],
  ['Legal, Contracts & Billing Validation', 'Initial Retainer Invoice Cleared'],
  ['Legal, Contracts & Billing Validation', 'Tax / GST & Entity Validation'],
  ['Brand Assets & Creative Toolkits', 'Vector Logo Files'],
  ['Brand Assets & Creative Toolkits', 'Typography Licenses & Font Files'],
  ['Brand Assets & Creative Toolkits', 'Brand Voice & Style Guide'],
  ['Brand Assets & Creative Toolkits', 'Product Photography & Video Drive'],
  ['Platform & Ad Account Permissions', 'Meta Business Manager Partner Access'],
  ['Platform & Ad Account Permissions', 'Google Ads MCC Link'],
  ['Platform & Ad Account Permissions', 'GA4 & Tag Manager Access'],
  ['Platform & Ad Account Permissions', 'CMS / Store Collaborator Access'],
  ['Platform & Ad Account Permissions', 'CRM / Email API Integration'],
  ['Go-To-Market Strategy & Kickoff Alignment', 'Persona & Competitor Audit'],
  ['Go-To-Market Strategy & Kickoff Alignment', 'Kickoff Deck & 90-Day Roadmap'],
  ['Go-To-Market Strategy & Kickoff Alignment', 'Executive Kickoff Call Scheduled'],
];

async function nextNumber(ctx, table, prefix, padTo) {
  // Only numbers that are the prefix + digits count (ignores hand-typed ones like "INV-TEST-001"),
  // and they're compared as numbers so INV-1000 comes after INV-999.
  const from = prefix.length + 1;
  const like = prefix.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const max = await ctx.col(`SELECT MAX(CAST(SUBSTRING(number, ?) AS UNSIGNED)) FROM ${table} WHERE number LIKE ? AND SUBSTRING(number, ?) REGEXP '^[0-9]+$'`, [from, like, from]);
  return prefix + String((parseInt(max, 10) || 0) + 1).padStart(padTo, '0');
}

/** bcrypt hash readable by both this server and PHP's password_verify(). */
async function hashPassword(pass) {
  return (await bcrypt.hash(pass, 10)).replace(/^\$2a\$/, '$2y$');
}

const MAX_PASSWORD_BYTES = 72; // bcrypt ignores anything longer

function checkNewPassword(pass, email = '') {
  if (Buffer.byteLength(pass) < 8) throw new HttpError(422, 'Password must be at least 8 characters.');
  if (Buffer.byteLength(pass) > MAX_PASSWORD_BYTES) throw new HttpError(422, 'Password must be at most 72 characters.');
  if (email !== '' && pass.toLowerCase() === email.toLowerCase()) throw new HttpError(422, 'Password cannot be the same as the email.');
  if (!/[A-Za-z]/.test(pass) || !/[0-9\W_]/.test(pass)) {
    throw new HttpError(422, 'Password needs at least one letter and one number or symbol.');
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const numberFormat = (n) => Math.round(Number(n)).toLocaleString('en-US');
const ucfirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const userJoin = ' LEFT JOIN users u ON u.id = t.owner_id';

const RESOURCES = {
  leads: {
    table: 'leads', singular: 'Lead', label: 'name',
    from: 'leads t' + userJoin,
    order: 't.score DESC, t.id DESC',
    fields: {
      name: { col: 'name', required: true, max: 120 },
      co: { col: 'company', max: 160 },
      email: { col: 'email', max: 190 },
      phone: { col: 'phone', max: 40 },
      source: { col: 'source', max: 60 },
      score: { col: 'score', type: 'int' },
      status: { col: 'status', enum: ['New', 'Contacted', 'Qualified', 'Unqualified'] },
      notes: { col: 'notes', max: 5000 },
      ...ownerFields(),
    },
  },

  clients: {
    table: 'clients', singular: 'Client', label: 'name',
    from: 'clients t' + userJoin,
    order: 't.mrr DESC, t.name',
    fields: {
      name: { col: 'name', required: true, max: 160 },
      ind: { col: 'industry', max: 120 },
      email: { col: 'email', max: 190 },
      phone: { col: 'phone', max: 40 },
      mrr: { col: 'mrr', type: 'num' },
      health: { col: 'health', type: 'int' },
      renewal: { col: 'renewal_date', type: 'date', nullable: true },
      status: { col: 'status', enum: ['active', 'paused', 'churned'] },
      color1: { col: 'color1', max: 9 },
      color2: { col: 'color2', max: 9 },
      revenueYtd: { col: 'revenue_ytd', type: 'num' },
      costYtd: { col: 'cost_ytd', type: 'num' },
      ...ownerFields(),
    },
  },

  deals: {
    table: 'deals', singular: 'Deal', label: 'name',
    from: 'deals t' + userJoin,
    order: 't.stage_changed_at DESC',
    fields: {
      name: { col: 'name', required: true, max: 160 },
      co: { col: 'industry', max: 120 },
      tag: { col: 'tag', max: 60 },
      value: { col: 'value', type: 'num' },
      stage: { col: 'stage', enum: ['discovery', 'pitch', 'negotiation', 'won', 'lost'] },
      stageChangedAt: { expr: 't.stage_changed_at', type: 'datetime' },
      ...ownerFields(),
    },
    before(ctx, cols, old) {
      if (cols.stage !== undefined && (!old || old.stage !== cols.stage)) {
        cols.stage_changed_at = ymdHis();
      }
    },
    after(ctx, id, input, old, op, row) {
      if (op === 'update' && old && old.stage !== row.stage) {
        const won = row.stage === 'won';
        return [won ? 'success' : 'info', won ? 'Deal closed won' : 'Deal moved to ' + row.stage, row.name];
      }
      return null;
    },
  },

  followups: {
    table: 'followups', singular: 'Follow-up', label: 'name',
    from: 'followups t' + userJoin,
    order: 't.done ASC, t.due_at ASC',
    fields: {
      type: { col: 'type', enum: ['call', 'mail', 'wa', 'meet'] },
      name: { col: 'title', required: true, max: 200 },
      sub: { col: 'details' },
      dueAt: { col: 'due_at', type: 'datetime', required: true },
      done: { col: 'done', type: 'bool' },
      ...ownerFields(),
    },
  },

  services: {
    table: 'services', singular: 'Service', label: 'name',
    order: 't.id',
    fields: {
      icon: { col: 'icon', enum: ['ads', 'seo', 'social', 'content', 'email', 'creative'] },
      name: { col: 'name', required: true, max: 160 },
      desc: { col: 'description', max: 500 },
      tier: { col: 'tier', enum: ['Core', 'Add-on'] },
      clients: { col: 'active_clients', type: 'int' },
      mrr: { col: 'mrr', type: 'num' },
      revenueYtd: { col: 'revenue_ytd', type: 'num' },
    },
  },

  onboardings: {
    table: 'onboardings', singular: 'Onboarding', label: 'name',
    from: 'onboardings t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.lead_id',
    order: "t.status = 'completed', t.go_live",
    fields: {
      clientId: { col: 'client_id', type: 'int', required: true },
      name: { expr: 'c.name' },
      type: { expr: 'c.industry' },
      mrr: { expr: 'c.mrr', type: 'num' },
      gate: { col: 'gate', max: 160 },
      blocker: { col: 'blocker', max: 160 },
      goLive: { col: 'go_live', type: 'date', nullable: true },
      status: { col: 'status', enum: ['active', 'completed'] },
      done: { expr: '(SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id = t.id AND i.done = 1)', type: 'int' },
      total: { expr: '(SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id = t.id)', type: 'int' },
      ...ownerFields('lead_id', 'u', 'lead'),
    },
    async after(ctx, id, input, old, op) {
      if (op === 'create') {
        for (let i = 0; i < ONBOARDING_TEMPLATE.length; i++) {
          const [cat, title] = ONBOARDING_TEMPLATE[i];
          await ctx.q('INSERT INTO onboarding_items (onboarding_id, category, sort, title) VALUES (?,?,?,?)', [id, cat, i + 1, title]);
        }
      }
      return null;
    },
  },

  onboarding_items: {
    table: 'onboarding_items', singular: 'Checklist item', label: 'title',
    order: 't.sort, t.id',
    fields: {
      onboardingId: { col: 'onboarding_id', type: 'int', required: true },
      category: { col: 'category', required: true, max: 120 },
      sort: { col: 'sort', type: 'int' },
      title: { col: 'title', required: true, max: 200 },
      detail: { col: 'detail' },
      badge: { col: 'badge', max: 60 },
      done: { col: 'done', type: 'bool' },
      flag: { col: 'flag', enum: ['none', 'critical', 'resend', 'join'] },
    },
    async after(ctx, id, input, old, op, row) {
      if (op === 'update' && old && Boolean(Number(old.done)) !== Boolean(row.done)) {
        const client = await ctx.col('SELECT c.name FROM onboardings o JOIN clients c ON c.id = o.client_id WHERE o.id = ?', [row.onboardingId]);
        return [row.done ? 'success' : 'warning', (row.done ? 'Gate verified: ' : 'Gate reopened: ') + row.title, client || null];
      }
      return null;
    },
  },

  approvals: {
    table: 'approvals', singular: 'Approval', label: 'item',
    from: 'approvals t JOIN clients c ON c.id = t.client_id',
    order: "t.status = 'pending' DESC, t.due_at",
    fields: {
      item: { col: 'item', required: true, max: 200 },
      type: { col: 'type', enum: ['Creative', 'Budget', 'Contract'] },
      preview: { col: 'preview', max: 500 },
      status: { col: 'status', enum: ['pending', 'approved', 'changes'] },
      requestedAt: { expr: 't.requested_at', type: 'datetime' },
      dueAt: { col: 'due_at', type: 'datetime', nullable: true },
      decidedAt: { expr: 't.decided_at', type: 'datetime' },
      ...clientFields(true),
    },
    async before(ctx, cols, old) {
      if (!old && !cols.due_at) {
        cols.due_at = ymdHis(new Date(Date.now() + 86400000)); // 24h SLA
      }
      if (old && cols.status !== undefined && cols.status !== old.status) {
        cols.decided_at = cols.status === 'pending' ? null : ymdHis();
        const me = await ctx.currentUser();
        cols.decided_by = cols.status === 'pending' ? null : (me ? me.id : null);
      }
    },
    after(ctx, id, input, old, op, row) {
      if (op === 'update' && old && old.status !== row.status) {
        if (row.status === 'approved') return ['success', 'Client approval received', row.client + ' • ' + row.item];
        if (row.status === 'changes') return ['warning', 'Changes requested', row.client + ' • ' + row.item];
      }
      return null;
    },
  },

  campaigns: {
    table: 'campaigns', singular: 'Campaign', label: 'name',
    from: 'campaigns t LEFT JOIN clients c ON c.id = t.client_id' + userJoin,
    order: "FIELD(t.status, 'live', 'paused', 'scheduled', 'ended'), t.spend DESC",
    fields: {
      name: { col: 'name', required: true, max: 200 },
      ch: { col: 'channel', enum: ['meta', 'google', 'linkedin', 'youtube'] },
      status: { col: 'status', enum: ['live', 'paused', 'scheduled', 'ended'] },
      statusNote: { col: 'status_note', max: 60, nullable: true },
      objective: { col: 'objective', nullable: true },
      pace: { col: 'pace', type: 'int' },
      spend: { col: 'spend', type: 'num' },
      budget: { col: 'budget', type: 'num' },
      roas: { col: 'roas', type: 'num', nullable: true },
      cpl: { col: 'cpl', type: 'num', nullable: true },
      impressions: { col: 'impressions', type: 'int', nullable: true },
      ctr: { col: 'ctr', type: 'num', nullable: true },
      conversions: { col: 'conversions', type: 'int', nullable: true },
      convLabel: { col: 'conv_label', max: 60, nullable: true },
      convUnit: { col: 'conv_unit', max: 30, nullable: true },
      costPerConv: { col: 'cost_per_conv', type: 'num', nullable: true },
      roasNote: { col: 'roas_note', max: 60, nullable: true },
      ...clientFields(),
      ...ownerFields(),
    },
  },

  posts: {
    table: 'content_posts', singular: 'Post', label: 'title',
    from: 'content_posts t LEFT JOIN clients c ON c.id = t.client_id' + userJoin,
    order: 't.publish_date, t.id',
    fields: {
      d: { col: 'publish_date', type: 'date', required: true },
      title: { col: 'title', required: true, max: 200 },
      ch: { col: 'channel', enum: ['instagram', 'linkedin', 'blog', 'email', 'youtube'] },
      fmt: { col: 'format', max: 60 },
      status: { col: 'status', enum: ['draft', 'review', 'scheduled', 'published'] },
      ...clientFields(),
      ...ownerFields(),
    },
  },

  projects: {
    table: 'projects', singular: 'Project', label: 'name',
    from: 'projects t LEFT JOIN clients c ON c.id = t.client_id',
    order: "t.status = 'done', t.due_date",
    fields: {
      name: { col: 'name', required: true, max: 200 },
      client: { expr: "COALESCE(c.name, 'Internal')" },
      color1: { expr: "COALESCE(c.color1, '#8B7FF5')" },
      color2: { expr: "COALESCE(c.color2, '#5145E8')" },
      status: { col: 'status', enum: ['ontrack', 'risk', 'review', 'done'] },
      progress: { col: 'progress', type: 'int' },
      due: { col: 'due_date', type: 'date', nullable: true },
      budget: { col: 'budget', type: 'num' },
      tasksDone: { col: 'tasks_done', type: 'int' },
      tasksTotal: { col: 'tasks_total', type: 'int' },
      team: { expr: '(SELECT GROUP_CONCAT(u2.initials ORDER BY u2.id) FROM project_members pm JOIN users u2 ON u2.id = pm.user_id WHERE pm.project_id = t.id)', type: 'csv' },
      teamIds: { expr: '(SELECT GROUP_CONCAT(pm.user_id ORDER BY pm.user_id) FROM project_members pm WHERE pm.project_id = t.id)', type: 'csv', virtual: true },
      clientId: clientFields().clientId,
    },
    async after(ctx, id, input) {
      if (Object.prototype.hasOwnProperty.call(input, 'teamIds')) {
        const ids = Array.isArray(input.teamIds) ? input.teamIds : String(input.teamIds ?? '').split(',');
        await ctx.q('DELETE FROM project_members WHERE project_id = ?', [id]);
        for (const uid of ids.map((v) => parseInt(v, 10)).filter((v) => v)) {
          await ctx.q('INSERT IGNORE INTO project_members (project_id, user_id) SELECT ?, id FROM users WHERE id = ?', [id, uid]);
        }
      }
      return null;
    },
  },

  milestones: {
    table: 'milestones', singular: 'Milestone', label: 'name',
    from: 'milestones t JOIN projects p ON p.id = t.project_id' + userJoin,
    order: 't.due_date',
    fields: {
      name: { col: 'name', required: true, max: 200 },
      projectId: { col: 'project_id', type: 'int', required: true },
      project: { expr: 'p.name' },
      due: { col: 'due_date', type: 'date', nullable: true },
      status: { col: 'status', enum: ['ontrack', 'risk', 'review', 'done'] },
      ...ownerFields(),
    },
  },

  tasks: {
    table: 'tasks', singular: 'Task', label: 'title',
    from: 'tasks t' + userJoin,
    order: "FIELD(t.priority, 'high', 'med', 'low'), t.due_date",
    fields: {
      title: { col: 'title', required: true, max: 200 },
      project: { col: 'project', max: 160 },
      col: { col: 'col', enum: ['todo', 'progress', 'review', 'done'] },
      pri: { col: 'priority', enum: ['high', 'med', 'low'] },
      due: { col: 'due_date', type: 'date', nullable: true },
      ...ownerFields(),
    },
    after(ctx, id, input, old, op, row) {
      if (op === 'update' && old && old.col !== row.col) {
        const names = { todo: 'To Do', progress: 'In Progress', review: 'In Review', done: 'Done' };
        return [row.col === 'done' ? 'success' : 'info', 'Task moved to ' + names[row.col], row.title];
      }
      return null;
    },
  },

  proposals: {
    table: 'proposals', singular: 'Proposal', label: 'title',
    from: 'proposals t' + userJoin,
    order: 't.number DESC',
    fields: {
      no: { col: 'number', max: 30 },
      title: { col: 'title', required: true, max: 200 },
      client: { col: 'client_name', required: true, max: 160 },
      value: { col: 'value', type: 'num' },
      sent: { col: 'sent_date', type: 'date', nullable: true },
      expires: { col: 'expires_date', type: 'date', nullable: true },
      status: { col: 'status', enum: ['draft', 'sent', 'viewed', 'accepted', 'declined'] },
      views: { col: 'views', type: 'int' },
      ...ownerFields(),
    },
    async before(ctx, cols, old) {
      if (!old && !cols.number) {
        cols.number = await nextNumber(ctx, 'proposals', `PR-${new Date().getFullYear()}-`, 3);
      }
      const status = cols.status ?? (old ? old.status : null) ?? 'draft';
      const sent = 'sent_date' in cols ? cols.sent_date : (old ? old.sent_date : null);
      if (status !== 'draft' && !sent) {
        cols.sent_date = ymd();
        if (!cols.expires_date && !(old && old.expires_date)) {
          cols.expires_date = ymd(new Date(Date.now() + 14 * 86400000));
        }
      }
    },
    after(ctx, id, input, old, op, row) {
      if (op === 'update' && old && old.status !== row.status && ['accepted', 'declined'].includes(row.status)) {
        return [row.status === 'accepted' ? 'success' : 'danger', 'Proposal ' + row.status, row.client + ' • ' + row.title];
      }
      return null;
    },
  },

  invoices: {
    table: 'invoices', singular: 'Invoice', label: 'no',
    from: 'invoices t JOIN clients c ON c.id = t.client_id',
    order: 't.issued_date DESC, t.number DESC',
    fields: {
      no: { col: 'number', max: 30 },
      desc: { col: 'description' },
      issued: { col: 'issued_date', type: 'date', required: true },
      due: { col: 'due_date', type: 'date', required: true },
      amount: { col: 'amount', type: 'num', required: true },
      paid: { col: 'paid_date', type: 'date', nullable: true },
      method: { virtual: true, enum: ['Bank transfer', 'UPI', 'Card', 'Razorpay'] },
      ...clientFields(true),
    },
    async before(ctx, cols, old) {
      if (!old && !cols.number) {
        cols.number = await nextNumber(ctx, 'invoices', 'INV-', 4);
      }
    },
    async after(ctx, id, input, old, op, row) {
      const wasPaid = old && old.paid_date;
      if (row.paid && !wasPaid) {
        // Record the matching settled payment automatically.
        await ctx.q("INSERT INTO payments (client_id, invoice_id, reference, method, paid_on, amount, status) VALUES (?,?,?,?,?,?,'settled')",
          [row.clientId, id, row.no, input.method || 'Bank transfer', row.paid, row.amount]);
        return ['success', 'Invoice paid', `${row.client} • ${row.no} • ₹${numberFormat(row.amount)}`];
      }
      return null;
    },
  },

  payments: {
    table: 'payments', singular: 'Payment', label: 'ref',
    from: 'payments t JOIN clients c ON c.id = t.client_id',
    order: 't.paid_on DESC, t.id DESC',
    fields: {
      invoiceId: { col: 'invoice_id', type: 'int', nullable: true },
      ref: { col: 'reference', max: 40 },
      method: { col: 'method', enum: ['Bank transfer', 'UPI', 'Card', 'Razorpay'] },
      date: { col: 'paid_on', type: 'date', required: true },
      amount: { col: 'amount', type: 'num', required: true },
      status: { col: 'status', enum: ['settled', 'processing', 'failed'] },
      ...clientFields(true),
    },
  },

  finance: {
    table: 'finance_monthly', singular: 'Finance month', label: 'month',
    order: 't.month', write: 'manager',
    fields: {
      month: { col: 'month', type: 'date', required: true },
      revenue: { col: 'revenue', type: 'num' },
      expenses: { col: 'expenses', type: 'num' },
      collected: { col: 'collected', type: 'num' },
      count: { col: 'payments_count', type: 'int' },
    },
    async before(ctx, cols, old) {
      if (cols.month) {
        cols.month = cols.month.slice(0, 8) + '01';
        // One row per month: point people at the existing month instead of a duplicate-key error.
        const dup = await ctx.col('SELECT id FROM finance_monthly WHERE month = ? AND id <> ?', [cols.month, old ? old.id : 0]);
        if (dup) {
          const d = parseLocal(cols.month);
          const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          throw new HttpError(422, `Figures for ${label} are already recorded. Open ${label} in the table to edit them, or pick another month.`);
        }
      }
    },
  },

  saved_reports: {
    table: 'saved_reports', singular: 'Saved report', label: 'name',
    order: 't.id',
    fields: {
      name: { col: 'name', required: true, max: 160 },
      sched: { col: 'schedule', max: 120 },
      fmt: { col: 'format', enum: ['PDF', 'XLSX', 'CSV'] },
    },
  },

  activity: {
    table: 'activity', singular: 'Activity', label: 'title',
    from: 'activity t LEFT JOIN users u ON u.id = t.user_id',
    order: 't.created_at DESC, t.id DESC',
    write: 'none', delete: 'admin', log: false, limit: 50,
    fields: {
      kind: { expr: 't.kind' },
      title: { expr: 't.title' },
      detail: { expr: 't.detail' },
      entity: { col: 'entity', ro: true },
      user: { expr: 'u.name' },
    },
  },

  users: {
    table: 'users', singular: 'User', label: 'name',
    order: 't.active DESC, t.name',
    write: 'admin', delete: 'admin',
    fields: {
      name: { col: 'name', required: true, max: 120 },
      initials: { col: 'initials', max: 4 },
      email: { col: 'email', max: 190, nullable: true },
      role: { col: 'role', enum: ['admin', 'manager', 'member', 'viewer'] },
      title: { col: 'title', max: 120 },
      active: { col: 'active', type: 'bool' },
      canLogin: { expr: '(t.password_hash IS NOT NULL)', type: 'bool' },
      lastLoginAt: { expr: 't.last_login_at', type: 'datetime' },
      password: { virtual: true, hidden: true },
    },
    async before(ctx, cols, old, input) {
      if (!old && !cols.initials && cols.name) {
        cols.initials = initialsOf(cols.name);
      }
      if (input.password !== undefined && input.password !== null && input.password !== '') {
        checkNewPassword(String(input.password), String(cols.email ?? (old ? old.email : '') ?? ''));
        cols.password_hash = await hashPassword(String(input.password));
      }
      const me = await ctx.currentUser();
      if (old && Number(old.id) === me.id) {
        if ((cols.role !== undefined && cols.role !== 'admin') || (cols.active !== undefined && !cols.active)) {
          throw new HttpError(422, 'You cannot demote or deactivate your own account.');
        }
      }
      if (cols.email) {
        cols.email = cols.email.toLowerCase();
        if (!isEmail(cols.email)) throw new HttpError(422, 'Please enter a valid email address.');
      }
      // Account changes made by an admin go to the Security Log.
      if (old) {
        const who = cols.email ?? old.email;
        const by = 'by ' + me.name;
        if (cols.password_hash) await ctx.logSecurity('password_reset', who, Number(old.id), `Password set ${by}`);
        // An admin resetting their own password here keeps their current session.
        if (cols.password_hash && Number(old.id) === me.id) ctx.session.data.pw = passwordStamp(cols.password_hash);
        if (cols.role !== undefined && cols.role !== old.role) await ctx.logSecurity('role_changed', who, Number(old.id), `${old.role} → ${cols.role} ${by}`);
        if (cols.active !== undefined && Number(cols.active) !== Number(old.active)) {
          const what = cols.active ? 'reactivated' : 'deactivated';
          await ctx.logSecurity(what, who, Number(old.id), `${ucfirst(what)} ${by}`);
        }
      } else if (cols.password_hash) {
        await ctx.logSecurity('account_created', cols.email ?? null, null, 'Login created by ' + me.name);
      }
    },
  },

  // Sign-ins, lockouts and account changes. Written by the API only; admins can read it.
  security_log: {
    table: 'security_log', singular: 'Security event', label: 'event',
    from: 'security_log t LEFT JOIN users u ON u.id = t.user_id',
    order: 't.created_at DESC, t.id DESC',
    read: 'admin', write: 'none', delete: 'admin', log: false, limit: 200,
    fields: {
      event: { col: 'event', ro: true },
      email: { col: 'email', ro: true },
      ip: { col: 'ip', ro: true },
      agent: { expr: 't.user_agent' },
      detail: { expr: 't.detail' },
      user: { expr: 'u.name' },
    },
  },
};

module.exports = { RESOURCES, ONBOARDING_TEMPLATE, nextNumber, hashPassword, checkNewPassword };
