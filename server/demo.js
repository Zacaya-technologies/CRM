'use strict';
/**
 * Free demo data: one click fills the CRM with a realistic sample agency, dated
 * relative to today so dashboards, "this week" and overdue views look alive. Mirrors api/lib/demo.php.
 *
 *   GET  ?r=demo/status   { loaded, rows }
 *   POST ?r=demo/load     insert the demo set (admin)
 *   POST ?r=demo/remove   delete exactly the rows the demo created (admin)
 *
 * Every inserted row is recorded in demo_records, so removal never touches
 * records people created themselves.
 */
const { HttpError, ymd, ymdHis } = require('./util');
const { ONBOARDING_TEMPLATE, nextNumber } = require('./resources');

/** Delete order: children before parents (foreign keys). */
const DEMO_TABLES = [
  'activity', 'payments', 'invoices', 'approvals', 'onboarding_items', 'onboardings', 'milestones',
  'projects', 'tasks', 'content_posts', 'campaigns', 'proposals', 'followups', 'deals', 'leads',
  'services', 'finance_monthly', 'saved_reports', 'clients', 'users',
];

/** Creates the tracking table on first use, so older databases need no manual migration. */
async function ensureDemoTable(ctx) {
  await ctx.q(`CREATE TABLE IF NOT EXISTS demo_records (
    entity VARCHAR(40) NOT NULL,
    row_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (entity, row_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function demoCount(ctx) {
  return Number(await ctx.col('SELECT COUNT(*) FROM demo_records'));
}

async function handleDemo(ctx, action, method) {
  await ctx.requireRole('admin');
  await ensureDemoTable(ctx);
  if (action === 'status') {
    const n = await demoCount(ctx);
    const empty = !(await ctx.col('SELECT 1 FROM clients UNION ALL SELECT 1 FROM leads LIMIT 1'));
    return [200, { loaded: n > 0, rows: n, empty }];
  }
  if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (action === 'load') {
    if ((await demoCount(ctx)) > 0) throw new HttpError(409, 'Demo data is already loaded. Remove it first to load a fresh copy.');
    const rows = await demoLoad(ctx);
    await ctx.logActivity('info', 'Demo data loaded', `${rows} sample records added`, 'demo');
    return [200, { ok: true, rows }];
  }
  if (action === 'remove') {
    const rows = await demoRemove(ctx);
    await ctx.logActivity('muted', 'Demo data removed', `${rows} sample records deleted`, 'demo');
    return [200, { ok: true, rows }];
  }
  throw new HttpError(404, 'Unknown demo action.');
}

async function demoRemove(ctx) {
  // Your own invoices/payments on a demo client would block deleting that client — say which ones.
  const blocking = await ctx.column(`SELECT CONCAT(x.label, ' (', c.name, ')') FROM (
      SELECT i.client_id, i.number AS label FROM invoices i WHERE i.id NOT IN (SELECT row_id FROM demo_records WHERE entity = 'invoices')
      UNION ALL
      SELECT p.client_id, CONCAT('payment ', COALESCE(NULLIF(p.reference, ''), CONCAT('#', p.id))) FROM payments p WHERE p.id NOT IN (SELECT row_id FROM demo_records WHERE entity = 'payments')
    ) x JOIN clients c ON c.id = x.client_id JOIN demo_records d ON d.entity = 'clients' AND d.row_id = c.id LIMIT 6`);
  if (blocking.length) {
    throw new HttpError(409, 'These records you added belong to demo clients: ' + blocking.slice(0, 5).join(', ')
      + (blocking.length > 5 ? ' and more' : '') + '. Delete them (or move them to a real client) first, then remove the demo data.');
  }
  await ctx.begin();
  try {
    let total = 0;
    for (const table of DEMO_TABLES) {
      const ids = (await ctx.column('SELECT row_id FROM demo_records WHERE entity = ?', [table])).map(Number);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const r = await ctx.q(`DELETE FROM \`${table}\` WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
        total += r.affectedRows;
      }
    }
    await ctx.q('DELETE FROM demo_records');
    await ctx.commit();
    return total;
  } catch (e) {
    await ctx.rollback();
    if (e.sqlState === '23000') {
      throw new HttpError(409, 'Some demo clients now have your own invoices or payments attached. Delete or reassign those first, then remove the demo data.');
    }
    throw e;
  }
}

async function demoLoad(ctx) {
  const made = [];
  const add = async (table, row) => {
    const cols = Object.keys(row);
    const r = await ctx.q(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
    const id = Number(r.insertId);
    made.push([table, id]);
    return id;
  };
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };
  const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); };
  const at = (days, hour = 10) => ymdHis(new Date(Math.trunc(todayStart() + days * 86400 + hour * 3600) * 1000));
  const strPad = (n, w) => String(n).padStart(w, '0');
  const year = new Date().getFullYear();

  await ctx.begin();
  try {
    // --- Team (no logins; admins can give them one under Team & Access) ---
    const me = (await ctx.currentUser()).id;
    const team = [me];
    for (const [n, i, r, t] of [['Anika Kapoor', 'AK', 'manager', 'Account Director'], ['Rahul Rao', 'RR', 'member', 'Performance Lead'],
      ['Neha Sharma', 'NS', 'member', 'Content Strategist'], ['Kabir Singh', 'KS', 'member', 'Designer']]) {
      team.push(await add('users', { name: `${n} (demo)`, initials: i, role: r, title: t, active: 1 }));
    }
    const owner = (i) => team[i % team.length];

    // --- Clients ---
    const palette = [['#5CC9A0', '#0E7A5F'], ['#9EDFC2', '#2FB385'], ['#F2B544', '#C9861A'], ['#7FB7F0', '#2563EB'], ['#F49B9B', '#D33B3B']];
    const clientRows = [
      ['Northstar Retail Group', 'Retail', 185000, 92, 'ops@northstar.example'], ['BrightPath Wellness', 'Healthcare', 92000, 78, 'hello@brightpath.example'],
      ['Urban Kitchens', 'F&B', 64000, 54, 'team@urbankitchens.example'], ['Solaris Tech', 'SaaS', 240000, 88, 'growth@solaris.example'],
      ['Elevate Studio', 'Design', 48000, 41, 'studio@elevate.example'], ['Bloom Florals', 'E-commerce', 120000, 70, 'care@bloom.example'],
      ['Pixel Forge', 'Gaming', 75000, 95, 'biz@pixelforge.example'], ['Greenleaf Organics', 'FMCG', 56000, 63, 'brand@greenleaf.example'],
      ['Metro Realty', 'Real Estate', 310000, 82, 'marketing@metrorealty.example'], ['Zenith Fitness', 'Fitness', 88000, 58, 'hq@zenithfit.example'],
    ];
    const clients = [];
    for (let i = 0; i < clientRows.length; i++) {
      const [name, ind, mrr, health, email] = clientRows[i];
      clients.push({
        id: await add('clients', {
          name, industry: ind, email, phone: '+91 98' + strPad(40012300 + i * 7919, 8),
          mrr, health, renewal_date: day(12 + i * 17), status: i === 8 ? 'paused' : 'active',
          owner_id: owner(i), color1: palette[i % 5][0], color2: palette[i % 5][1],
          revenue_ytd: mrr * 10, cost_ytd: Math.round(mrr * 10 * (0.48 + (i % 4) * 0.06)),
        }),
        name, mrr,
      });
    }

    // --- Leads: spread over the last 60 days, more recent ones newer ---
    const people = ['Aditya Verma', 'Meera Kapoor', 'Rohan Shetty', 'Priya Patel', 'Darshan Kumar', 'Kavya Rao', 'Arjun Mehta', 'Sneha Iyer', 'Farhan Ali', 'Ishita Bose', 'Vivek Nair', 'Tara Menon'];
    const firms = ['Coastal Cafe Co', 'Lumen Labs', 'Saffron Spice House', 'Peak Physio', 'Orbit Logistics', 'Kite Learning', 'Nova Interiors', 'Rangoli Textiles', 'Vertex Motors', 'Aqua Pure Water', 'Monsoon Travel', 'Harbor Dental'];
    const sources = ['Meta Lead Ads', 'Meta Lead Ads', 'Meta Lead Ads', 'Google Search Ads (PPC)', 'Google Search Ads (PPC)', 'Website Enquiry Form', 'Website Enquiry Form', 'WhatsApp Inbound Chat', 'Client Referral'];
    const statuses = ['New', 'Contacted', 'Qualified', 'Contacted', 'New', 'Qualified', 'Unqualified', 'Contacted'];
    for (let i = 0; i < 36; i++) {
      const created = at(-((i * 37) % 60) * 0.95, 9 + (i % 8));
      await add('leads', {
        name: people[i % 12], company: firms[(i * 5) % 12], email: people[i % 12].split(' ')[0].toLowerCase() + '@example.com',
        phone: i % 3 ? '+91 99' + strPad(10203040 + i * 1237, 8) : null,
        source: sources[i % 9], score: 96 - ((i * 7) % 61), status: statuses[i % 8],
        owner_id: i % 9 === 4 ? null : owner(i), created_at: created,
      });
    }

    // --- Deals across every stage ---
    const dealNames = ['Performance Retainer', 'Brand Refresh', 'SEO Growth Plan', 'Festive Launch Campaign', 'Social Always-On', 'Website Rebuild', 'Lead Gen Sprint'];
    const stages = ['discovery', 'discovery', 'pitch', 'pitch', 'negotiation', 'won', 'discovery', 'pitch', 'negotiation', 'won', 'lost', 'pitch'];
    for (let i = 0; i < stages.length; i++) {
      await add('deals', {
        name: dealNames[i % 7] + ' — ' + firms[i % 12], industry: ['Retail', 'SaaS', 'Healthcare', 'F&B', 'Education'][i % 5],
        tag: ['Retainer', 'Project', 'Upsell'][i % 3], value: 45000 + i * 17500, stage: stages[i], owner_id: owner(i),
        stage_changed_at: at(-((i * 3) % 25)), created_at: at(-20 - i * 3),
      });
    }

    // --- Follow-ups: some overdue, some today, some upcoming ---
    const fu = [['call', 'Pricing follow-up call'], ['mail', 'Send revised proposal'], ['wa', 'Nudge on creative approval'], ['meet', 'Quarterly business review'], ['call', 'Check onboarding blockers']];
    for (let i = 0; i < 10; i++) {
      await add('followups', {
        type: fu[i % 5][0], title: fu[i % 5][1] + ' — ' + clients[i].name,
        details: 'Confirm scope, budget and next steps for the coming month.', owner_id: owner(i),
        due_at: at(i - 3, 11 + (i % 5)), done: i === 1 ? 1 : 0,
      });
    }

    // --- Services ---
    const svc = [['ads', 'Performance Ads', 'Core'], ['seo', 'SEO & Organic Growth', 'Core'], ['social', 'Social Media Management', 'Core'],
      ['content', 'Content Studio', 'Core'], ['email', 'Email & CRM Automation', 'Add-on'], ['creative', 'Creative & Brand', 'Add-on']];
    for (let i = 0; i < svc.length; i++) {
      const [icon, name, tier] = svc[i];
      await add('services', {
        icon, name, tier, active_clients: 3 + i,
        description: 'Strategy, execution and weekly reporting with a dedicated specialist.', mrr: 120000 + i * 45000, revenue_ytd: 1400000 + i * 310000,
      });
    }

    // --- Onboardings with the standard checklist, partly complete ---
    const onboardings = [[2, 'Platform & Ad Account Permissions', 'Meta Business Manager partner access pending', 9], [4, 'Brand Assets & Creative Toolkits', null, 16], [9, 'Legal, Contracts & Billing Validation', null, 24]];
    for (let k = 0; k < onboardings.length; k++) {
      const [ci, gate, blocker, goLive] = onboardings[k];
      const oid = await add('onboardings', { client_id: clients[ci].id, gate, blocker, lead_id: owner(k + 1), go_live: day(goLive) });
      for (let i = 0; i < ONBOARDING_TEMPLATE.length; i++) {
        const [cat, title] = ONBOARDING_TEMPLATE[i];
        const critical = k === 0 && i === 7;
        await add('onboarding_items', {
          onboarding_id: oid, category: cat, sort: i, title,
          done: i < [9, 5, 2][k] ? 1 : 0, flag: critical ? 'critical' : 'none',
          detail: critical ? 'Partner request awaiting client approval in Meta Security Center' : null,
        });
      }
    }

    // --- Client approvals ---
    const approvals = [['Diwali sale carousel — 5 frames', 'Creative', 'pending'], ['Q4 media budget reallocation', 'Budget', 'pending'],
      ['Annual retainer renewal', 'Contract', 'approved'], ['Landing page hero video', 'Creative', 'changes'], ['Search campaign ad copy', 'Creative', 'pending']];
    for (let i = 0; i < approvals.length; i++) {
      const [item, type, st] = approvals[i];
      await add('approvals', {
        client_id: clients[i].id, item, type, status: st,
        preview: 'Five-frame carousel highlighting the festive offer with a WhatsApp click-to-chat CTA on the final frame.',
        requested_at: at(-i - 1), due_at: at(2 - i, 18), decided_at: st === 'pending' ? null : at(-i), decided_by: st === 'pending' ? null : me,
      });
    }

    // --- Campaigns ---
    const campaigns = [['Festive Sale — Conversions', 'meta', 'live', 68], ['Always-On Search', 'google', 'live', 54], ['B2B Lead Gen', 'linkedin', 'paused', 31],
      ['YouTube Awareness', 'youtube', 'scheduled', 0], ['Retargeting — Cart Abandoners', 'meta', 'live', 92], ['Brand Search Defence', 'google', 'ended', 100]];
    for (let i = 0; i < campaigns.length; i++) {
      const [name, ch, st, pace] = campaigns[i];
      const budget = 300000 + i * 50000; const spend = Math.round(budget * pace / 100); const conv = 120 + i * 45;
      await add('campaigns', {
        name, client_id: clients[i].id, channel: ch, status: st, objective: 'Leads & sales',
        pace, spend, budget, roas: [4.2, 3.6, 2.4, null, 5.1, 6.0][i], cpl: 180 + i * 25,
        impressions: 900000 + i * 260000, ctr: Math.round((1.2 + i * 0.3) * 100) / 100, conversions: conv, conv_label: 'Leads', conv_unit: 'leads',
        cost_per_conv: conv ? Math.round(spend / conv) : null, owner_id: owner(i),
      });
    }

    // --- Content calendar around today ---
    const posts = [['Festive offer reel', 'instagram', 'Reel'], ['Client success story', 'linkedin', 'Carousel'], ['SEO checklist for 2027', 'blog', 'Article'],
      ['November newsletter', 'email', 'Email'], ['Behind the scenes', 'youtube', 'Video'], ['Product spotlight', 'instagram', 'Carousel']];
    for (let i = 0; i < 18; i++) {
      const d = i - 8;
      await add('content_posts', {
        publish_date: day(d), title: posts[i % 6][0], client_id: clients[i % 10].id,
        channel: posts[i % 6][1], format: posts[i % 6][2], owner_id: owner(i),
        status: d < 0 ? 'published' : (d < 3 ? 'scheduled' : ['draft', 'review'][i % 2]),
      });
    }

    // --- Projects, team members, milestones, tasks ---
    const projNames = ['Website Redesign', 'Festive Campaign Production', 'SEO Technical Audit', 'Brand Guidelines', 'CRM Migration'];
    for (let i = 0; i < projNames.length; i++) {
      const pid = await add('projects', {
        name: projNames[i], client_id: clients[i].id, status: ['ontrack', 'risk', 'review', 'done', 'ontrack'][i],
        progress: [45, 30, 70, 100, 15][i], due_date: day(10 + i * 9), budget: 250000 + i * 80000, tasks_done: [5, 4, 9, 12, 2][i], tasks_total: [12, 13, 13, 12, 14][i],
      });
      for (const uid of team.slice(0, 2 + (i % 3))) {
        await ctx.q('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [pid, uid]); // removed with the project (cascade)
      }
      await add('milestones', {
        project_id: pid, name: ['Wireframes signed off', 'Shoot day', 'Audit report delivered', 'Guidelines handover', 'Data import dry run'][i],
        due_date: day(3 + i * 5), status: ['ontrack', 'risk', 'review', 'done', 'ontrack'][i], owner_id: owner(i),
      });
    }
    const taskTitles = ['Draft ad copy variations', 'Set up GA4 conversions', 'Design carousel frames', 'Client review call', 'Keyword research', 'QA landing page', 'Write blog outline', 'Export brand assets'];
    for (let i = 0; i < 16; i++) {
      await add('tasks', {
        title: taskTitles[i % 8], project: projNames[i % 5], col: ['todo', 'progress', 'review', 'done'][i % 4],
        priority: ['high', 'med', 'low'][i % 3], due_date: day(i - 4), owner_id: owner(i),
      });
    }

    // --- Proposals ---
    const propStatuses = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'sent', 'viewed'];
    for (let i = 0; i < propStatuses.length; i++) {
      const st = propStatuses[i];
      await add('proposals', {
        number: await nextNumber(ctx, 'proposals', `PR-${year}-`, 3),
        title: ['Performance Marketing Retainer', 'Brand Identity Refresh', 'SEO Growth Program', 'Social Media Management'][i % 4],
        client_name: firms[i], value: 85000 + i * 25000, sent_date: st === 'draft' ? null : day(-i * 4), expires_date: day(21 - i * 4),
        status: st, owner_id: owner(i), views: ['viewed', 'accepted', 'declined'].includes(st) ? 2 + i : 0,
      });
    }

    // --- Invoices (paid, open, overdue) with matching payments ---
    for (let i = 0; i < 14; i++) {
      const c = clients[i % 10];
      const issued = -(i * 6);
      let paid = i % 3 === 0 ? day(issued + 8) : null;
      if (paid && paid > day(0)) paid = day(0);
      const iid = await add('invoices', {
        number: await nextNumber(ctx, 'invoices', 'INV-', 4), client_id: c.id,
        description: ['Monthly retainer', 'Campaign production', 'SEO audit — phase 1', 'Creative sprint'][i % 4],
        issued_date: day(issued), due_date: day(issued + 15), amount: c.mrr, paid_date: paid,
      });
      if (paid) {
        await add('payments', {
          client_id: c.id, invoice_id: iid, reference: 'UTR' + (88120400 + i * 37), method: ['Bank transfer', 'UPI', 'Card', 'Razorpay'][i % 4],
          paid_on: paid, amount: c.mrr, status: 'settled',
        });
      }
    }

    // --- Monthly financials for the last 12 months (only months you haven't recorded) ---
    const now = new Date();
    for (let m = 11; m >= 0; m--) {
      const month = ymd(new Date(now.getFullYear(), now.getMonth() - m, 1));
      if (await ctx.col('SELECT 1 FROM finance_monthly WHERE month = ?', [month])) continue;
      const rev = 1100000 + (11 - m) * 85000 + (m % 3) * 40000;
      await add('finance_monthly', {
        month, revenue: rev, expenses: Math.round(rev * (0.58 + (m % 4) * 0.02)),
        collected: Math.round(rev * 0.9), payments_count: 10 + (11 - m),
      });
    }

    for (const [n, sch, f] of [['Monthly P&L summary', '1st of every month · Email', 'PDF'], ['Lead source ROI', 'Every Monday · Email', 'XLSX'], ['Receivables ageing', 'On demand', 'CSV']]) {
      await add('saved_reports', { name: n, schedule: sch, format: f });
    }

    // --- A few feed entries so the activity timeline isn't empty ---
    for (const [kind, title, detail, ago] of [['success', 'Invoice paid', clients[0].name + ' • monthly retainer', 0.05], ['warning', 'Changes requested', clients[3].name + ' • landing page hero video', 0.2],
      ['primary', 'Lead added', 'Kavya Rao • Lumen Labs', 0.4], ['danger', 'Onboarding blocker', clients[2].name + ' • Meta partner access pending', 0.8]]) {
      await add('activity', { user_id: me, kind, title, detail, entity: 'demo', created_at: ymdHis(new Date(Date.now() - Math.trunc(ago * 86400) * 1000)) });
    }

    for (let i = 0; i < made.length; i += 500) {
      const chunk = made.slice(i, i + 500);
      await ctx.q(`INSERT INTO demo_records (entity, row_id) VALUES ${chunk.map(() => '(?, ?)').join(', ')}`, chunk.flat());
    }
    await ctx.commit();
  } catch (e) {
    await ctx.rollback();
    throw e;
  }
  return made.length;
}

module.exports = { handleDemo };
