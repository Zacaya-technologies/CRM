<?php
/**
 * Core helpers: config, PDO connection, JSON I/O, sessions and auth guards.
 */
defined('CRM') or exit;

const ROLE_RANK = ['viewer' => 0, 'member' => 1, 'manager' => 2, 'admin' => 3];

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
        $raw = file_get_contents('php://input');
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
        'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.gc_maxlifetime', (string) $cfg['session_lifetime']);
    session_start();

    // Expire idle sessions.
    $now = time();
    if (isset($_SESSION['seen']) && $now - $_SESSION['seen'] > $cfg['session_lifetime']) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['seen'] = $now;
}

/** The logged-in user row (without password hash), or null. */
function current_user(): ?array
{
    static $user = false;
    if ($user === false) {
        $user = null;
        if (!empty($_SESSION['uid'])) {
            $st = db()->prepare('SELECT id, name, initials, email, role, title FROM users WHERE id = ? AND active = 1');
            $st->execute([$_SESSION['uid']]);
            $user = $st->fetch() ?: null;
            if ($user) {
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
