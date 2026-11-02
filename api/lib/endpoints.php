<?php
/**
 * Non-CRUD endpoints: authentication and the dashboard summary.
 */
defined('CRM') or exit;

const MAX_LOGIN_FAILURES   = 8;   // per IP …
const MAX_ACCOUNT_FAILURES = 5;   // … or per account (stops slow attacks spread across IPs) …
const LOGIN_WINDOW_MIN     = 15;  // … within this many minutes
const MAX_PASSWORD_BYTES   = 72;  // bcrypt ignores anything longer
// A real bcrypt hash (cost 10) of a throw-away string; checked when the email is unknown.
const DUMMY_HASH = '$2y$10$.vGA1O9wmRjrwAVXD98HNOgsNpDczlqm3Jq7KnEd1rVAGv3Fykk1a';

function check_new_password(string $pass, string $email = ''): void
{
    if (strlen($pass) < 8) throw new HttpError(422, 'Password must be at least 8 characters.');
    if (strlen($pass) > MAX_PASSWORD_BYTES) throw new HttpError(422, 'Password must be at most 72 characters.');
    if ($email !== '' && strcasecmp($pass, $email) === 0) throw new HttpError(422, 'Password cannot be the same as the email.');
    if (!preg_match('/[A-Za-z]/', $pass) || !preg_match('/[0-9\W_]/', $pass)) {
        throw new HttpError(422, 'Password needs at least one letter and one number or symbol.');
    }
}

function needs_setup(): bool
{
    return !db()->query('SELECT 1 FROM users WHERE password_hash IS NOT NULL AND role = \'admin\' AND active = 1 LIMIT 1')->fetchColumn();
}

function sign_in(int $uid): array
{
    session_regenerate_id(true);
    $_SESSION['uid'] = $uid;
    $_SESSION['born'] = time();
    $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $st->execute([$uid]);
    $_SESSION['pw'] = password_stamp($st->fetchColumn());
    db()->prepare('UPDATE users SET last_login_at = NOW() WHERE id = ?')->execute([$uid]);
    return current_user_fresh($uid);
}

function current_user_fresh(int $uid): array
{
    $st = db()->prepare('SELECT id, name, initials, email, role, title FROM users WHERE id = ?');
    $st->execute([$uid]);
    $u = $st->fetch();
    $u['id'] = (int) $u['id'];
    return $u;
}

function client_ip(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', 0, 45);
}

function handle_auth(string $action, string $method): void
{
    switch ($action) {
        case 'status':
            json_out(['user' => current_user(), 'needsSetup' => needs_setup()]);
            // no break

        case 'setup':
            // One-time creation of the first administrator.
            if ($method !== 'POST') throw new HttpError(405, 'Method not allowed.');
            if (!needs_setup()) throw new HttpError(403, 'Setup has already been completed.');
            $in = body();
            $name = trim((string) ($in['name'] ?? ''));
            $email = strtolower(trim((string) ($in['email'] ?? '')));
            $pass = (string) ($in['password'] ?? '');
            if ($name === '' || mb_strlen($name) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new HttpError(422, 'Enter your name and a valid email.');
            check_new_password($pass, $email);
            $hash = password_hash($pass, PASSWORD_DEFAULT);

            $st = db()->prepare('SELECT id FROM users WHERE email = ?');
            $st->execute([$email]);
            if ($uid = $st->fetchColumn()) {
                db()->prepare("UPDATE users SET name = ?, password_hash = ?, role = 'admin', active = 1 WHERE id = ?")->execute([$name, $hash, $uid]);
            } else {
                db()->prepare("INSERT INTO users (name, initials, email, password_hash, role, title) VALUES (?,?,?,?, 'admin', 'Administrator')")
                    ->execute([$name, initials_of($name), $email, $hash]);
                $uid = db()->lastInsertId();
            }
            $user = sign_in((int) $uid);
            log_security('setup', $email, (int) $uid, 'First administrator created');
            log_activity('success', 'CRM workspace set up', $name . ' created the administrator account', 'users', (int) $uid);
            json_out(['user' => $user]);
            // no break

        case 'login':
            if ($method !== 'POST') throw new HttpError(405, 'Method not allowed.');
            $ip = client_ip();
            $in = body();
            $email = strtolower(trim((string) ($in['email'] ?? '')));
            $st = db()->prepare('SELECT COALESCE(SUM(ip = ?), 0), COALESCE(SUM(email = ?), 0) FROM login_attempts WHERE attempted_at > NOW() - INTERVAL ' . LOGIN_WINDOW_MIN . ' MINUTE AND (ip = ? OR email = ?)');
            $st->execute([$ip, $email, $ip, $email]);
            [$byIp, $byAccount] = array_map('intval', $st->fetch(PDO::FETCH_NUM));
            if ($byIp >= MAX_LOGIN_FAILURES || $byAccount >= MAX_ACCOUNT_FAILURES) {
                log_security('login_locked', $email, null, $byAccount >= MAX_ACCOUNT_FAILURES ? 'Account temporarily locked' : 'IP temporarily locked');
                throw new HttpError(429, 'Too many failed attempts. Try again in ' . LOGIN_WINDOW_MIN . ' minutes.');
            }
            $st = db()->prepare('SELECT id, password_hash FROM users WHERE email = ? AND active = 1');
            $st->execute([$email]);
            $row = $st->fetch();
            $pass = substr((string) ($in['password'] ?? ''), 0, 4096);
            // Unknown emails are checked against a dummy hash so timing doesn't reveal which accounts exist.
            $hash = ($row && $row['password_hash']) ? $row['password_hash'] : DUMMY_HASH;
            if (!password_verify($pass, $hash) || !$row || !$row['password_hash']) {
                db()->prepare('INSERT INTO login_attempts (ip, email) VALUES (?, ?)')->execute([$ip, mb_substr($email, 0, 190)]);
                log_security('login_failed', $email, $row ? (int) $row['id'] : null);
                usleep(400000);
                throw new HttpError(401, 'Incorrect email or password.');
            }
            if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
                db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $row['id']]);
            }
            db()->prepare('DELETE FROM login_attempts WHERE ip = ? OR email = ? OR attempted_at < NOW() - INTERVAL 1 DAY')->execute([$ip, $email]);
            $user = sign_in((int) $row['id']);
            log_security('login', $email, (int) $row['id']);
            json_out(['user' => $user]);
            // no break

        case 'logout':
            if ($u = current_user()) log_security('logout', $u['email'], $u['id']);
            end_session();
            json_out(['ok' => true]);
            // no break

        case 'password':
            if ($method !== 'POST') throw new HttpError(405, 'Method not allowed.');
            $me = require_user();
            $in = body();
            $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
            $st->execute([$me['id']]);
            if (!password_verify((string) ($in['current'] ?? ''), (string) $st->fetchColumn())) {
                throw new HttpError(422, 'Your current password is incorrect.');
            }
            $new = (string) ($in['new'] ?? '');
            check_new_password($new, (string) $me['email']);
            if ($new === (string) ($in['current'] ?? '')) throw new HttpError(422, 'Choose a password different from your current one.');
            $hash = password_hash($new, PASSWORD_DEFAULT);
            db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $me['id']]);
            // This session stays signed in; every other session for the account is signed out.
            session_regenerate_id(true);
            $_SESSION['pw'] = password_stamp($hash);
            log_security('password_changed', $me['email'], $me['id']);
            json_out(['ok' => true]);
            // no break

        default:
            throw new HttpError(404, 'Unknown auth action.');
    }
}

