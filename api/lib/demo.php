<?php
/**
 * Free demo data: one click fills the CRM with a realistic sample agency, dated
 * relative to today so dashboards, "this week" and overdue views look alive.
 *
 *   GET  ?r=demo/status   { loaded, rows }
 *   POST ?r=demo/load     insert the demo set (admin)
 *   POST ?r=demo/remove   delete exactly the rows the demo created (admin)
 *
 * Every inserted row is recorded in demo_records, so removal never touches
 * records people created themselves.
 */
defined('CRM') or exit;

/** Delete order: children before parents (foreign keys). */
const DEMO_TABLES = [
    'activity', 'payments', 'invoices', 'approvals', 'onboarding_items', 'onboardings', 'milestones',
    'projects', 'tasks', 'content_posts', 'campaigns', 'proposals', 'followups', 'deals', 'leads',
    'services', 'finance_monthly', 'saved_reports', 'clients', 'users',
];

/** Creates the tracking table on first use, so older databases need no manual migration. */
function ensure_demo_table(): void
{
    db()->exec('CREATE TABLE IF NOT EXISTS demo_records (
        entity VARCHAR(40) NOT NULL,
        row_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (entity, row_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}

function demo_count(): int
{
    return (int) db()->query('SELECT COUNT(*) FROM demo_records')->fetchColumn();
}

function handle_demo(string $action, string $method): void
{
    require_role('admin');
    ensure_demo_table();
    if ($action === 'status') {
        $n = demo_count();
        $empty = !db()->query('SELECT 1 FROM clients UNION ALL SELECT 1 FROM leads LIMIT 1')->fetchColumn();
        json_out(['loaded' => $n > 0, 'rows' => $n, 'empty' => $empty]);
    }
    if ($method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    if ($action === 'load') {
        if (demo_count() > 0) throw new HttpError(409, 'Demo data is already loaded. Remove it first to load a fresh copy.');
        $rows = demo_load();
        log_activity('info', 'Demo data loaded', "$rows sample records added", 'demo');
        json_out(['ok' => true, 'rows' => $rows]);
    }
    if ($action === 'remove') {
        $rows = demo_remove();
        log_activity('muted', 'Demo data removed', "$rows sample records deleted", 'demo');
        json_out(['ok' => true, 'rows' => $rows]);
    }
    throw new HttpError(404, 'Unknown demo action.');
}

function demo_remove(): int
{
    $pdo = db();
    // Your own invoices/payments on a demo client would block deleting that client — say which ones.
    $st = $pdo->query("SELECT CONCAT(x.label, ' (', c.name, ')') FROM (
            SELECT i.client_id, i.number AS label FROM invoices i WHERE i.id NOT IN (SELECT row_id FROM demo_records WHERE entity = 'invoices')
            UNION ALL
            SELECT p.client_id, CONCAT('payment ', COALESCE(NULLIF(p.reference, ''), CONCAT('#', p.id))) FROM payments p WHERE p.id NOT IN (SELECT row_id FROM demo_records WHERE entity = 'payments')
        ) x JOIN clients c ON c.id = x.client_id JOIN demo_records d ON d.entity = 'clients' AND d.row_id = c.id LIMIT 6");
    $blocking = $st->fetchAll(PDO::FETCH_COLUMN);
    if ($blocking) {
        throw new HttpError(409, 'These records you added belong to demo clients: ' . implode(', ', array_slice($blocking, 0, 5))
            . (count($blocking) > 5 ? ' and more' : '') . '. Delete them (or move them to a real client) first, then remove the demo data.');
    }
    $pdo->beginTransaction();
    try {
        $total = 0;
        $pick = $pdo->prepare('SELECT row_id FROM demo_records WHERE entity = ?');
        foreach (DEMO_TABLES as $table) {
            $pick->execute([$table]);
            $ids = array_map('intval', $pick->fetchAll(PDO::FETCH_COLUMN));
            foreach (array_chunk($ids, 500) as $chunk) {
                $marks = implode(',', array_fill(0, count($chunk), '?'));
                $st = $pdo->prepare("DELETE FROM `$table` WHERE id IN ($marks)");
                $st->execute($chunk);
                $total += $st->rowCount();
            }
        }
        $pdo->exec('DELETE FROM demo_records');
        $pdo->commit();
        return $total;
    } catch (PDOException $e) {
        $pdo->rollBack();
        if ($e->getCode() === '23000') {
            throw new HttpError(409, 'Some demo clients now have your own invoices or payments attached. Delete or reassign those first, then remove the demo data.');
        }
        throw $e;
    }
}

function demo_load(): int
{
    $pdo = db();
    $made = [];
    $add = function (string $table, array $row) use ($pdo, &$made): int {
        $cols = implode(', ', array_map(function ($c) { return "`$c`"; }, array_keys($row)));
        $marks = implode(', ', array_fill(0, count($row), '?'));
        $pdo->prepare("INSERT INTO `$table` ($cols) VALUES ($marks)")->execute(array_values($row));
        $id = (int) $pdo->lastInsertId();
        $made[] = [$table, $id];
        return $id;
    };
    $day = function (int $offset): string { return date('Y-m-d', strtotime("$offset days")); };
    $at = function (float $days, int $hour = 10): string { return date('Y-m-d H:i:s', (int) (strtotime('today') + $days * 86400 + $hour * 3600)); };

    $pdo->beginTransaction();
    try {
        // --- Team (no logins; admins can give them one under Team & Access) ---
        $me = current_user()['id'];
        $team = [$me];
        foreach ([['Anika Kapoor', 'AK', 'manager', 'Account Director'], ['Rahul Rao', 'RR', 'member', 'Performance Lead'],
                  ['Neha Sharma', 'NS', 'member', 'Content Strategist'], ['Kabir Singh', 'KS', 'member', 'Designer']] as [$n, $i, $r, $t]) {
            $team[] = $add('users', ['name' => "$n (demo)", 'initials' => $i, 'role' => $r, 'title' => $t, 'active' => 1]);
        }
        $owner = function (int $i) use ($team) { return $team[$i % count($team)]; };

        // --- Clients ---
        $palette = [['#5CC9A0', '#0E7A5F'], ['#9EDFC2', '#2FB385'], ['#F2B544', '#C9861A'], ['#7FB7F0', '#2563EB'], ['#F49B9B', '#D33B3B']];
        $clientRows = [
            ['Northstar Retail Group', 'Retail', 185000, 92, 'ops@northstar.example'], ['BrightPath Wellness', 'Healthcare', 92000, 78, 'hello@brightpath.example'],
            ['Urban Kitchens', 'F&B', 64000, 54, 'team@urbankitchens.example'], ['Solaris Tech', 'SaaS', 240000, 88, 'growth@solaris.example'],
            ['Elevate Studio', 'Design', 48000, 41, 'studio@elevate.example'], ['Bloom Florals', 'E-commerce', 120000, 70, 'care@bloom.example'],
            ['Pixel Forge', 'Gaming', 75000, 95, 'biz@pixelforge.example'], ['Greenleaf Organics', 'FMCG', 56000, 63, 'brand@greenleaf.example'],
            ['Metro Realty', 'Real Estate', 310000, 82, 'marketing@metrorealty.example'], ['Zenith Fitness', 'Fitness', 88000, 58, 'hq@zenithfit.example'],
        ];
        $clients = [];
        foreach ($clientRows as $i => [$name, $ind, $mrr, $health, $email]) {
            $clients[] = ['id' => $add('clients', [
                'name' => $name, 'industry' => $ind, 'email' => $email, 'phone' => '+91 98' . str_pad((string) (40012300 + $i * 7919), 8, '0', STR_PAD_LEFT),
                'mrr' => $mrr, 'health' => $health, 'renewal_date' => $day(12 + $i * 17), 'status' => $i === 8 ? 'paused' : 'active',
                'owner_id' => $owner($i), 'color1' => $palette[$i % 5][0], 'color2' => $palette[$i % 5][1],
                'revenue_ytd' => $mrr * 10, 'cost_ytd' => round($mrr * 10 * (0.48 + ($i % 4) * 0.06)),
            ]), 'name' => $name, 'mrr' => $mrr];
        }

        // --- Leads: spread over the last 60 days, more recent ones newer ---
        $people = ['Aditya Verma', 'Meera Kapoor', 'Rohan Shetty', 'Priya Patel', 'Darshan Kumar', 'Kavya Rao', 'Arjun Mehta', 'Sneha Iyer', 'Farhan Ali', 'Ishita Bose', 'Vivek Nair', 'Tara Menon'];
        $firms = ['Coastal Cafe Co', 'Lumen Labs', 'Saffron Spice House', 'Peak Physio', 'Orbit Logistics', 'Kite Learning', 'Nova Interiors', 'Rangoli Textiles', 'Vertex Motors', 'Aqua Pure Water', 'Monsoon Travel', 'Harbor Dental'];
        $sources = ['Meta Lead Ads', 'Meta Lead Ads', 'Meta Lead Ads', 'Google Ads', 'Google Ads', 'Website Form', 'Website Form', 'WhatsApp Inbound', 'Referral'];
        $statuses = ['New', 'Contacted', 'Qualified', 'Contacted', 'New', 'Qualified', 'Unqualified', 'Contacted'];
        for ($i = 0; $i < 36; $i++) {
            $created = $at(-(($i * 37) % 60) * 0.95, 9 + $i % 8);
            $add('leads', [
                'name' => $people[$i % 12], 'company' => $firms[($i * 5) % 12], 'email' => strtolower(explode(' ', $people[$i % 12])[0]) . '@example.com',
                'phone' => $i % 3 ? '+91 99' . str_pad((string) (10203040 + $i * 1237), 8, '0', STR_PAD_LEFT) : null,
                'source' => $sources[$i % 9], 'score' => 96 - ($i * 7) % 61, 'status' => $statuses[$i % 8],
                'owner_id' => $i % 9 === 4 ? null : $owner($i), 'created_at' => $created,
            ]);
        }

        // --- Deals across every stage ---
        $dealNames = ['Performance Retainer', 'Brand Refresh', 'SEO Growth Plan', 'Festive Launch Campaign', 'Social Always-On', 'Website Rebuild', 'Lead Gen Sprint'];
        $stages = ['discovery', 'discovery', 'pitch', 'pitch', 'negotiation', 'won', 'discovery', 'pitch', 'negotiation', 'won', 'lost', 'pitch'];
        foreach ($stages as $i => $stage) {
            $add('deals', ['name' => $dealNames[$i % 7] . ' — ' . $firms[$i % 12], 'industry' => ['Retail', 'SaaS', 'Healthcare', 'F&B', 'Education'][$i % 5],
                'tag' => ['Retainer', 'Project', 'Upsell'][$i % 3], 'value' => 45000 + $i * 17500, 'stage' => $stage, 'owner_id' => $owner($i),
                'stage_changed_at' => $at(-($i * 3 % 25)), 'created_at' => $at(-20 - $i * 3)]);
        }

        // --- Follow-ups: some overdue, some today, some upcoming ---
        $fu = [['call', 'Pricing follow-up call'], ['mail', 'Send revised proposal'], ['wa', 'Nudge on creative approval'], ['meet', 'Quarterly business review'], ['call', 'Check onboarding blockers']];
        for ($i = 0; $i < 10; $i++) {
            $add('followups', ['type' => $fu[$i % 5][0], 'title' => $fu[$i % 5][1] . ' — ' . $clients[$i]['name'],
                'details' => 'Confirm scope, budget and next steps for the coming month.', 'owner_id' => $owner($i),
                'due_at' => $at($i - 3, 11 + $i % 5), 'done' => $i === 1 ? 1 : 0]);
        }

        // --- Services ---
        $svc = [['ads', 'Performance Ads', 'Core'], ['seo', 'SEO & Organic Growth', 'Core'], ['social', 'Social Media Management', 'Core'],
                ['content', 'Content Studio', 'Core'], ['email', 'Email & CRM Automation', 'Add-on'], ['creative', 'Creative & Brand', 'Add-on']];
        foreach ($svc as $i => [$icon, $name, $tier]) {
            $add('services', ['icon' => $icon, 'name' => $name, 'tier' => $tier, 'active_clients' => 3 + $i,
                'description' => 'Strategy, execution and weekly reporting with a dedicated specialist.', 'mrr' => 120000 + $i * 45000, 'revenue_ytd' => 1400000 + $i * 310000]);
        }

        // --- Onboardings with the standard checklist, partly complete ---
        foreach ([[2, 'Platform & Ad Account Permissions', 'Meta Business Manager partner access pending', 9], [4, 'Brand Assets & Creative Toolkits', null, 16], [9, 'Legal, Contracts & Billing Validation', null, 24]] as $k => [$ci, $gate, $blocker, $goLive]) {
            $oid = $add('onboardings', ['client_id' => $clients[$ci]['id'], 'gate' => $gate, 'blocker' => $blocker, 'lead_id' => $owner($k + 1), 'go_live' => $day($goLive)]);
            foreach (ONBOARDING_TEMPLATE as $i => [$cat, $title]) {
                $add('onboarding_items', ['onboarding_id' => $oid, 'category' => $cat, 'sort' => $i, 'title' => $title,
                    'done' => $i < [9, 5, 2][$k] ? 1 : 0, 'flag' => ($k === 0 && $i === 7) ? 'critical' : 'none',
                    'detail' => ($k === 0 && $i === 7) ? 'Partner request awaiting client approval in Meta Security Center' : null]);
            }
        }

        // --- Client approvals ---
        foreach ([['Diwali sale carousel — 5 frames', 'Creative', 'pending'], ['Q4 media budget reallocation', 'Budget', 'pending'],
                  ['Annual retainer renewal', 'Contract', 'approved'], ['Landing page hero video', 'Creative', 'changes'], ['Search campaign ad copy', 'Creative', 'pending']] as $i => [$item, $type, $st]) {
            $add('approvals', ['client_id' => $clients[$i]['id'], 'item' => $item, 'type' => $type, 'status' => $st,
                'preview' => 'Five-frame carousel highlighting the festive offer with a WhatsApp click-to-chat CTA on the final frame.',
                'requested_at' => $at(-$i - 1), 'due_at' => $at(2 - $i, 18), 'decided_at' => $st === 'pending' ? null : $at(-$i), 'decided_by' => $st === 'pending' ? null : $me]);
        }

        // --- Campaigns ---
        foreach ([['Festive Sale — Conversions', 'meta', 'live', 68], ['Always-On Search', 'google', 'live', 54], ['B2B Lead Gen', 'linkedin', 'paused', 31],
                  ['YouTube Awareness', 'youtube', 'scheduled', 0], ['Retargeting — Cart Abandoners', 'meta', 'live', 92], ['Brand Search Defence', 'google', 'ended', 100]] as $i => [$name, $ch, $st, $pace]) {
            $budget = 300000 + $i * 50000; $spend = round($budget * $pace / 100); $conv = 120 + $i * 45;
            $add('campaigns', ['name' => $name, 'client_id' => $clients[$i]['id'], 'channel' => $ch, 'status' => $st, 'objective' => 'Leads & sales',
                'pace' => $pace, 'spend' => $spend, 'budget' => $budget, 'roas' => [4.2, 3.6, 2.4, null, 5.1, 6.0][$i], 'cpl' => 180 + $i * 25,
                'impressions' => 900000 + $i * 260000, 'ctr' => 1.2 + $i * 0.3, 'conversions' => $conv, 'conv_label' => 'Leads', 'conv_unit' => 'leads',
                'cost_per_conv' => $conv ? round($spend / $conv) : null, 'owner_id' => $owner($i)]);
        }

        // --- Content calendar around today ---
        $posts = [['Festive offer reel', 'instagram', 'Reel'], ['Client success story', 'linkedin', 'Carousel'], ['SEO checklist for 2027', 'blog', 'Article'],
                  ['November newsletter', 'email', 'Email'], ['Behind the scenes', 'youtube', 'Video'], ['Product spotlight', 'instagram', 'Carousel']];
        for ($i = 0; $i < 18; $i++) {
            $d = $i - 8;
            $add('content_posts', ['publish_date' => $day($d), 'title' => $posts[$i % 6][0], 'client_id' => $clients[$i % 10]['id'],
                'channel' => $posts[$i % 6][1], 'format' => $posts[$i % 6][2], 'owner_id' => $owner($i),
                'status' => $d < 0 ? 'published' : ($d < 3 ? 'scheduled' : ['draft', 'review'][$i % 2])]);
        }

        // --- Projects, team members, milestones, tasks ---
        $projNames = ['Website Redesign', 'Festive Campaign Production', 'SEO Technical Audit', 'Brand Guidelines', 'CRM Migration'];
        foreach ($projNames as $i => $name) {
            $pid = $add('projects', ['name' => $name, 'client_id' => $clients[$i]['id'], 'status' => ['ontrack', 'risk', 'review', 'done', 'ontrack'][$i],
                'progress' => [45, 30, 70, 100, 15][$i], 'due_date' => $day(10 + $i * 9), 'budget' => 250000 + $i * 80000, 'tasks_done' => [5, 4, 9, 12, 2][$i], 'tasks_total' => [12, 13, 13, 12, 14][$i]]);
            foreach (array_slice($team, 0, 2 + $i % 3) as $uid) {
                $pdo->prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)')->execute([$pid, $uid]); // removed with the project (cascade)
            }
            $add('milestones', ['project_id' => $pid, 'name' => ['Wireframes signed off', 'Shoot day', 'Audit report delivered', 'Guidelines handover', 'Data import dry run'][$i],
                'due_date' => $day(3 + $i * 5), 'status' => ['ontrack', 'risk', 'review', 'done', 'ontrack'][$i], 'owner_id' => $owner($i)]);
        }
        $taskTitles = ['Draft ad copy variations', 'Set up GA4 conversions', 'Design carousel frames', 'Client review call', 'Keyword research', 'QA landing page', 'Write blog outline', 'Export brand assets'];
        for ($i = 0; $i < 16; $i++) {
            $add('tasks', ['title' => $taskTitles[$i % 8], 'project' => $projNames[$i % 5], 'col' => ['todo', 'progress', 'review', 'done'][$i % 4],
                'priority' => ['high', 'med', 'low'][$i % 3], 'due_date' => $day($i - 4), 'owner_id' => $owner($i)]);
        }

        // --- Proposals ---
        foreach (['draft', 'sent', 'viewed', 'accepted', 'declined', 'sent', 'viewed'] as $i => $st) {
            $add('proposals', ['number' => next_number('proposals', 'PR-' . date('Y') . '-', 3), 'title' => ['Performance Marketing Retainer', 'Brand Identity Refresh', 'SEO Growth Program', 'Social Media Management'][$i % 4],
                'client_name' => $firms[$i], 'value' => 85000 + $i * 25000, 'sent_date' => $st === 'draft' ? null : $day(-$i * 4), 'expires_date' => $day(21 - $i * 4),
                'status' => $st, 'owner_id' => $owner($i), 'views' => in_array($st, ['viewed', 'accepted', 'declined'], true) ? 2 + $i : 0]);
        }

        // --- Invoices (paid, open, overdue) with matching payments ---
        for ($i = 0; $i < 14; $i++) {
            $c = $clients[$i % 10];
            $issued = -($i * 6); $paid = $i % 3 === 0 ? $day($issued + 8) : null;
            if ($paid && $paid > $day(0)) $paid = $day(0);
            $iid = $add('invoices', ['number' => next_number('invoices', 'INV-', 4), 'client_id' => $c['id'],
                'description' => ['Monthly retainer', 'Campaign production', 'SEO audit — phase 1', 'Creative sprint'][$i % 4],
                'issued_date' => $day($issued), 'due_date' => $day($issued + 15), 'amount' => $c['mrr'], 'paid_date' => $paid]);
            if ($paid) {
                $add('payments', ['client_id' => $c['id'], 'invoice_id' => $iid, 'reference' => 'UTR' . (88120400 + $i * 37), 'method' => ['Bank transfer', 'UPI', 'Card', 'Razorpay'][$i % 4],
                    'paid_on' => $paid, 'amount' => $c['mrr'], 'status' => 'settled']);
            }
        }

        // --- Monthly financials for the last 12 months (only months you haven't recorded) ---
        $has = $pdo->prepare('SELECT 1 FROM finance_monthly WHERE month = ?');
        for ($m = 11; $m >= 0; $m--) {
            $month = date('Y-m-01', strtotime("first day of -$m month"));
            $has->execute([$month]);
            if ($has->fetchColumn()) continue;
            $rev = 1100000 + (11 - $m) * 85000 + ($m % 3) * 40000;
            $add('finance_monthly', ['month' => $month, 'revenue' => $rev, 'expenses' => round($rev * (0.58 + ($m % 4) * 0.02)),
                'collected' => round($rev * 0.9), 'payments_count' => 10 + (11 - $m)]);
        }

        foreach ([['Monthly P&L summary', '1st of every month · Email', 'PDF'], ['Lead source ROI', 'Every Monday · Email', 'XLSX'], ['Receivables ageing', 'On demand', 'CSV']] as [$n, $sch, $f]) {
            $add('saved_reports', ['name' => $n, 'schedule' => $sch, 'format' => $f]);
        }

        // --- A few feed entries so the activity timeline isn't empty ---
        foreach ([['success', 'Invoice paid', $clients[0]['name'] . ' • monthly retainer', 0.05], ['warning', 'Changes requested', $clients[3]['name'] . ' • landing page hero video', 0.2],
                  ['primary', 'Lead added', 'Kavya Rao • Lumen Labs', 0.4], ['danger', 'Onboarding blocker', $clients[2]['name'] . ' • Meta partner access pending', 0.8]] as [$kind, $title, $detail, $ago]) {
            $add('activity', ['user_id' => $me, 'kind' => $kind, 'title' => $title, 'detail' => $detail, 'entity' => 'demo', 'created_at' => date('Y-m-d H:i:s', (int) (time() - $ago * 86400))]);
        }

        $rec = $pdo->prepare('INSERT INTO demo_records (entity, row_id) VALUES (?, ?)');
        foreach ($made as [$table, $id]) $rec->execute([$table, $id]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return count($made);
}
