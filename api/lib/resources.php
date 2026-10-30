<?php
/**
 * Declarative resource map used by the generic CRUD engine (crud.php).
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
 *   before(array &$cols, ?array $old, array $input, string $op)
 *   after(int $id, array $input, ?array $old, string $op, array $row): ?array activity override
 */
defined('CRM') or exit;

function owner_fields(string $col = 'owner_id', string $alias = 'u', string $key = 'owner'): array
{
    return [
        $key . 'Id'   => ['col' => $col, 'type' => 'int', 'nullable' => true],
        $key          => ['expr' => "COALESCE($alias.initials, '—')"],
        $key . 'Name' => ['expr' => "$alias.name"],
    ];
}

function client_fields(bool $required = false): array
{
    return [
        'clientId' => ['col' => 'client_id', 'type' => 'int', 'required' => $required, 'nullable' => !$required],
        'client'   => ['expr' => "COALESCE(c.name, '—')"],
    ];
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

function next_number(string $table, string $prefix, int $pad): string
{
    $st = db()->prepare("SELECT number FROM $table WHERE number LIKE ? ORDER BY LENGTH(number) DESC, number DESC LIMIT 1");
    $st->execute([$prefix . '%']);
    $last = $st->fetchColumn();
    $n = $last ? ((int) substr($last, strlen($prefix))) + 1 : 1;
    return $prefix . str_pad((string) $n, $pad, '0', STR_PAD_LEFT);
}

function resources(): array
{
    $userJoin = ' LEFT JOIN users u ON u.id = t.owner_id';

    return [
        'leads' => [
            'table' => 'leads', 'singular' => 'Lead', 'label' => 'name',
            'from' => 'leads t' . $userJoin,
            'order' => 't.score DESC, t.id DESC',
            'fields' => [
                'name'   => ['col' => 'name', 'required' => true, 'max' => 120],
                'co'     => ['col' => 'company', 'max' => 160],
                'email'  => ['col' => 'email', 'max' => 190],
                'phone'  => ['col' => 'phone', 'max' => 40],
                'source' => ['col' => 'source', 'max' => 60],
                'score'  => ['col' => 'score', 'type' => 'int'],
                'status' => ['col' => 'status', 'enum' => ['New', 'Contacted', 'Qualified', 'Unqualified']],
                'notes'  => ['col' => 'notes', 'max' => 5000],
            ] + owner_fields(),
        ],

        'clients' => [
            'table' => 'clients', 'singular' => 'Client', 'label' => 'name',
            'from' => 'clients t' . $userJoin,
            'order' => 't.mrr DESC, t.name',
            'fields' => [
                'name'       => ['col' => 'name', 'required' => true, 'max' => 160],
                'ind'        => ['col' => 'industry', 'max' => 120],
                'email'      => ['col' => 'email', 'max' => 190],
                'phone'      => ['col' => 'phone', 'max' => 40],
                'mrr'        => ['col' => 'mrr', 'type' => 'num'],
                'health'     => ['col' => 'health', 'type' => 'int'],
                'renewal'    => ['col' => 'renewal_date', 'type' => 'date', 'nullable' => true],
                'status'     => ['col' => 'status', 'enum' => ['active', 'paused', 'churned']],
                'color1'     => ['col' => 'color1', 'max' => 9],
                'color2'     => ['col' => 'color2', 'max' => 9],
                'revenueYtd' => ['col' => 'revenue_ytd', 'type' => 'num'],
                'costYtd'    => ['col' => 'cost_ytd', 'type' => 'num'],
            ] + owner_fields(),
        ],

        'deals' => [
            'table' => 'deals', 'singular' => 'Deal', 'label' => 'name',
            'from' => 'deals t' . $userJoin,
            'order' => 't.stage_changed_at DESC',
            'fields' => [
                'name'           => ['col' => 'name', 'required' => true, 'max' => 160],
                'co'             => ['col' => 'industry', 'max' => 120],
                'tag'            => ['col' => 'tag', 'max' => 60],
                'value'          => ['col' => 'value', 'type' => 'num'],
                'stage'          => ['col' => 'stage', 'enum' => ['discovery', 'pitch', 'negotiation', 'won', 'lost']],
                'stageChangedAt' => ['expr' => 't.stage_changed_at', 'type' => 'datetime'],
            ] + owner_fields(),
            'before' => function (array &$cols, ?array $old) {
                if (isset($cols['stage']) && (!$old || $old['stage'] !== $cols['stage'])) {
                    $cols['stage_changed_at'] = date('Y-m-d H:i:s');
                }
            },
            'after' => function (int $id, array $in, ?array $old, string $op, array $row) {
                if ($op === 'update' && $old && $old['stage'] !== $row['stage']) {
                    $won = $row['stage'] === 'won';
                    return [$won ? 'success' : 'info', $won ? 'Deal closed won' : 'Deal moved to ' . $row['stage'], $row['name']];
                }
                return null;
            },
        ],

        'followups' => [
            'table' => 'followups', 'singular' => 'Follow-up', 'label' => 'name',
            'from' => 'followups t' . $userJoin,
            'order' => 't.done ASC, t.due_at ASC',
            'fields' => [
                'type'  => ['col' => 'type', 'enum' => ['call', 'mail', 'wa', 'meet']],
                'name'  => ['col' => 'title', 'required' => true, 'max' => 200],
                'sub'   => ['col' => 'details'],
                'dueAt' => ['col' => 'due_at', 'type' => 'datetime', 'required' => true],
                'done'  => ['col' => 'done', 'type' => 'bool'],
            ] + owner_fields(),
        ],

        'services' => [
            'table' => 'services', 'singular' => 'Service', 'label' => 'name',
            'order' => 't.id',
            'fields' => [
                'icon'       => ['col' => 'icon', 'enum' => ['ads', 'seo', 'social', 'content', 'email', 'creative']],
                'name'       => ['col' => 'name', 'required' => true, 'max' => 160],
                'desc'       => ['col' => 'description', 'max' => 500],
                'tier'       => ['col' => 'tier', 'enum' => ['Core', 'Add-on']],
                'clients'    => ['col' => 'active_clients', 'type' => 'int'],
                'mrr'        => ['col' => 'mrr', 'type' => 'num'],
                'revenueYtd' => ['col' => 'revenue_ytd', 'type' => 'num'],
            ],
        ],

        'onboardings' => [
            'table' => 'onboardings', 'singular' => 'Onboarding', 'label' => 'name',
            'from' => 'onboardings t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.lead_id',
            'order' => "t.status = 'completed', t.go_live",
            'fields' => [
                'clientId' => ['col' => 'client_id', 'type' => 'int', 'required' => true],
                'name'     => ['expr' => 'c.name'],
                'type'     => ['expr' => 'c.industry'],
                'mrr'      => ['expr' => 'c.mrr', 'type' => 'num'],
                'gate'     => ['col' => 'gate', 'max' => 160],
                'blocker'  => ['col' => 'blocker', 'max' => 160],
                'goLive'   => ['col' => 'go_live', 'type' => 'date', 'nullable' => true],
                'status'   => ['col' => 'status', 'enum' => ['active', 'completed']],
                'done'     => ['expr' => '(SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id = t.id AND i.done = 1)', 'type' => 'int'],
                'total'    => ['expr' => '(SELECT COUNT(*) FROM onboarding_items i WHERE i.onboarding_id = t.id)', 'type' => 'int'],
            ] + owner_fields('lead_id', 'u', 'lead'),
            'after' => function (int $id, array $in, ?array $old, string $op) {
                if ($op === 'create') {
                    $st = db()->prepare('INSERT INTO onboarding_items (onboarding_id, category, sort, title) VALUES (?,?,?,?)');
                    foreach (ONBOARDING_TEMPLATE as $i => [$cat, $title]) {
                        $st->execute([$id, $cat, $i + 1, $title]);
                    }
                }
                return null;
            },
        ],

        'onboarding_items' => [
            'table' => 'onboarding_items', 'singular' => 'Checklist item', 'label' => 'title',
            'order' => 't.sort, t.id',
            'fields' => [
                'onboardingId' => ['col' => 'onboarding_id', 'type' => 'int', 'required' => true],
                'category'     => ['col' => 'category', 'required' => true, 'max' => 120],
                'sort'         => ['col' => 'sort', 'type' => 'int'],
                'title'        => ['col' => 'title', 'required' => true, 'max' => 200],
                'detail'       => ['col' => 'detail'],
                'badge'        => ['col' => 'badge', 'max' => 60],
                'done'         => ['col' => 'done', 'type' => 'bool'],
                'flag'         => ['col' => 'flag', 'enum' => ['none', 'critical', 'resend', 'join']],
            ],
            'after' => function (int $id, array $in, ?array $old, string $op, array $row) {
                if ($op === 'update' && $old && (bool) $old['done'] !== $row['done']) {
                    $client = db()->prepare('SELECT c.name FROM onboardings o JOIN clients c ON c.id = o.client_id WHERE o.id = ?');
                    $client->execute([$row['onboardingId']]);
                    return [$row['done'] ? 'success' : 'warning', ($row['done'] ? 'Gate verified: ' : 'Gate reopened: ') . $row['title'], $client->fetchColumn() ?: null];
                }
                return null;
            },
        ],

        'approvals' => [
            'table' => 'approvals', 'singular' => 'Approval', 'label' => 'item',
            'from' => 'approvals t JOIN clients c ON c.id = t.client_id',
            'order' => "t.status = 'pending' DESC, t.due_at",
            'fields' => [
                'item'        => ['col' => 'item', 'required' => true, 'max' => 200],
                'type'        => ['col' => 'type', 'enum' => ['Creative', 'Budget', 'Contract']],
                'preview'     => ['col' => 'preview', 'max' => 500],
                'status'      => ['col' => 'status', 'enum' => ['pending', 'approved', 'changes']],
                'requestedAt' => ['expr' => 't.requested_at', 'type' => 'datetime'],
                'dueAt'       => ['col' => 'due_at', 'type' => 'datetime', 'nullable' => true],
                'decidedAt'   => ['expr' => 't.decided_at', 'type' => 'datetime'],
            ] + client_fields(true),
            'before' => function (array &$cols, ?array $old) {
                if (!$old && empty($cols['due_at'])) {
                    $cols['due_at'] = date('Y-m-d H:i:s', time() + 86400); // 24h SLA
                }
                if ($old && isset($cols['status']) && $cols['status'] !== $old['status']) {
                    $cols['decided_at'] = $cols['status'] === 'pending' ? null : date('Y-m-d H:i:s');
                    $cols['decided_by'] = $cols['status'] === 'pending' ? null : current_user()['id'];
                }
            },
            'after' => function (int $id, array $in, ?array $old, string $op, array $row) {
                if ($op === 'update' && $old && $old['status'] !== $row['status']) {
                    if ($row['status'] === 'approved') {
                        return ['success', 'Client approval received', $row['client'] . ' • ' . $row['item']];
                    }
                    if ($row['status'] === 'changes') {
                        return ['warning', 'Changes requested', $row['client'] . ' • ' . $row['item']];
                    }
                }
                return null;
            },
        ],

        'campaigns' => [
            'table' => 'campaigns', 'singular' => 'Campaign', 'label' => 'name',
            'from' => 'campaigns t LEFT JOIN clients c ON c.id = t.client_id' . $userJoin,
            'order' => "FIELD(t.status, 'live', 'paused', 'scheduled', 'ended'), t.spend DESC",
            'fields' => [
                'name'        => ['col' => 'name', 'required' => true, 'max' => 200],
                'ch'          => ['col' => 'channel', 'enum' => ['meta', 'google', 'linkedin', 'youtube']],
                'status'      => ['col' => 'status', 'enum' => ['live', 'paused', 'scheduled', 'ended']],
                'statusNote'  => ['col' => 'status_note', 'max' => 60, 'nullable' => true],
                'objective'   => ['col' => 'objective', 'nullable' => true],
                'pace'        => ['col' => 'pace', 'type' => 'int'],
                'spend'       => ['col' => 'spend', 'type' => 'num'],
                'budget'      => ['col' => 'budget', 'type' => 'num'],
                'roas'        => ['col' => 'roas', 'type' => 'num', 'nullable' => true],
                'cpl'         => ['col' => 'cpl', 'type' => 'num', 'nullable' => true],
                'impressions' => ['col' => 'impressions', 'type' => 'int', 'nullable' => true],
                'ctr'         => ['col' => 'ctr', 'type' => 'num', 'nullable' => true],
                'conversions' => ['col' => 'conversions', 'type' => 'int', 'nullable' => true],
                'convLabel'   => ['col' => 'conv_label', 'max' => 60, 'nullable' => true],
                'convUnit'    => ['col' => 'conv_unit', 'max' => 30, 'nullable' => true],
                'costPerConv' => ['col' => 'cost_per_conv', 'type' => 'num', 'nullable' => true],
                'roasNote'    => ['col' => 'roas_note', 'max' => 60, 'nullable' => true],
            ] + client_fields() + owner_fields(),
        ],

        'posts' => [
            'table' => 'content_posts', 'singular' => 'Post', 'label' => 'title',
            'from' => 'content_posts t LEFT JOIN clients c ON c.id = t.client_id' . $userJoin,
            'order' => 't.publish_date, t.id',
            'fields' => [
                'd'      => ['col' => 'publish_date', 'type' => 'date', 'required' => true],
                'title'  => ['col' => 'title', 'required' => true, 'max' => 200],
                'ch'     => ['col' => 'channel', 'enum' => ['instagram', 'linkedin', 'blog', 'email', 'youtube']],
                'fmt'    => ['col' => 'format', 'max' => 60],
                'status' => ['col' => 'status', 'enum' => ['draft', 'review', 'scheduled', 'published']],
            ] + client_fields() + owner_fields(),
        ],

        'projects' => [
            'table' => 'projects', 'singular' => 'Project', 'label' => 'name',
            'from' => 'projects t LEFT JOIN clients c ON c.id = t.client_id',
            'order' => "t.status = 'done', t.due_date",
            'fields' => [
                'name'       => ['col' => 'name', 'required' => true, 'max' => 200],
                'client'     => ['expr' => "COALESCE(c.name, 'Internal')"],
                'color1'     => ['expr' => "COALESCE(c.color1, '#8B7FF5')"],
                'color2'     => ['expr' => "COALESCE(c.color2, '#5145E8')"],
                'status'     => ['col' => 'status', 'enum' => ['ontrack', 'risk', 'review', 'done']],
                'progress'   => ['col' => 'progress', 'type' => 'int'],
                'due'        => ['col' => 'due_date', 'type' => 'date', 'nullable' => true],
                'budget'     => ['col' => 'budget', 'type' => 'num'],
                'tasksDone'  => ['col' => 'tasks_done', 'type' => 'int'],
                'tasksTotal' => ['col' => 'tasks_total', 'type' => 'int'],
                'team'       => ['expr' => '(SELECT GROUP_CONCAT(u2.initials ORDER BY u2.id) FROM project_members pm JOIN users u2 ON u2.id = pm.user_id WHERE pm.project_id = t.id)', 'type' => 'csv'],
                'teamIds'    => ['expr' => '(SELECT GROUP_CONCAT(pm.user_id ORDER BY pm.user_id) FROM project_members pm WHERE pm.project_id = t.id)', 'type' => 'csv', 'virtual' => true],
            ] + ['clientId' => client_fields()['clientId']],
            'after' => function (int $id, array $in) {
                if (array_key_exists('teamIds', $in)) {
                    $ids = is_array($in['teamIds']) ? $in['teamIds'] : explode(',', (string) $in['teamIds']);
                    db()->prepare('DELETE FROM project_members WHERE project_id = ?')->execute([$id]);
                    $st = db()->prepare('INSERT IGNORE INTO project_members (project_id, user_id) SELECT ?, id FROM users WHERE id = ?');
                    foreach (array_filter(array_map('intval', $ids)) as $uid) {
                        $st->execute([$id, $uid]);
                    }
                }
                return null;
            },
        ],

        'milestones' => [
            'table' => 'milestones', 'singular' => 'Milestone', 'label' => 'name',
            'from' => 'milestones t JOIN projects p ON p.id = t.project_id' . $userJoin,
            'order' => 't.due_date',
            'fields' => [
                'name'      => ['col' => 'name', 'required' => true, 'max' => 200],
                'projectId' => ['col' => 'project_id', 'type' => 'int', 'required' => true],
                'project'   => ['expr' => 'p.name'],
                'due'       => ['col' => 'due_date', 'type' => 'date', 'nullable' => true],
                'status'    => ['col' => 'status', 'enum' => ['ontrack', 'risk', 'review', 'done']],
            ] + owner_fields(),
        ],

        'tasks' => [
            'table' => 'tasks', 'singular' => 'Task', 'label' => 'title',
            'from' => 'tasks t' . $userJoin,
            'order' => "FIELD(t.priority, 'high', 'med', 'low'), t.due_date",
            'fields' => [
                'title'   => ['col' => 'title', 'required' => true, 'max' => 200],
                'project' => ['col' => 'project', 'max' => 160],
                'col'     => ['col' => 'col', 'enum' => ['todo', 'progress', 'review', 'done']],
                'pri'     => ['col' => 'priority', 'enum' => ['high', 'med', 'low']],
                'due'     => ['col' => 'due_date', 'type' => 'date', 'nullable' => true],
            ] + owner_fields(),
            'after' => function (int $id, array $in, ?array $old, string $op, array $row) {
                if ($op === 'update' && $old && $old['col'] !== $row['col']) {
                    $names = ['todo' => 'To Do', 'progress' => 'In Progress', 'review' => 'In Review', 'done' => 'Done'];
                    return [$row['col'] === 'done' ? 'success' : 'info', 'Task moved to ' . $names[$row['col']], $row['title']];
                }
                return null;
            },
        ],

        'proposals' => [
            'table' => 'proposals', 'singular' => 'Proposal', 'label' => 'title',
            'from' => 'proposals t' . $userJoin,
            'order' => 't.number DESC',
            'fields' => [
                'no'      => ['col' => 'number', 'max' => 30],
                'title'   => ['col' => 'title', 'required' => true, 'max' => 200],
                'client'  => ['col' => 'client_name', 'required' => true, 'max' => 160],
                'value'   => ['col' => 'value', 'type' => 'num'],
                'sent'    => ['col' => 'sent_date', 'type' => 'date', 'nullable' => true],
                'expires' => ['col' => 'expires_date', 'type' => 'date', 'nullable' => true],
                'status'  => ['col' => 'status', 'enum' => ['draft', 'sent', 'viewed', 'accepted', 'declined']],
                'views'   => ['col' => 'views', 'type' => 'int'],
            ] + owner_fields(),
            'before' => function (array &$cols, ?array $old) {
                if (!$old && empty($cols['number'])) {
                    $cols['number'] = next_number('proposals', 'PR-' . date('Y') . '-', 3);
                }
                $status = $cols['status'] ?? ($old['status'] ?? 'draft');
                $sent = array_key_exists('sent_date', $cols) ? $cols['sent_date'] : ($old['sent_date'] ?? null);
                if ($status !== 'draft' && !$sent) {
                    $cols['sent_date'] = date('Y-m-d');
                    if (empty($cols['expires_date']) && empty($old['expires_date'])) {
                        $cols['expires_date'] = date('Y-m-d', strtotime('+14 days'));
                    }
                }
            },
            'after' => function (int $id, array $in, ?array $old, string $op, array $row) {
                if ($op === 'update' && $old && $old['status'] !== $row['status'] && in_array($row['status'], ['accepted', 'declined'], true)) {
                    return [$row['status'] === 'accepted' ? 'success' : 'danger', 'Proposal ' . $row['status'], $row['client'] . ' • ' . $row['title']];
                }
                return null;
            },
        ],

        'invoices' => [
            'table' => 'invoices', 'singular' => 'Invoice', 'label' => 'no',
            'from' => 'invoices t JOIN clients c ON c.id = t.client_id',
            'order' => 't.issued_date DESC, t.number DESC',
            'fields' => [
                'no'     => ['col' => 'number', 'max' => 30],
                'desc'   => ['col' => 'description'],
                'issued' => ['col' => 'issued_date', 'type' => 'date', 'required' => true],
                'due'    => ['col' => 'due_date', 'type' => 'date', 'required' => true],
                'amount' => ['col' => 'amount', 'type' => 'num', 'required' => true],
                'paid'   => ['col' => 'paid_date', 'type' => 'date', 'nullable' => true],
                'method' => ['virtual' => true, 'enum' => ['Bank transfer', 'UPI', 'Card', 'Razorpay']],
            ] + client_fields(true),
            'before' => function (array &$cols, ?array $old) {
                if (!$old && empty($cols['number'])) {
                    $cols['number'] = next_number('invoices', 'INV-', 4);
                }
            },
            'after' => function (int $id, array $in, ?array $old, string $op, array $row) {
                $wasPaid = $old && !empty($old['paid_date']);
                if ($row['paid'] && !$wasPaid) {
                    // Record the matching settled payment automatically.
                    db()->prepare('INSERT INTO payments (client_id, invoice_id, reference, method, paid_on, amount, status) VALUES (?,?,?,?,?,?,\'settled\')')
                        ->execute([$row['clientId'], $id, $row['no'], $in['method'] ?? 'Bank transfer', $row['paid'], $row['amount']]);
                    return ['success', 'Invoice paid', $row['client'] . ' • ' . $row['no'] . ' • ₹' . number_format($row['amount'])];
                }
                return null;
            },
        ],

        'payments' => [
            'table' => 'payments', 'singular' => 'Payment', 'label' => 'ref',
            'from' => 'payments t JOIN clients c ON c.id = t.client_id',
            'order' => 't.paid_on DESC, t.id DESC',
            'fields' => [
                'invoiceId' => ['col' => 'invoice_id', 'type' => 'int', 'nullable' => true],
                'ref'       => ['col' => 'reference', 'max' => 40],
                'method'    => ['col' => 'method', 'enum' => ['Bank transfer', 'UPI', 'Card', 'Razorpay']],
                'date'      => ['col' => 'paid_on', 'type' => 'date', 'required' => true],
                'amount'    => ['col' => 'amount', 'type' => 'num', 'required' => true],
                'status'    => ['col' => 'status', 'enum' => ['settled', 'processing', 'failed']],
            ] + client_fields(true),
        ],

        'finance' => [
            'table' => 'finance_monthly', 'singular' => 'Finance month', 'label' => 'month',
            'order' => 't.month', 'write' => 'manager',
            'fields' => [
                'month'     => ['col' => 'month', 'type' => 'date', 'required' => true],
                'revenue'   => ['col' => 'revenue', 'type' => 'num'],
                'expenses'  => ['col' => 'expenses', 'type' => 'num'],
                'collected' => ['col' => 'collected', 'type' => 'num'],
                'count'     => ['col' => 'payments_count', 'type' => 'int'],
            ],
            'before' => function (array &$cols) {
                if (!empty($cols['month'])) {
                    $cols['month'] = substr($cols['month'], 0, 8) . '01';
                }
            },
        ],

        'saved_reports' => [
            'table' => 'saved_reports', 'singular' => 'Saved report', 'label' => 'name',
            'order' => 't.id',
            'fields' => [
                'name'  => ['col' => 'name', 'required' => true, 'max' => 160],
                'sched' => ['col' => 'schedule', 'max' => 120],
                'fmt'   => ['col' => 'format', 'enum' => ['PDF', 'XLSX', 'CSV']],
            ],
        ],

        'activity' => [
            'table' => 'activity', 'singular' => 'Activity', 'label' => 'title',
            'from' => 'activity t LEFT JOIN users u ON u.id = t.user_id',
            'order' => 't.created_at DESC, t.id DESC',
            'write' => 'none', 'delete' => 'admin', 'log' => false, 'limit' => 50,
            'fields' => [
                'kind'   => ['expr' => 't.kind'],
                'title'  => ['expr' => 't.title'],
                'detail' => ['expr' => 't.detail'],
                'entity' => ['col' => 'entity', 'ro' => true],
                'user'   => ['expr' => 'u.name'],
            ],
        ],

        'users' => [
            'table' => 'users', 'singular' => 'User', 'label' => 'name',
            'order' => 't.active DESC, t.name',
            'write' => 'admin', 'delete' => 'admin',
            'fields' => [
                'name'        => ['col' => 'name', 'required' => true, 'max' => 120],
                'initials'    => ['col' => 'initials', 'max' => 4],
                'email'       => ['col' => 'email', 'max' => 190, 'nullable' => true],
                'role'        => ['col' => 'role', 'enum' => ['admin', 'manager', 'member', 'viewer']],
                'title'       => ['col' => 'title', 'max' => 120],
                'active'      => ['col' => 'active', 'type' => 'bool'],
                'canLogin'    => ['expr' => '(t.password_hash IS NOT NULL)', 'type' => 'bool'],
                'lastLoginAt' => ['expr' => 't.last_login_at', 'type' => 'datetime'],
                'password'    => ['virtual' => true, 'hidden' => true],
            ],
            'before' => function (array &$cols, ?array $old, array $in) {
                if (!$old && empty($cols['initials']) && !empty($cols['name'])) {
                    $cols['initials'] = initials_of($cols['name']);
                }
                if (isset($in['password']) && $in['password'] !== '') {
                    if (strlen((string) $in['password']) < 8) {
                        throw new HttpError(422, 'Password must be at least 8 characters.');
                    }
                    $cols['password_hash'] = password_hash((string) $in['password'], PASSWORD_DEFAULT);
                }
                $me = current_user();
                if ($old && (int) $old['id'] === $me['id']) {
                    if ((isset($cols['role']) && $cols['role'] !== 'admin') || (isset($cols['active']) && !$cols['active'])) {
                        throw new HttpError(422, 'You cannot demote or deactivate your own account.');
                    }
                }
                if (!empty($cols['email'])) {
                    $cols['email'] = strtolower($cols['email']);
                    if (!filter_var($cols['email'], FILTER_VALIDATE_EMAIL)) {
                        throw new HttpError(422, 'Please enter a valid email address.');
                    }
                }
            },
        ],
    ];
}

function initials_of(string $name): string
{
    $parts = preg_split('/\s+/', trim($name));
    $ini = '';
    foreach (array_slice($parts, 0, 2) as $p) {
        $ini .= mb_strtoupper(mb_substr($p, 0, 1));
    }
    return $ini ?: '?';
}
