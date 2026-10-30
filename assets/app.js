/* =====================================================================
   OmniAgency CRM — shared front-end runtime
   - API client (talks to api/index.php)
   - Session guard (redirects to login.html when signed out)
   - Add / edit / delete modal forms for every resource
   - Top-bar user menu, notifications, Ctrl+K command palette, toasts
   Every page loads this file before its own <script type="module">.
   ===================================================================== */
(function () {
  'use strict';

  const API_BASE = 'api/index.php';
  const IS_LOGIN = /\/login\.html$/.test(location.pathname);
  const ROLE_RANK = { viewer: 0, member: 1, manager: 2, admin: 3 };
  const ROLE_LABEL = { admin: 'Super Admin', manager: 'Manager', member: 'Team Member', viewer: 'Viewer' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (!IS_LOGIN) document.documentElement.classList.add('crm-auth-pending');

  /* ---------------- HTML escaping ----------------
     Data from the API is escaped once on arrival so page templates that
     build HTML strings stay safe. Forms use the raw (unescaped) values. */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  function escDeep(v) {
    if (typeof v === 'string') return esc(v);
    if (Array.isArray(v)) return v.map(escDeep);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k in v) o[k] = escDeep(v[k]);
      return o;
    }
    return v;
  }
  const unesc = (s) => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };

  /* ---------------- API client ---------------- */
  function toLogin() {
    const next = location.pathname.split('/').pop() + location.search;
    location.replace('login.html' + (next && next !== 'login.html' ? '?next=' + encodeURIComponent(next) : ''));
    return new Promise(() => {}); // halt the caller while navigating
  }

  async function request(route, { method = 'GET', params = {}, body, raw = false } = {}) {
    const qs = new URLSearchParams({ r: route });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, v);
    const headers = { 'X-CRM': '1', Accept: 'application/json' };
    let httpMethod = method;
    if (method !== 'GET' && method !== 'POST') {
      headers['X-HTTP-Method-Override'] = method; // some shared hosts block PUT/DELETE
      httpMethod = 'POST';
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(`${API_BASE}?${qs}`, {
        method: httpMethod, headers, credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Network error — check your connection and try again.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON (e.g. PHP fatal) */ }
    if (res.status === 401 && !route.startsWith('auth/')) return toLogin();
    if (!res.ok || data === null) {
      const err = new Error((data && data.error) || `Server error (${res.status}). Is PHP enabled and api/config.php correct?`);
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return raw ? data : escDeep(data);
  }

  const API = {
    list: (r, params) => request(r, { params }),
    get: (r, id) => request(r, { params: { id } }),
    create: (r, body) => request(r, { method: 'POST', body }),
    update: (r, id, body) => request(r, { method: 'PUT', params: { id }, body }),
    remove: (r, id) => request(r, { method: 'DELETE', params: { id } }),
    call: request,
    raw: {
      list: (r, params) => request(r, { params, raw: true }),
      get: (r, id) => request(r, { params: { id }, raw: true }),
    },
  };

  /* ---------------- Formatting helpers ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = {
    inr: (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'),
    short: (n) => {
      n = Number(n) || 0;
      if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
      if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`;
      if (n >= 1e3) return `₹${Math.round(n / 1e3)}K`;
      return `₹${Math.round(n)}`;
    },
    date: (s) => (s ? `${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(8, 10)}` : '—'),
    isoDate: (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    initials: (s) => String(s || '?').replace(/&amp;/g, '&').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase(),
    ago: (iso) => {
      const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
      if (s < 172800) return 'Yesterday';
      return `${Math.floor(s / 86400)}d ago`;
    },
    span: (ms) => {
      const m = Math.round(Math.abs(ms) / 60000);
      if (m < 60) return `${m}m`;
      if (m < 1440) return `${Math.round(m / 60)}h`;
      return `${Math.round(m / 1440)}d`;
    },
    time: (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    MONTHS,
  };

  /* ---------------- Toasts & flash messages ---------------- */
  function toast(msg, kind = 'success') {
    let box = document.querySelector('.crm-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'crm-toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'crm-toast ' + kind;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6000 : 3200);
  }
  function flash(msg) { try { sessionStorage.setItem('crm-flash', msg); } catch (e) {} }
  function showFlash() {
    try {
      const m = sessionStorage.getItem('crm-flash');
      if (m) { sessionStorage.removeItem('crm-flash'); toast(m); }
    } catch (e) {}
  }

  /* ---------------- Form definitions ---------------- */
  const STAGES = [['discovery', 'Discovery & Qualification'], ['pitch', 'Pitch & Proposal'], ['negotiation', 'Contract & Negotiation'], ['won', 'Closed Won'], ['lost', 'Closed Lost']];
  const PROJECT_STATUS = [['ontrack', 'On Track'], ['risk', 'At Risk'], ['review', 'In Review'], ['done', 'Completed']];
  const METHODS = ['Bank transfer', 'UPI', 'Card', 'Razorpay'];
  const plusDays = (n) => fmt.isoDate(new Date(Date.now() + n * 86400000));

  const FORMS = {
    leads: {
      title: 'Lead',
      defaults: () => ({ status: 'New', score: 50, source: 'Website Form', ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'name', label: 'Full name', required: true },
        { k: 'co', label: 'Company' },
        { k: 'email', label: 'Email', type: 'email' },
        { k: 'phone', label: 'Phone / WhatsApp' },
        { k: 'source', label: 'Source', type: 'select', options: ['Meta Lead Ads', 'Google Ads', 'Website Form', 'WhatsApp Inbound', 'Referral', 'LinkedIn', 'Outbound', 'Other'] },
        { k: 'score', label: 'Lead score (0–100)', type: 'number', min: 0, max: 100 },
        { k: 'status', label: 'Status', type: 'select', options: ['New', 'Contacted', 'Qualified', 'Unqualified'] },
        { k: 'ownerId', label: 'Owner', type: 'select', options: 'users', empty: 'Unassigned' },
        { k: 'notes', label: 'Notes', type: 'textarea', full: true },
      ],
    },
    clients: {
      title: 'Client',
      defaults: () => ({ status: 'active', health: 75, color1: '#8B7FF5', color2: '#5145E8', ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'name', label: 'Company name', required: true },
        { k: 'ind', label: 'Industry' },
        { k: 'email', label: 'Billing email', type: 'email' },
        { k: 'phone', label: 'Phone' },
        { k: 'mrr', label: 'Monthly retainer (₹)', type: 'number', min: 0 },
        { k: 'health', label: 'Health score (0–100)', type: 'number', min: 0, max: 100 },
        { k: 'renewal', label: 'Renewal date', type: 'date' },
        { k: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['paused', 'Paused'], ['churned', 'Churned']] },
        { k: 'ownerId', label: 'Account owner', type: 'select', options: 'users', empty: 'Unassigned' },
        { k: 'color1', label: 'Brand colour 1', type: 'color' },
        { k: 'color2', label: 'Brand colour 2', type: 'color' },
        { k: 'revenueYtd', label: 'Revenue YTD (₹)', type: 'number', min: 0 },
        { k: 'costYtd', label: 'Delivery cost YTD (₹)', type: 'number', min: 0 },
      ],
    },
    deals: {
      title: 'Deal',
      defaults: () => ({ stage: 'discovery', ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'name', label: 'Company / deal name', required: true },
        { k: 'co', label: 'Industry' },
        { k: 'tag', label: 'Source or tag', placeholder: 'e.g. Referral, Legal Review' },
        { k: 'value', label: 'Value (₹ / month)', type: 'number', min: 0 },
        { k: 'stage', label: 'Stage', type: 'select', options: STAGES },
        { k: 'ownerId', label: 'Owner', type: 'select', options: 'users', empty: 'Unassigned' },
      ],
    },
    followups: {
      title: 'Follow-up',
      defaults: () => ({ type: 'call', dueAt: new Date(Date.now() + 3600000).toISOString(), ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'name', label: 'Title', required: true, full: true, placeholder: 'Follow-up call — Company name' },
        { k: 'sub', label: 'Details', full: true },
        { k: 'type', label: 'Type', type: 'select', options: [['call', 'Call'], ['mail', 'Email'], ['wa', 'WhatsApp'], ['meet', 'Meeting']] },
        { k: 'dueAt', label: 'Due', type: 'datetime', required: true },
        { k: 'ownerId', label: 'Owner', type: 'select', options: 'users', empty: 'Unassigned' },
        { k: 'done', label: 'Completed', type: 'checkbox' },
      ],
    },
    services: {
      title: 'Service',
      defaults: () => ({ icon: 'ads', tier: 'Core' }),
      fields: [
        { k: 'name', label: 'Service name', required: true, full: true },
        { k: 'desc', label: 'Description', type: 'textarea', full: true },
        { k: 'icon', label: 'Icon', type: 'select', options: [['ads', 'Paid ads'], ['seo', 'SEO'], ['social', 'Social'], ['content', 'Content'], ['email', 'Email'], ['creative', 'Creative']] },
        { k: 'tier', label: 'Tier', type: 'select', options: ['Core', 'Add-on'] },
        { k: 'clients', label: 'Active clients', type: 'number', min: 0 },
        { k: 'mrr', label: 'Attached MRR (₹)', type: 'number', min: 0 },
        { k: 'revenueYtd', label: 'Revenue YTD (₹)', type: 'number', min: 0 },
      ],
    },
    onboardings: {
      title: 'Onboarding',
      defaults: () => ({ status: 'active', gate: 'Contract & Billing', blocker: 'MSA signature', leadId: CRM.user && CRM.user.id, goLive: plusDays(14) }),
      fields: [
        { k: 'clientId', label: 'Client', type: 'select', options: 'clients', required: true },
        { k: 'leadId', label: 'Onboarding lead', type: 'select', options: 'users', empty: 'Unassigned' },
        { k: 'gate', label: 'Current gate' },
        { k: 'blocker', label: 'Next blocker' },
        { k: 'goLive', label: 'Target go-live', type: 'date' },
        { k: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['completed', 'Completed']] },
      ],
    },
    onboarding_items: {
      title: 'Checklist gate',
      defaults: () => ({ flag: 'none', category: 'Platform & Ad Account Permissions' }),
      fields: [
        { k: 'title', label: 'Gate', required: true, full: true },
        { k: 'detail', label: 'Detail / evidence', full: true },
        { k: 'category', label: 'Category', type: 'select', options: ['Legal, Contracts & Billing Validation', 'Brand Assets & Creative Toolkits', 'Platform & Ad Account Permissions', 'Go-To-Market Strategy & Kickoff Alignment'], required: true },
        { k: 'badge', label: 'Status label', placeholder: 'e.g. Verified' },
        { k: 'flag', label: 'Flag', type: 'select', options: [['none', 'None'], ['critical', 'Critical blocker'], ['resend', 'Needs resend'], ['join', 'Meeting link']] },
        { k: 'sort', label: 'Order', type: 'number' },
        { k: 'done', label: 'Verified', type: 'checkbox' },
      ],
    },
    approvals: {
      title: 'Approval request',
      defaults: () => ({ type: 'Creative', status: 'pending', dueAt: new Date(Date.now() + 86400000).toISOString() }),
      fields: [
        { k: 'item', label: 'What needs approval', required: true, full: true },
        { k: 'clientId', label: 'Client', type: 'select', options: 'clients', required: true },
        { k: 'type', label: 'Type', type: 'select', options: ['Creative', 'Budget', 'Contract'] },
        { k: 'preview', label: 'Summary for the client', type: 'textarea', full: true },
        { k: 'dueAt', label: 'Approval due by', type: 'datetime' },
        { k: 'status', label: 'Status', type: 'select', options: [['pending', 'Pending'], ['approved', 'Approved'], ['changes', 'Changes requested']] },
      ],
    },
    campaigns: {
      title: 'Campaign',
      defaults: () => ({ ch: 'meta', status: 'scheduled', pace: 0, spend: 0, ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'name', label: 'Campaign name', required: true, full: true },
        { k: 'clientId', label: 'Client', type: 'select', options: 'clients', empty: '—' },
        { k: 'ch', label: 'Channel', type: 'select', options: [['meta', 'Meta Ads'], ['google', 'Google Ads'], ['linkedin', 'LinkedIn'], ['youtube', 'YouTube Ads']] },
        { k: 'status', label: 'Status', type: 'select', options: [['live', 'Live'], ['paused', 'Paused'], ['scheduled', 'Scheduled'], ['ended', 'Ended']] },
        { k: 'ownerId', label: 'Owner', type: 'select', options: 'users', empty: 'Unassigned' },
        { k: 'budget', label: 'Budget (₹)', type: 'number', min: 0 },
        { k: 'spend', label: 'Spend to date (₹)', type: 'number', min: 0 },
        { k: 'pace', label: 'Budget pacing %', type: 'number', min: 0, max: 100 },
        { k: 'roas', label: 'ROAS (x)', type: 'number', step: '0.01', min: 0 },
        { k: 'cpl', label: 'Cost per lead (₹)', type: 'number', min: 0 },
        { k: 'impressions', label: 'Impressions', type: 'number', min: 0 },
        { k: 'ctr', label: 'CTR %', type: 'number', step: '0.01', min: 0 },
        { k: 'conversions', label: 'Conversions', type: 'number', min: 0 },
        { k: 'convLabel', label: 'Conversion label', placeholder: 'SQLs Generated' },
        { k: 'convUnit', label: 'Conversion unit', placeholder: 'leads / orders / views' },
        { k: 'costPerConv', label: 'Cost per conversion (₹)', type: 'number', step: '0.01', min: 0 },
        { k: 'objective', label: 'Targeting / objective', full: true },
        { k: 'statusNote', label: 'Status note', placeholder: 'e.g. Paused (A/B Test)' },
        { k: 'roasNote', label: 'ROAS note', placeholder: 'e.g. High Yield' },
      ],
    },
    posts: {
      title: 'Content post',
      defaults: () => ({ ch: 'instagram', status: 'draft', d: fmt.isoDate(), ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'title', label: 'Title', required: true, full: true },
        { k: 'd', label: 'Publish date', type: 'date', required: true },
        { k: 'clientId', label: 'Client', type: 'select', options: 'clients', empty: '—' },
        { k: 'ch', label: 'Channel', type: 'select', options: [['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['blog', 'Blog'], ['email', 'Newsletter'], ['youtube', 'YouTube']] },
        { k: 'fmt', label: 'Format', placeholder: 'Reel, Carousel, Long-form…' },
        { k: 'status', label: 'Status', type: 'select', options: [['draft', 'Draft'], ['review', 'In Review'], ['scheduled', 'Scheduled'], ['published', 'Published']] },
        { k: 'ownerId', label: 'Owner', type: 'select', options: 'users', empty: 'Unassigned' },
      ],
    },
    projects: {
      title: 'Project',
      defaults: () => ({ status: 'ontrack', progress: 0, due: plusDays(30), teamIds: CRM.user ? [String(CRM.user.id)] : [] }),
      fields: [
        { k: 'name', label: 'Project name', required: true, full: true },
        { k: 'clientId', label: 'Client', type: 'select', options: 'clients', empty: 'Internal' },
        { k: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS },
        { k: 'due', label: 'Due date', type: 'date' },
        { k: 'budget', label: 'Budget (₹)', type: 'number', min: 0 },
        { k: 'progress', label: 'Progress %', type: 'number', min: 0, max: 100 },
        { k: 'tasksDone', label: 'Tasks done', type: 'number', min: 0 },
        { k: 'tasksTotal', label: 'Tasks total', type: 'number', min: 0 },
        { k: 'teamIds', label: 'Team', type: 'multi', options: 'users', full: true },
      ],
    },
    milestones: {
      title: 'Milestone',
      defaults: () => ({ status: 'ontrack', ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'name', label: 'Milestone', required: true, full: true },
        { k: 'projectId', label: 'Project', type: 'select', options: 'projects', required: true },
        { k: 'due', label: 'Due date', type: 'date' },
        { k: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS },
        { k: 'ownerId', label: 'Owner', type: 'select', options: 'users', empty: 'Unassigned' },
      ],
    },
    tasks: {
      title: 'Task',
      defaults: () => ({ col: 'todo', pri: 'med', due: plusDays(7), ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'title', label: 'Task', required: true, full: true },
        { k: 'project', label: 'Project / workstream', full: true },
        { k: 'col', label: 'Column', type: 'select', options: [['todo', 'To Do'], ['progress', 'In Progress'], ['review', 'In Review'], ['done', 'Done']] },
        { k: 'pri', label: 'Priority', type: 'select', options: [['high', 'High'], ['med', 'Medium'], ['low', 'Low']] },
        { k: 'due', label: 'Due date', type: 'date' },
        { k: 'ownerId', label: 'Assignee', type: 'select', options: 'users', empty: 'Unassigned' },
      ],
    },
    proposals: {
      title: 'Proposal',
      defaults: () => ({ status: 'draft', ownerId: CRM.user && CRM.user.id }),
      fields: [
        { k: 'title', label: 'Proposal title', required: true, full: true },
        { k: 'client', label: 'Client / prospect', required: true },
        { k: 'no', label: 'Number', placeholder: 'Auto-generated if blank' },
        { k: 'value', label: 'Value (₹ / month)', type: 'number', min: 0 },
        { k: 'status', label: 'Status', type: 'select', options: [['draft', 'Draft'], ['sent', 'Sent'], ['viewed', 'Viewed'], ['accepted', 'Accepted'], ['declined', 'Declined']] },
        { k: 'sent', label: 'Sent on', type: 'date' },
        { k: 'expires', label: 'Expires on', type: 'date' },
        { k: 'views', label: 'Views', type: 'number', min: 0 },
        { k: 'ownerId', label: 'Owner', type: 'select', options: 'users', empty: 'Unassigned' },
      ],
    },
    invoices: {
      title: 'Invoice',
      defaults: () => ({ issued: fmt.isoDate(), due: plusDays(15), method: 'Bank transfer' }),
      fields: [
        { k: 'clientId', label: 'Client', type: 'select', options: 'clients', required: true },
        { k: 'no', label: 'Invoice number', placeholder: 'Auto-generated if blank' },
        { k: 'desc', label: 'Description', full: true, placeholder: 'November retainer' },
        { k: 'amount', label: 'Amount (₹)', type: 'number', min: 0, required: true },
        { k: 'issued', label: 'Issued', type: 'date', required: true },
        { k: 'due', label: 'Due', type: 'date', required: true },
        { k: 'paid', label: 'Paid on (leave blank if unpaid)', type: 'date' },
        { k: 'method', label: 'Payment method (when paid)', type: 'select', options: METHODS },
      ],
    },
    payments: {
      title: 'Payment',
      defaults: () => ({ date: fmt.isoDate(), method: 'Bank transfer', status: 'settled' }),
      fields: [
        { k: 'clientId', label: 'Client', type: 'select', options: 'clients', required: true },
        { k: 'ref', label: 'Reference / invoice no.' },
        { k: 'amount', label: 'Amount (₹)', type: 'number', min: 0, required: true },
        { k: 'date', label: 'Date', type: 'date', required: true },
        { k: 'method', label: 'Method', type: 'select', options: METHODS },
        { k: 'status', label: 'Status', type: 'select', options: [['settled', 'Settled'], ['processing', 'Processing'], ['failed', 'Failed']] },
      ],
    },
    finance: {
      title: 'Monthly financials',
      defaults: () => ({ month: fmt.isoDate().slice(0, 8) + '01' }),
      fields: [
        { k: 'month', label: 'Month (any day in it)', type: 'date', required: true },
        { k: 'revenue', label: 'Revenue (₹)', type: 'number', min: 0 },
        { k: 'expenses', label: 'Expenses (₹)', type: 'number', min: 0 },
        { k: 'collected', label: 'Cash collected (₹)', type: 'number', min: 0 },
        { k: 'count', label: 'Payments received', type: 'number', min: 0 },
      ],
    },
    saved_reports: {
      title: 'Saved report',
      defaults: () => ({ fmt: 'PDF', sched: 'On demand' }),
      fields: [
        { k: 'name', label: 'Report name', required: true, full: true },
        { k: 'sched', label: 'Schedule', placeholder: 'Every Monday · Email' },
        { k: 'fmt', label: 'Format', type: 'select', options: ['PDF', 'XLSX', 'CSV'] },
      ],
    },
    users: {
      title: 'Team member',
      defaults: () => ({ role: 'member', active: true }),
      fields: [
        { k: 'name', label: 'Full name', required: true },
        { k: 'initials', label: 'Initials', placeholder: 'Auto from name' },
        { k: 'email', label: 'Login email', type: 'email' },
        { k: 'title', label: 'Job title' },
        { k: 'role', label: 'Role', type: 'select', options: [['admin', 'Admin — everything incl. users'], ['manager', 'Manager — can delete records'], ['member', 'Member — add & edit'], ['viewer', 'Viewer — read only']] },
        { k: 'password', label: 'Set password', type: 'password', placeholder: 'Min 8 chars · blank keeps current' },
        { k: 'active', label: 'Active (can sign in)', type: 'checkbox' },
      ],
    },
  };

  /* ---------------- Lookup lists for <select> fields ---------------- */
  const lookupCache = {};
  function lookup(kind) {
    if (!lookupCache[kind]) {
      lookupCache[kind] = API.raw.list(kind).then((rows) =>
        rows.map((r) => [String(r.id), kind === 'users' ? `${r.name} (${r.initials})` : r.name]));
    }
    return lookupCache[kind];
  }

  /* ---------------- Modal form ---------------- */
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${fmt.isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function renderField(f, value) {
    const id = 'f_' + f.k;
    const req = f.required ? ' required' : '';
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    const v = value === undefined || value === null ? '' : value;
    let input;
    let opts = f.options;
    if (typeof opts === 'string') opts = await lookup(opts);
    switch (f.type) {
      case 'select': {
        const list = (opts || []).map((o) => (Array.isArray(o) ? o : [o, o]));
        const empty = f.required ? '<option value="">Select…</option>' : `<option value="">${esc(f.empty || '—')}</option>`;
        input = `<select id="${id}" name="${f.k}"${req}>${empty}${list.map(([val, label]) =>
          `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
        break;
      }
      case 'multi': {
        const chosen = (Array.isArray(v) ? v : String(v).split(',')).map(String);
        input = `<div class="crm-multi">${opts.map(([val, label]) =>
          `<label><input type="checkbox" name="${f.k}" value="${esc(val)}"${chosen.includes(String(val)) ? ' checked' : ''}> ${esc(label)}</label>`).join('')}</div>`;
        break;
      }
      case 'textarea':
        input = `<textarea id="${id}" name="${f.k}" rows="3"${req}${ph}>${esc(v)}</textarea>`;
        break;
      case 'checkbox':
        return `<label class="crm-check${f.full ? ' full' : ''}"><input type="checkbox" name="${f.k}"${v ? ' checked' : ''}> ${esc(f.label)}</label>`;
      case 'datetime':
        input = `<input id="${id}" type="datetime-local" name="${f.k}" value="${esc(toLocalInput(v))}"${req}>`;
        break;
      default: {
        const t = f.type || 'text';
        const extra = ['min', 'max', 'step'].map((a) => (f[a] !== undefined ? ` ${a}="${f[a]}"` : '')).join('');
        const step = t === 'number' && f.step === undefined ? ' step="any"' : '';
        input = `<input id="${id}" type="${t}" name="${f.k}" value="${t === 'password' ? '' : esc(v)}"${req}${ph}${extra}${step}${t === 'password' ? ' autocomplete="new-password"' : ''}>`;
      }
    }
    return `<div class="crm-field${f.full ? ' full' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}</div>`;
  }

  function readForm(form, def) {
    const out = {};
    for (const f of def.fields) {
      if (f.type === 'multi') {
        out[f.k] = [...form.querySelectorAll(`[name="${f.k}"]:checked`)].map((i) => i.value);
      } else if (f.type === 'checkbox') {
        out[f.k] = form.querySelector(`[name="${f.k}"]`).checked;
      } else {
        const val = form.querySelector(`[name="${f.k}"]`).value;
        if (f.type === 'password' && !val) continue;
        out[f.k] = f.type === 'datetime' && val ? new Date(val).toISOString() : val;
      }
    }
    return out;
  }

  /**
   * Open an add/edit form.
   *   CRM.form('leads')                       → create
   *   CRM.form('leads', { id: 5 })            → edit (+ delete button)
   *   CRM.form('tasks', { values: {col:'review'} })  → create with preset values
   *   onSaved(row) — optional; default reloads the page.
   */
  async function openForm(resource, { id = null, values = {}, onSaved = null, onDeleted = null } = {}) {
    const def = FORMS[resource];
    if (!def) throw new Error('No form for ' + resource);
    if (!CRM.can('member') || (resource === 'users' && !CRM.can('admin'))) {
      return toast('Your role is read-only for this section.', 'error');
    }
    let data;
    try {
      data = id ? await API.raw.get(resource, id) : Object.assign({}, def.defaults ? def.defaults() : {}, values);
    } catch (e) {
      return toast(e.message, 'error');
    }
    const fieldsHtml = (await Promise.all(def.fields.map((f) => renderField(f, data[f.k])))).join('');
    const canDelete = id && CRM.can(resource === 'users' ? 'admin' : 'manager');

    const wrap = document.createElement('div');
    wrap.className = 'crm-modal-backdrop';
    wrap.innerHTML = `
      <form class="crm-modal" novalidate>
        <div class="crm-modal-head"><h3>${id ? 'Edit' : 'New'} ${esc(def.title)}</h3><button type="button" class="crm-x" aria-label="Close">×</button></div>
        <div class="crm-form-grid">${fieldsHtml}</div>
        <div class="crm-modal-error" hidden></div>
        <div class="crm-modal-foot">
          ${canDelete ? '<button type="button" class="btn crm-danger" data-del>Delete</button>' : ''}
          <span style="flex:1"></span>
          <button type="button" class="btn btn-outline" data-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary">${id ? 'Save changes' : 'Create ' + esc(def.title)}</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const errBox = wrap.querySelector('.crm-modal-error');
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('.crm-x').onclick = close;
    wrap.querySelector('[data-cancel]').onclick = close;
    const first = form.querySelector('input:not([type=checkbox]),select,textarea');
    if (first) first.focus();

    const showErr = (msg) => { errBox.textContent = msg; errBox.hidden = false; };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const missing = def.fields.filter((f) => f.required && !form.querySelector(`[name="${f.k}"]`).value.trim());
      if (missing.length) return showErr('Please fill in: ' + missing.map((f) => f.label).join(', '));
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const payload = Object.assign({}, !id ? values : {}, readForm(form, def));
        const row = id ? await API.update(resource, id, payload) : await API.create(resource, payload);
        delete lookupCache[resource];
        close();
        const msg = `${def.title} ${id ? 'updated' : 'created'}.`;
        if (onSaved) { await onSaved(row); toast(msg); } else { flash(msg); location.reload(); }
      } catch (err) {
        showErr(err.message);
        btn.disabled = false;
      }
    });

    const del = wrap.querySelector('[data-del]');
    if (del) {
      del.onclick = async () => {
        if (!confirm(`Delete this ${def.title.toLowerCase()}? This cannot be undone.`)) return;
        try {
          await API.remove(resource, id);
          delete lookupCache[resource];
          close();
          const msg = `${def.title} deleted.`;
          if (onDeleted) { await onDeleted(); toast(msg); } else { flash(msg); location.reload(); }
        } catch (err) { showErr(err.message); }
      };
    }
  }

  /* ---------------- CSV export ---------------- */
  function downloadCSV(filename, rows, columns) {
    const cell = (v) => {
      const s = v === null || v === undefined ? '' : unesc(String(v));
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.map((c) => cell(c[1])).join(',')]
      .concat(rows.map((r) => columns.map((c) => cell(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------- Printable documents (Save as PDF) ---------------- */
  // `rows` values must already be HTML-safe (API data is escaped on arrival).
  function printDoc({ title, number, status, to, meta = [], lines = [], total, note }) {
    const w = window.open('', '_blank');
    if (!w) return toast('Please allow pop-ups to download the PDF.', 'error');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title} ${number}</title>
      <style>
        body{font-family:Inter,'Segoe UI',Arial,sans-serif;color:#171532;margin:48px;font-size:14px}
        .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px}
        .brand{display:flex;gap:10px;align-items:center}.mark{width:38px;height:38px;border-radius:9px;background:#5145E8;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
        h1{margin:0;font-size:26px;letter-spacing:.5px}.muted{color:#6E7086}.status{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:99px;background:#EEEDFF;color:#5145E8;font-weight:700;font-size:12px}
        .grid{display:flex;gap:60px;margin-bottom:32px}.grid b{display:block;font-size:11px;letter-spacing:.6px;color:#9C9DB3;margin-bottom:4px}
        table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;letter-spacing:.6px;color:#9C9DB3;border-bottom:2px solid #E6E7F2;padding:10px 0}
        td{padding:14px 0;border-bottom:1px solid #E6E7F2}.r{text-align:right}.total td{font-weight:700;font-size:16px;border-bottom:0}
        .note{margin-top:40px;color:#6E7086;font-size:12.5px}
        @media print{body{margin:24px}}
      </style></head><body>
      <div class="top"><div class="brand"><div class="mark">OA</div><div><b>OmniAgency</b><div class="muted" style="font-size:12px">Enterprise CRM</div></div></div>
        <div style="text-align:right"><h1>${title.toUpperCase()}</h1><div class="muted">${number}</div>${status ? `<div class="status">${status}</div>` : ''}</div></div>
      <div class="grid"><div><b>${title === 'Invoice' ? 'BILL TO' : 'PREPARED FOR'}</b>${to}</div>${meta.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join('')}</div>
      <table><thead><tr><th>DESCRIPTION</th><th class="r">AMOUNT</th></tr></thead><tbody>
        ${lines.map(([d, a]) => `<tr><td>${d}</td><td class="r">${a}</td></tr>`).join('')}
        <tr class="total"><td class="r">Total</td><td class="r">${total}</td></tr></tbody></table>
      ${note ? `<div class="note">${note}</div>` : ''}
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  /* ---------------- Top bar, sidebar, menus ---------------- */
  const PAGES = [
    ['index.html', 'Dashboard — Onboarding Hub'], ['03-command-center.html', 'Command Center'], ['02-campaign-lab.html', 'Campaign Lab'],
    ['leads.html', 'Leads'], ['sales-pipeline.html', 'Sales Pipeline'], ['follow-ups.html', 'Follow-ups'], ['clients.html', 'Clients'],
    ['services.html', 'Services'], ['onboarding.html', 'Onboarding'], ['client-approvals.html', 'Client Approvals'],
    ['campaigns.html', 'Campaigns'], ['content-calendar.html', 'Content Calendar'], ['projects.html', 'Projects'], ['tasks.html', 'Tasks'],
    ['proposals.html', 'Proposals'], ['invoices.html', 'Invoices'], ['payments.html', 'Payments'], ['reports.html', 'Reports'],
    ['team.html', 'Team & Access'],
  ];
  const QUICK_ADD = [['leads', 'Lead'], ['deals', 'Deal'], ['tasks', 'Task'], ['followups', 'Follow-up'], ['clients', 'Client'], ['invoices', 'Invoice'], ['proposals', 'Proposal'], ['posts', 'Content post']];

  function popover(anchor, html) {
    document.querySelectorAll('.crm-pop').forEach((p) => p.remove());
    const pop = document.createElement('div');
    pop.className = 'crm-pop';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = r.bottom + 8 + 'px';
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); }
    }), 0);
    return pop;
  }

  function openPalette() {
    if (document.querySelector('.crm-palette')) return;
    const items = PAGES.filter(([h]) => h !== 'team.html' || CRM.can('admin')).map(([href, label]) => ({ label: 'Go to ' + label, run: () => (location.href = href) }))
      .concat(CRM.can('member') ? QUICK_ADD.map(([r, l]) => ({ label: 'Add ' + l, run: () => openForm(r) })) : [])
      .concat([{ label: 'Sign out', run: logout }]);
    const wrap = document.createElement('div');
    wrap.className = 'crm-modal-backdrop crm-palette';
    wrap.innerHTML = '<div class="crm-modal" style="max-width:520px"><input class="crm-palette-input" placeholder="Type a page or action…"><div class="crm-palette-list"></div></div>';
    document.body.appendChild(wrap);
    const input = wrap.querySelector('input');
    const list = wrap.querySelector('.crm-palette-list');
    let sel = 0, shown = items;
    const close = () => wrap.remove();
    const draw = () => {
      const q = input.value.toLowerCase();
      shown = items.filter((i) => i.label.toLowerCase().includes(q));
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.map((i, n) => `<div class="crm-palette-item${n === sel ? ' sel' : ''}" data-n="${n}">${esc(i.label)}</div>`).join('') || '<div class="crm-palette-empty">No matches</div>';
    };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && shown[sel]) { close(); shown[sel].run(); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('click', (e) => { const it = e.target.closest('[data-n]'); if (it) { close(); shown[+it.dataset.n].run(); } });
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    draw();
    input.focus();
  }

  async function logout() {
    try { await request('auth/logout', { method: 'POST' }); } catch (e) {}
    location.replace('login.html');
  }

  function changePassword() {
    const wrap = document.createElement('div');
    wrap.className = 'crm-modal-backdrop';
    wrap.innerHTML = `<form class="crm-modal" style="max-width:420px">
      <div class="crm-modal-head"><h3>Change password</h3><button type="button" class="crm-x">×</button></div>
      <div class="crm-form-grid">
        <div class="crm-field full"><label>Current password</label><input type="password" name="current" required autocomplete="current-password"></div>
        <div class="crm-field full"><label>New password (min 8 characters)</label><input type="password" name="new" required minlength="8" autocomplete="new-password"></div>
      </div>
      <div class="crm-modal-error" hidden></div>
      <div class="crm-modal-foot"><span style="flex:1"></span><button class="btn btn-primary">Update password</button></div></form>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('.crm-x').onclick = close;
    wrap.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await request('auth/password', { method: 'POST', body: { current: f.current.value, new: f.new.value } });
        close();
        toast('Password updated.');
      } catch (err) {
        const box = wrap.querySelector('.crm-modal-error');
        box.textContent = err.message; box.hidden = false;
      }
    };
  }

  const KIND_COLOR = { success: 'var(--success)', info: 'var(--info)', primary: 'var(--primary)', warning: 'var(--warning)', danger: 'var(--danger)', muted: 'var(--text-faint)' };

  function decorate(user) {
    document.documentElement.classList.add('role-' + user.role);

    document.querySelectorAll('.who').forEach((who) => {
      who.innerHTML = `<div class="avatar">${esc(user.initials)}</div><div class="who-text"><b>${esc(user.name)}</b><span>${esc(user.email || '')}</span></div>`;
      who.style.cursor = 'pointer';
      who.addEventListener('click', () => {
        const pop = popover(who, `
          <div class="crm-pop-head"><b>${esc(user.name)}</b><span>${esc(ROLE_LABEL[user.role])}</span></div>
          ${CRM.can('admin') ? '<a href="team.html">Team &amp; access</a>' : ''}
          <button data-act="pw">Change password</button>
          <button data-act="out" class="danger">Sign out</button>`);
        pop.querySelector('[data-act="pw"]').onclick = () => { pop.remove(); changePassword(); };
        pop.querySelector('[data-act="out"]').onclick = logout;
      });
    });
    document.querySelectorAll('.role-tag').forEach((t) => (t.textContent = ROLE_LABEL[user.role]));
    document.querySelectorAll('.role-select').forEach((rs) => {
      rs.innerHTML = `<span class="dot"></span>${esc(ROLE_LABEL[user.role])}`;
      rs.title = 'Your access level';
    });
    document.querySelectorAll('.role-box-head span:first-child').forEach((s) => (s.textContent = 'SIGNED IN AS'));

    // Sidebar: Team & Access link for admins.
    const groups = document.querySelectorAll('.sidebar .nav-group');
    if (CRM.can('admin') && groups.length && !document.querySelector('.nav-item[href="team.html"]')) {
      const a = document.createElement('a');
      a.className = 'nav-item' + (/team\.html$/.test(location.pathname) ? ' active' : '');
      a.href = 'team.html';
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Team &amp; Access';
      groups[groups.length - 1].appendChild(a);
    }

    // Generic buttons found across the static pages.
    document.querySelectorAll('button').forEach((b) => {
      const label = b.textContent.trim();
      if (label === 'Add Lead' && !b.dataset.create) b.dataset.create = 'leads';
      if (label === 'View Pipeline') b.addEventListener('click', () => (location.href = 'sales-pipeline.html'));
    });

    // Command palette.
    document.querySelectorAll('.topbar .search').forEach((s) => { s.style.cursor = 'pointer'; s.addEventListener('click', openPalette); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    });

    // Notifications bell → latest activity.
    document.querySelectorAll('.topbar .icon-btn').forEach((bell) => bell.addEventListener('click', async () => {
      const pop = popover(bell, '<div class="crm-pop-head"><b>Recent activity</b></div><div class="crm-pop-empty">Loading…</div>');
      pop.style.width = '340px';
      pop.style.left = Math.max(8, bell.getBoundingClientRect().right - 340) + 'px';
      try {
        const rows = await API.list('activity', { limit: 8 });
        pop.innerHTML = '<div class="crm-pop-head"><b>Recent activity</b></div>' + (rows.map((a) => `
          <div class="crm-pop-row"><i style="background:${KIND_COLOR[a.kind] || KIND_COLOR.muted}"></i>
            <div><b>${a.title}</b>${a.detail ? `<span>${a.detail}</span>` : ''}<small>${fmt.ago(a.createdAt)}${a.user ? ' · ' + a.user : ''}</small></div></div>`).join('') || '<div class="crm-pop-empty">No activity yet.</div>');
      } catch (e) { pop.innerHTML = `<div class="crm-pop-empty">${esc(e.message)}</div>`; }
    }));
  }

  // Delegated handlers: any element with data-create / data-edit opens a form.
  // The innermost match wins, so an item inside a clickable container opens itself.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-create],[data-edit]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.edit) {
      if (t.dataset.id) openForm(t.dataset.edit, { id: t.dataset.id });
      return;
    }
    let values = {};
    try { values = t.dataset.values ? JSON.parse(t.dataset.values) : {}; } catch (err) {}
    openForm(t.dataset.create, { values });
  });

  /* ---------------- Boot ---------------- */
  function fatal(msg) {
    document.documentElement.classList.remove('crm-auth-pending');
    const bar = document.createElement('div');
    bar.className = 'crm-fatal';
    bar.innerHTML = `<b>Cannot reach the CRM server.</b> ${esc(msg)}`;
    document.body.prepend(bar);
  }

  const CRM = {
    API, fmt, esc, unesc, toast, flash, form: openForm, FORMS, downloadCSV, printDoc, logout, lookup,
    user: null,
    can: (min) => !!CRM.user && ROLE_RANK[CRM.user.role] >= ROLE_RANK[min],
  };

  CRM.ready = IS_LOGIN
    ? Promise.resolve(null)
    : request('auth/status', { raw: true }).then(
      (s) => {
        if (!s.user) return toLogin();
        CRM.user = s.user;
        const boot = () => { decorate(s.user); document.documentElement.classList.remove('crm-auth-pending'); showFlash(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
        return s.user;
      },
      (err) => {
        const show = () => fatal(err.message);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
        return new Promise(() => {}); // page scripts wait forever; the error bar explains why
      });

  /** Run a page's async loader with consistent error reporting. */
  CRM.page = async (fn) => {
    await CRM.ready;
    try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Something went wrong.', 'error'); }
  };

  window.API = API;
  window.CRM = CRM;
})();
