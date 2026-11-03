/* =====================================================================
   Creative Advs CRM — shared front-end runtime
   - API client (talks to api/index.php, served by server.js)
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

  // The signed-in user, remembered for this tab so moving between pages shows the page at once
  // instead of a loading screen. It only shapes the UI: the server still checks every request.
  const USER_KEY = 'crm-user';
  const cachedUser = (() => {
    if (IS_LOGIN) { try { sessionStorage.removeItem(USER_KEY); } catch (e) {} return null; }
    try { const u = JSON.parse(sessionStorage.getItem(USER_KEY)); return u && u.id && u.role ? u : null; } catch (e) { return null; }
  })();
  const rememberUser = (u) => { try { if (u) sessionStorage.setItem(USER_KEY, JSON.stringify(u)); else sessionStorage.removeItem(USER_KEY); } catch (e) {} };

  if (!IS_LOGIN && !cachedUser) document.documentElement.classList.add('crm-auth-pending');

  // Page entrance animation (app.css). Only while a page opens, so later re-renders don't replay it.
  const root = document.documentElement;
  let enterTimer = null;
  function playEntrance() {
    root.classList.remove('crm-enter');
    void root.offsetWidth; // restart the CSS animations
    root.classList.add('crm-enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => root.classList.remove('crm-enter'), 900);
  }
  playEntrance();
  // Browsers with cross-document view transitions animate the whole page change themselves.
  window.addEventListener('pagereveal', (e) => { if (e.viewTransition) root.classList.add('crm-vt'); });
  // Coming back with the Back button from the browser cache: show the page, not the faded-out state.
  window.addEventListener('pageshow', (e) => { if (e.persisted) root.classList.remove('crm-leaving'); });

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
  const REQUEST_TIMEOUT_MS = 20000;
  const here = () => location.pathname.split('/').pop() + location.search;

  // `expired` = the user was signed in on this page and the server has since ended the session.
  function toLogin(expired) {
    rememberUser(null);
    const next = here();
    const qs = new URLSearchParams();
    if (next && next !== 'login.html') qs.set('next', next);
    if (expired) qs.set('reason', 'expired');
    location.replace('login.html' + (qs.toString() ? '?' + qs : ''));
    return new Promise(() => {}); // halt the caller while navigating
  }

  // Thin progress bar along the top while any API request is in flight.
  let inFlight = 0, barTimer = null;
  function busy(delta) {
    inFlight = Math.max(0, inFlight + delta);
    let bar = document.querySelector('.crm-progress');
    if (!bar && document.body) { bar = document.createElement('div'); bar.className = 'crm-progress'; document.body.appendChild(bar); }
    if (!bar) return;
    clearTimeout(barTimer);
    if (inFlight) { bar.classList.remove('done'); bar.classList.add('on'); }
    else { bar.classList.add('done'); barTimer = setTimeout(() => bar.classList.remove('on', 'done'), 350); }
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
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    busy(1);
    try {
      res = await fetch(`${API_BASE}?${qs}`, {
        method: httpMethod, headers, credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      if (location.protocol === 'file:') {
        throw new Error('The CRM was opened as a file. Start the server (npm start, or double-click start-crm.bat) and open it in the browser instead.');
      }
      throw new Error(e.name === 'AbortError'
        ? 'The server is taking too long to respond. Please try again.'
        : navigator.onLine === false ? "You're offline — reconnect and try again." : 'Network error — check your connection and try again.');
    } finally {
      clearTimeout(timer);
      busy(-1);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON (e.g. a static file server) */ }
    if (res.status === 401 && !route.startsWith('auth/')) return toLogin(!!(window.CRM && window.CRM.user));
    if (res.status === 503 && data && data.details && data.details.maintenance && !IS_LOGIN) {
      location.replace('maintenance.html?next=' + encodeURIComponent(here()));
      return new Promise(() => {});
    }
    if (!res.ok || data === null) {
      // A 200 that isn't JSON means api/index.php was sent as a plain file: the CRM server isn't
      // running (typical with VS Code Live Server or other static servers).
      const noServer = res.ok && data === null;
      const err = new Error((data && data.error) || (noServer
        ? 'The CRM server is not running here, so there is no database. Start it with "npm start" (or double-click start-crm.bat) and open the address it prints. Live Server and similar tools cannot run it.'
        : `Server error (${res.status}). Is the CRM app running and are its database settings correct?`));
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
      defaults: () => ({ status: 'active', health: 75, color1: '#5CC9A0', color2: '#0E7A5F', ownerId: CRM.user && CRM.user.id }),
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
      noCopy: ['no', 'views'],
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
      noCopy: ['no', 'paid'],
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
      noDuplicate: true, // one row per month
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
        { k: 'password', label: 'Set password', type: 'password', placeholder: '8+ chars, letter + number · blank keeps current' },
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
        // Keep a value that isn't in the list (imported data, an older option, an inactive user),
        // otherwise saving the form would silently clear it.
        if (v !== '' && !list.some(([val]) => String(val) === String(v))) list.unshift([v, v]);
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
   *   Edit forms also get a Duplicate button: it reopens as a new record
   *   pre-filled with the current values (minus `noCopy` fields).
   *   onSaved(row) — optional; default reloads the page.
   */
  async function openForm(resource, { id = null, values = {}, onSaved = null, onDeleted = null, copy = false } = {}) {
    const def = FORMS[resource];
    if (!def) throw new Error('No form for ' + resource);
    // Read-only roles can open a record to see its details, but not create or change anything.
    const readOnly = !CRM.can('member') || (resource === 'users' && !CRM.can('admin'));
    if (readOnly && !id) return toast('Your role is read-only for this section.', 'error');
    let data;
    try {
      data = id ? await API.raw.get(resource, id) : Object.assign({}, def.defaults ? def.defaults() : {}, values);
    } catch (e) {
      return toast(e.message, 'error');
    }
    const fieldsHtml = (await Promise.all(def.fields.map((f) => renderField(f, data[f.k])))).join('');
    const canDelete = !readOnly && id && CRM.can(resource === 'users' ? 'admin' : 'manager');
    const canDuplicate = !readOnly && id && resource !== 'users' && !def.noDuplicate;

    const wrap = document.createElement('div');
    wrap.className = 'crm-modal-backdrop';
    wrap.innerHTML = `
      <form class="crm-modal" novalidate>
        <div class="crm-modal-head"><h3>${readOnly ? 'View' : id ? 'Edit' : copy ? 'Duplicate' : 'New'} ${esc(def.title)}</h3><button type="button" class="crm-x" aria-label="Close">×</button></div>
        <div class="crm-form-grid">${fieldsHtml}</div>
        <div class="crm-modal-error" hidden></div>
        <div class="crm-modal-foot">
          ${canDelete ? '<button type="button" class="btn crm-danger" data-del>Delete</button>' : ''}
          ${canDuplicate ? '<button type="button" class="btn btn-ghost" data-dup title="Create a new record with these values"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Duplicate</button>' : ''}
          <span style="flex:1"></span>
          ${readOnly ? '<span class="crm-hint">Your role can view this record but not change it.</span>' : ''}
          <button type="button" class="btn btn-outline" data-cancel>${readOnly ? 'Close' : 'Cancel'}</button>
          ${readOnly ? '' : `<button type="submit" class="btn btn-primary">${id ? 'Save changes' : 'Create ' + esc(def.title)}</button>`}
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
    if (readOnly) {
      form.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });
      form.addEventListener('submit', (e) => e.preventDefault());
      return;
    }
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

    const dup = wrap.querySelector('[data-dup]');
    if (dup) {
      dup.onclick = () => {
        // Copy what's on screen (including unsaved edits), drop unique fields, mark the name as a copy.
        const copied = readForm(form, def);
        (def.noCopy || []).forEach((k) => delete copied[k]);
        const nameField = def.fields.find((f) => !f.type || f.type === 'text');
        if (nameField && copied[nameField.k]) copied[nameField.k] += ' (copy)';
        close();
        openForm(resource, { values: copied, onSaved, copy: true });
      };
    }

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
        .brand{display:flex;gap:10px;align-items:center}.mark{width:40px;height:40px;flex-shrink:0}
        h1{margin:0;font-size:26px;letter-spacing:.5px}.muted{color:#6E7086}.status{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:99px;background:#E3F4EC;color:#0E7A5F;font-weight:700;font-size:12px}
        .grid{display:flex;gap:60px;margin-bottom:32px}.grid b{display:block;font-size:11px;letter-spacing:.6px;color:#9C9DB3;margin-bottom:4px}
        table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;letter-spacing:.6px;color:#9C9DB3;border-bottom:2px solid #E6E7F2;padding:10px 0}
        td{padding:14px 0;border-bottom:1px solid #E6E7F2}.r{text-align:right}.total td{font-weight:700;font-size:16px;border-bottom:0}
        .note{margin-top:40px;color:#6E7086;font-size:12.5px}
        @media print{body{margin:24px}}
      </style></head><body>
      <div class="top"><div class="brand"><svg class="mark" viewBox="166 279 572 572" aria-hidden="true"><path d="M407 289H534L633 548C590 543 550 545 510 552L470 453L424 577C360 600 300 640 254 690Z" fill="#202020"/><path d="M200 839C290 650 470 560 651 593L703 729C590 680 430 700 340 835Z" fill="#29A89F"/></svg><div><b>Creative Advs</b><div class="muted" style="font-size:12px">Ideas to Impact</div></div></div>
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

  /**
   * Turns a "SORT BY: …" label into a working menu.
   *   CRM.sortMenu(el, [['date', 'Target Launch Date'], ['pct', 'Completion']], 'date', (key) => rerender(key))
   */
  function sortMenu(el, options, current, onChange, prefix = 'SORT BY') {
    if (!el) return;
    const chev = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
    const label = () => { el.innerHTML = `${prefix}: ${esc(options.find(([k]) => k === current)[1])} ${chev}`; };
    label();
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.style.cursor = 'pointer';
    el.title = 'Change sort order';
    el.addEventListener('click', () => {
      const pop = popover(el, options.map(([k, l]) => `<button data-sort="${esc(k)}"${k === current ? ' class="on"' : ''}>${k === current ? '✓ ' : ''}${esc(l)}</button>`).join(''));
      pop.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
        pop.remove();
        current = b.dataset.sort;
        label();
        onChange(current);
      }));
    });
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
    rememberUser(null);
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
        <div class="crm-field full"><label>New password</label><input type="password" name="new" required minlength="8" maxlength="72" autocomplete="new-password"><small class="crm-hint">8+ characters, with a letter and a number or symbol. Other devices will be signed out.</small></div>
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
        toast('Password updated. Other devices have been signed out.');
      } catch (err) {
        const box = wrap.querySelector('.crm-modal-error');
        box.textContent = err.message; box.hidden = false;
      }
    };
  }

  const KIND_COLOR = { success: 'var(--success)', info: 'var(--info)', primary: 'var(--primary)', warning: 'var(--warning)', danger: 'var(--danger)', muted: 'var(--text-faint)' };

  // Brand tagline + script beside every page header (the leaf artwork itself is pure CSS).
  const HERO_QUOTE = `<div class="hero-quote" aria-hidden="true">
    <div class="hero-title">Turning<br><em>Ideas</em> into <em>Impact</em></div>
    <div class="hero-tags">PEOPLE <i></i> PROCESS <i></i> PROGRESS</div>
  </div>`;
  const HERO_SCRIPT = '<div class="hero-script" aria-hidden="true">Grow<br>Connect<br>Create Impact</div>';

  function decorateHeroes() {
    document.querySelectorAll('.page-head:not(.page-hero)').forEach((head) => {
      head.classList.add('page-hero');
      head.insertAdjacentHTML('afterbegin', HERO_SCRIPT);
      const actions = head.querySelector(':scope > .page-actions');
      if (actions) actions.insertAdjacentHTML('beforebegin', HERO_QUOTE);
      else head.insertAdjacentHTML('beforeend', HERO_QUOTE);
    });
  }

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
    quickCreate();
    demoDataControl();

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
    API, fmt, esc, unesc, toast, flash, form: openForm, FORMS, downloadCSV, printDoc, logout, lookup, sortMenu,
    user: null,
    can: (min) => !!CRM.user && ROLE_RANK[CRM.user.role] >= ROLE_RANK[min],
  };

  // Stat figures are filled in by each page after load; shrink any that would overflow their card.
  function fitFigures() {
    const fit = (el) => {
      el.style.fontSize = '';
      const room = el.parentElement.clientWidth;
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.getBoundingClientRect().width > room && size > 16) el.style.fontSize = --size + 'px';
    };
    const els = [...document.querySelectorAll('.stat-value, .kpi-value')];
    if (!els.length) return;
    const all = () => els.forEach(fit);
    const mo = new MutationObserver((recs) => recs.forEach((r) => fit(r.target.nodeType === 1 ? r.target : r.target.parentElement)));
    els.forEach((el) => mo.observe(el, { childList: true, characterData: true, subtree: true }));
    if (window.ResizeObserver) new ResizeObserver(all).observe(document.querySelector('.content') || document.body);
    if (document.fonts) document.fonts.ready.then(all);
    all();
  }

  // Table ⇄ Grid switch for every list card. Rows are rendered later by each page, so a
  // MutationObserver copies the column headings onto each cell (shown as labels in grid view).
  const VIEW_ICONS = {
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
  };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  function setupGridViews() {
    document.querySelectorAll('.table-card').forEach((card) => {
      const toolbar = card.querySelector(':scope > .table-toolbar');
      const tables = card.querySelectorAll('table.data-table');
      const body = tables.length === 1 && tables[0].querySelector('tbody[id]');
      if (!toolbar || !body || card.querySelector('.view-toggle')) return;

      const labels = [...tables[0].querySelectorAll('thead th')].map((th) => th.textContent.trim());
      const label = () => body.querySelectorAll('tr').forEach((tr) => {
        let i = 0;
        [...tr.children].forEach((td) => {
          if (!td.hasAttribute('data-label')) td.setAttribute('data-label', td.colSpan > 1 ? '' : labels[i] || '');
          i += td.colSpan || 1;
        });
      });
      new MutationObserver(label).observe(body, { childList: true });
      label();

      const key = 'crm-view:' + (location.pathname.split('/').pop() || 'index.html') + ':' + body.id;
      const toggle = document.createElement('div');
      toggle.className = 'view-toggle';
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'Layout');
      toggle.innerHTML = ['table', 'grid'].map((v) =>
        `<button type="button" data-view="${v}" title="${v === 'table' ? 'Table' : 'Grid'} view" aria-label="${v === 'table' ? 'Table' : 'Grid'} view">${VIEW_ICONS[v]}</button>`).join('');
      const set = (v, save) => {
        card.classList.toggle('is-grid', v === 'grid');
        toggle.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
        if (save) store.set(key, v);
      };
      toggle.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) set(b.dataset.view, true); });
      (toolbar.querySelector('.toolbar-actions') || toolbar).appendChild(toggle);
      // Phones default to cards; otherwise use the saved choice or the table.
      set(store.get(key) || (innerWidth < 760 ? 'grid' : 'table'), false);
    });
  }

  // Floating "Quick create" button: add any common record from any page.
  const QUICK_ICONS = {
    leads: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
    deals: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/>',
    tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    followups: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    clients: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    invoices: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/>',
    proposals: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    posts: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/>',
  };

  function quickCreate() {
    if (!CRM.can('member') || document.querySelector('.crm-fab')) return;
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'crm-fab';
    fab.setAttribute('aria-haspopup', 'menu');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg><span>Quick create</span>';
    document.body.appendChild(fab);
    document.documentElement.classList.add('has-fab');
    // Keep the outside-click handler from closing the menu just before this click toggles it.
    fab.addEventListener('mousedown', (e) => e.stopPropagation());
    fab.addEventListener('click', () => {
      if (document.querySelector('.crm-quick')) { document.querySelector('.crm-quick').remove(); return; }
      const pop = popover(fab, `<div class="crm-pop-head"><b>Quick create</b><span>Add a record without leaving this page</span></div>
        <div class="crm-quick-grid">${QUICK_ADD.map(([r, l]) =>
          `<button type="button" data-create="${r}"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${QUICK_ICONS[r] || ''}</svg></i>${l}</button>`).join('')}</div>`);
      pop.classList.add('crm-quick');
      // Open upwards from the button.
      const r = fab.getBoundingClientRect();
      pop.style.top = Math.max(8, r.top - pop.offsetHeight - 10) + 'px';
      pop.style.left = Math.max(8, r.right - pop.offsetWidth) + 'px';
      pop.addEventListener('click', (e) => { if (e.target.closest('[data-create]')) pop.remove(); });
    });
  }

  // Dashboard "Load / Remove demo data" button (admins). Demo rows are tracked server-side,
  // so removing them never touches records people created themselves.
  async function demoDataControl() {
    const buttons = [...document.querySelectorAll('[data-demo-control]')];
    if (!buttons.length || !CRM.can('admin')) return;
    // If the server can't report status, still show the button; clicking it explains what's wrong.
    let status, statusError = null;
    try { status = await request('demo/status', { raw: true }); } catch (e) { statusError = e; status = { loaded: false, empty: false }; }
    const explain = (e) => (e.status === 404
      ? 'The server is missing the demo-data feature. Deploy the latest version of the CRM, then reload this page.'
      : e.message);
    const run = async (btn) => {
      const loading = !status.loaded;
      const msg = loading
        ? 'Add free demo data? This fills the CRM with a sample agency (clients, leads, deals, invoices, campaigns and more) dated around today. You can remove it all later with one click.'
        : 'Remove all demo data? Only the sample records added by "Load demo data" are deleted. Your own records stay.';
      if (!confirm(msg)) return;
      document.querySelectorAll('[data-demo-control]').forEach((b) => { b.disabled = true; });
      const label = btn.querySelector('span');
      if (label) label.textContent = loading ? 'Loading demo data…' : 'Removing demo data…';
      try {
        const r = await request(loading ? 'demo/load' : 'demo/remove', { method: 'POST', body: {}, raw: true });
        flash(loading ? `Demo data loaded — ${r.rows} sample records added.` : `Demo data removed — ${r.rows} sample records deleted.`);
        location.reload();
      } catch (e) {
        toast(explain(e), 'error');
        document.querySelectorAll('[data-demo-control]').forEach((b) => { b.disabled = false; });
        sync();
      }
    };
    const sync = () => buttons.forEach((b) => {
      const label = b.querySelector('span');
      if (label) label.textContent = status.loaded ? 'Remove demo data' : 'Load demo data';
      b.classList.toggle('is-demo-loaded', status.loaded);
      b.title = status.loaded ? 'Delete the sample records added by the demo' : 'Fill the CRM with a realistic sample agency';
      b.hidden = false;
    });
    buttons.forEach((b) => b.addEventListener('click', () => run(b)));
    sync();
    if (statusError) console.warn('Demo data status check failed:', statusError.message);

    // Brand-new workspace: invite the admin to start from the demo.
    const head = document.querySelector('.page-head');
    if (status.empty && !status.loaded && head && !document.querySelector('.demo-welcome')) {
      const box = document.createElement('div');
      box.className = 'demo-welcome';
      box.innerHTML = `<div class="demo-welcome-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg></div>
        <div class="demo-welcome-body"><b>Your CRM is empty — want to explore it with sample data?</b>
        <span>Load a realistic demo agency in one click: 10 clients, 36 leads, deals, invoices, campaigns, tasks and more. Remove it any time.</span></div>
        <button class="btn btn-primary" type="button">Load free demo data</button>`;
      box.querySelector('button').addEventListener('click', () => run(buttons[0]));
      head.after(box);
    }
  }

  // Phones: a menu button in the top bar slides the sidebar in as a drawer.
  function setupNavDrawer() {
    const bar = document.querySelector('.topbar'), side = document.querySelector('.sidebar');
    if (!bar || !side || bar.querySelector('.nav-toggle')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-toggle';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    bar.prepend(btn);
    const backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    document.body.appendChild(backdrop);
    const set = (open) => {
      document.documentElement.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) (side.querySelector('.nav-item.active') || side.querySelector('a')).focus();
    };
    btn.addEventListener('click', () => set(!document.documentElement.classList.contains('nav-open')));
    backdrop.addEventListener('click', () => set(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.documentElement.classList.contains('nav-open')) { set(false); btn.focus(); } });
  }

  // Pills and tabs are <div>s rendered by each page; make them reachable and usable by keyboard.
  const KEY_TARGETS = '.filter-pill, .tab-strip .view-tab, div.view-tab, .cohort-card';
  function setupKeyboardControls() {
    const mark = (root) => root.querySelectorAll(KEY_TARGETS).forEach((el) => {
      if (el.hasAttribute('tabindex')) return;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
    });
    const root = document.querySelector('.content') || document.body;
    new MutationObserver(() => mark(root)).observe(root, { childList: true, subtree: true });
    mark(root);
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches(KEY_TARGETS)) { e.preventDefault(); e.target.click(); }
    });
  }

  // Persistent banner while the browser is offline; saving needs the server.
  function watchConnection() {
    const show = () => {
      if (document.querySelector('.crm-offline')) return;
      const b = document.createElement('div');
      b.className = 'crm-offline';
      b.setAttribute('role', 'status');
      b.innerHTML = "<b>You're offline.</b> Changes can't be saved until your connection is back.";
      document.body.prepend(b);
    };
    window.addEventListener('offline', show);
    window.addEventListener('online', () => {
      const b = document.querySelector('.crm-offline');
      if (b) { b.remove(); toast('Back online.'); }
    });
    if (navigator.onLine === false) show();
  }

  // Faster, smoother page changes: fetch the next page before the click, and fade the
  // current content out on browsers that can't animate between pages themselves.
  function setupPageTransitions() {
    const isPage = (a) => a && a.href && a.origin === location.origin && /\.html$/.test(a.pathname)
      && (!a.target || a.target === '_self') && !a.hasAttribute('download') && a.pathname !== location.pathname;
    if (window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
      const rules = document.createElement('script');
      rules.type = 'speculationrules';
      rules.textContent = JSON.stringify({ prefetch: [{ source: 'document', where: { href_matches: '/*.html' }, eagerness: 'moderate' }] });
      document.head.appendChild(rules);
    } else {
      const warmed = new Set();
      const warm = (e) => {
        const a = e.target.closest && e.target.closest('a');
        if (!isPage(a) || warmed.has(a.href)) return;
        warmed.add(a.href);
        const l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = a.href;
        document.head.appendChild(l);
      };
      document.addEventListener('mouseover', warm, { passive: true });
      document.addEventListener('touchstart', warm, { passive: true });
    }
    if (!('onpagereveal' in window)) {
      document.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a');
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !isPage(a)) return;
        root.classList.add('crm-leaving');
        setTimeout(() => root.classList.remove('crm-leaving'), 2500); // navigation cancelled or slow: never leave the page faded
      });
    }
  }

  // Runs before sign-in finishes so the brand header shows even if the API is down.
  const pageSetup = () => { decorateHeroes(); fitFigures(); watchConnection(); setupGridViews(); setupNavDrawer(); setupKeyboardControls(); setupPageTransitions(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageSetup); else pageSetup();

  const bootWith = (user) => {
    CRM.user = user;
    const boot = () => {
      decorate(user);
      if (root.classList.contains('crm-auth-pending')) { root.classList.remove('crm-auth-pending'); playEntrance(); }
      showFlash();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    return user;
  };
  const sameUser = (a, b) => ['id', 'name', 'initials', 'email', 'role'].every((k) => a[k] === b[k]);

  CRM.ready = IS_LOGIN
    ? Promise.resolve(null)
    : cachedUser
      ? Promise.resolve(bootWith(cachedUser)).then((u) => {
        // Confirm in the background; a signed-out session or changed role/name reloads properly.
        request('auth/status', { raw: true }).then((s) => {
          if (!s.user) return toLogin(true);
          rememberUser(s.user);
          if (!sameUser(s.user, cachedUser)) location.reload();
        }, () => { /* offline or server error: the page's own requests will report it */ });
        return u;
      })
      : request('auth/status', { raw: true }).then(
      (s) => {
        if (!s.user) return toLogin();
        rememberUser(s.user);
        return bootWith(s.user);
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