/** Aggregates for the Command Center dashboard. */
function handle_dashboard(): void
{
    require_user();
    $pdo = db();
    $one = function (string $sql) use ($pdo) { return $pdo->query($sql)->fetch(); };

    $leads = $one("SELECT COUNT(*) total, SUM(status = 'New') new_count, SUM(status = 'Qualified') qualified,
                          SUM(created_at >= NOW() - INTERVAL 7 DAY) this_week FROM leads");
    $clients = $one("SELECT COUNT(*) active, COALESCE(SUM(mrr), 0) mrr FROM clients WHERE status = 'active'");
    $live = $one("SELECT COUNT(*) n FROM campaigns WHERE status = 'live'");
    $inv = $one("SELECT COALESCE(SUM(CASE WHEN paid_date IS NULL THEN amount END), 0) outstanding,
                        COALESCE(SUM(CASE WHEN paid_date IS NULL AND due_date < CURDATE() THEN amount END), 0) overdue,
                        COALESCE(SUM(amount), 0) billed, COALESCE(SUM(CASE WHEN paid_date IS NOT NULL THEN amount END), 0) paid
                 FROM invoices");

    $sources = $pdo->query('SELECT source, COUNT(*) n FROM leads GROUP BY source ORDER BY n DESC')->fetchAll();
    $stages = $pdo->query("SELECT stage, COUNT(*) n, COALESCE(SUM(value), 0) value FROM deals WHERE stage <> 'lost' GROUP BY stage")->fetchAll();
    $velocity = $one("SELECT ROUND(AVG(DATEDIFF(stage_changed_at, created_at))) days FROM deals WHERE stage = 'won'");
    $finance = $pdo->query('SELECT month, revenue, expenses FROM finance_monthly ORDER BY month DESC LIMIT 6')->fetchAll();
    $activityCount = (int) $pdo->query('SELECT COUNT(*) FROM activity')->fetchColumn();

    json_out([
        'leads' => [
            'total' => (int) $leads['total'], 'new' => (int) $leads['new_count'],
            'qualified' => (int) $leads['qualified'], 'thisWeek' => (int) $leads['this_week'],
        ],
        'clients' => ['active' => (int) $clients['active'], 'mrr' => (float) $clients['mrr']],
        'liveCampaigns' => (int) $live['n'],
        'invoices' => [
            'outstanding' => (float) $inv['outstanding'], 'overdue' => (float) $inv['overdue'],
            'collectedPct' => $inv['billed'] > 0 ? round($inv['paid'] / $inv['billed'] * 100) : 0,
        ],
        'sources' => array_map(function ($s) { return ['source' => $s['source'], 'n' => (int) $s['n']]; }, $sources),
        'stages' => array_map(function ($s) { return ['stage' => $s['stage'], 'n' => (int) $s['n'], 'value' => (float) $s['value']]; }, $stages),
        'velocityDays' => $velocity['days'] !== null ? (int) $velocity['days'] : null,
        'revenue' => array_reverse(array_map(function ($f) {
            return ['month' => $f['month'], 'revenue' => (float) $f['revenue'], 'expenses' => (float) $f['expenses']];
        }, $finance)),
        'activityCount' => $activityCount,
    ]);
}
