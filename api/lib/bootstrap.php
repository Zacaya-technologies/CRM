<?php
/**
 * Core helpers: config, PDO connection, JSON I/O, sessions and auth guards.
 */
defined('CRM') or exit;

const ROLE_RANK = ['viewer' => 0, 'member' => 1, 'manager' => 2, 'admin' => 3];
const MAX_BODY_BYTES = 1048576; // 1 MB of JSON is far more than any form sends

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        // Prefer a config file kept outside the web root, if present.
        $outside = dirname(__DIR__, 3) . '/crm-config.php';
        $cfg = is_file($outside) ? require $outside : require dirname(__DIR__) . '/config.php';
    }
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config()['db'];
        $dsn = "mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset=utf8mb4";
        $pdo = new PDO($dsn, $c['user'], $c['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        // Keep MySQL's NOW()/CURDATE() in step with PHP's timezone.
        $pdo->exec("SET time_zone = '" . (new DateTime())->format('P') . "'");
    }
    return $pdo;
}

final class HttpError extends Exception
{
    public $status;
    public $details;

    public function __construct(int $status, string $message, $details = null)
    {
        parent::__construct($message);
        $this->status = $status;
        $this->details = $details;
    }
}

/** Headers sent with every API response: JSON is never cached, framed or sniffed. */
function security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Cross-Origin-Resource-Policy: same-origin');
    if (is_https()) {
        header('Strict-Transport-Security: max-age=31536000');
    }
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'; // Hostinger CDN / proxies
}

/**
 * Reject writes coming from another site. The X-CRM header already forces a CORS
 * pre-flight; this is defence in depth for browsers that send an Origin header.
 */
function check_origin(string $method): void
{
    if ($method === 'GET' || empty($_SERVER['HTTP_ORIGIN'])) {
        return;
    }
    $origin = parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_HOST);
    $host = preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));
    if (!$origin || strcasecmp($origin, $host) !== 0) {
        throw new HttpError(403, 'Cross-site request blocked.');
    }
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array
{
    static $data = null;
    if ($data === null) {
        $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
        if (strlen($raw) > MAX_BODY_BYTES) {
            throw new HttpError(413, 'Request is too large.');
        }
        $data = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($data)) {
            throw new HttpError(400, 'Request body must be a JSON object.');
        }
    }
    return $data;
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $cfg = config();
    session_name($cfg['session_name']);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.gc_maxlifetime', (string) $cfg['session_lifetime']);
    ini_set('session.use_strict_mode', '1');   // never adopt a session id the server didn't issue
    ini_set('session.use_only_cookies', '1');
    session_start();

    // Expire idle sessions, and every session after an absolute maximum age.
    $now = time();
    $maxAge = (int) ($cfg['session_absolute'] ?? 604800);
    if ((isset($_SESSION['seen']) && $now - $_SESSION['seen'] > $cfg['session_lifetime'])
        || (isset($_SESSION['born']) && $now - $_SESSION['born'] > $maxAge)) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['seen'] = $now;
}

/** Short fingerprint of a password hash: changing the password signs out every other session. */
function password_stamp(?string $hash): string
{
    return substr(hash('sha256', (string) $hash), 0, 16);
}

function end_session(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => $p['samesite']]);
        session_destroy();
    }
}

/** The logged-in user row (without password hash), or null. */
function current_user(): ?array
{
    static $user = false;
    if ($user === false) {
        $user = null;
        if (!empty($_SESSION['uid'])) {
            $st = db()->prepare('SELECT id, name, initials, email, role, title, password_hash FROM users WHERE id = ? AND active = 1');
            $st->execute([$_SESSION['uid']]);
            $user = $st->fetch() ?: null;
            // Password changed (or removed) since this session signed in → treat as signed out.
            if ($user && !hash_equals((string) ($_SESSION['pw'] ?? ''), password_stamp($user['password_hash']))) {
                $_SESSION = [];
                $user = null;
            }
            if ($user) {
                unset($user['password_hash']);
                $user['id'] = (int) $user['id'];
            }
        }
    }
    return $user;
}

function require_user(): array
{
    $u = current_user();
    if (!$u) {
        throw new HttpError(401, 'Please sign in.');
    }
    return $u;
}

function require_role(string $min): array
{
    $u = require_user();
    if (ROLE_RANK[$u['role']] < ROLE_RANK[$min]) {
        throw new HttpError(403, 'Your role does not allow this action.');
    }
    return $u;
}

/** Append an entry to the activity / audit feed. Never breaks the request. */
function log_activity(string $kind, string $title, ?string $detail = null, ?string $entity = null, ?int $entityId = null): void
{
    try {
        $u = current_user();
        db()->prepare('INSERT INTO activity (user_id, kind, title, detail, entity, entity_id) VALUES (?,?,?,?,?,?)')
            ->execute([$u['id'] ?? null, $kind, mb_substr($title, 0, 200), $detail ? mb_substr($detail, 0, 255) : null, $entity, $entityId]);
    } catch (Throwable $e) {
        error_log('activity log failed: ' . $e->getMessage());
    }
}

/**
 * Record a sign-in / account security event for the admin Security Log.
 * Never breaks the request (the table may not exist on an older install).
 */
function log_security(string $event, ?string $email = null, ?int $userId = null, ?string $detail = null): void
{
    try {
        db()->prepare('INSERT INTO security_log (event, user_id, email, ip, user_agent, detail) VALUES (?,?,?,?,?,?)')
            ->execute([
                $event, $userId, $email ? mb_substr($email, 0, 190) : null,
                substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45),
                mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                $detail ? mb_substr($detail, 0, 255) : null,
            ]);
    } catch (Throwable $e) {
        error_log('security log failed: ' . $e->getMessage());
    }
}
