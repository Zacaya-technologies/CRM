<?php
/**
 * OmniAgency CRM — REST API entry point.
 *
 *   GET  api/?r=auth/status          session + first-run status
 *   POST api/?r=auth/setup           create first admin (only when none exists)
 *   POST api/?r=auth/login           { email, password }
 *   POST api/?r=auth/logout
 *   POST api/?r=auth/password        { current, new }
 *   GET  api/?r=dashboard            command-center aggregates
 *   GET|POST|PUT|DELETE api/?r=<resource>[&id=N]   see lib/resources.php
 *
 * Every request must send the header "X-CRM: 1" (blocks cross-site form posts).
 * PUT/DELETE may also be sent as POST with "X-HTTP-Method-Override".
 */
define('CRM', true);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/resources.php';
require __DIR__ . '/lib/crud.php';
require __DIR__ . '/lib/endpoints.php';

date_default_timezone_set(config()['timezone'] ?? 'UTC');
header('X-Content-Type-Options: nosniff');

try {
    if (($_SERVER['HTTP_X_CRM'] ?? '') !== '1') {
        throw new HttpError(400, 'Missing X-CRM request header.');
    }

    $method = $_SERVER['REQUEST_METHOD'];
    if ($method === 'POST' && !empty($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) {
        $method = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
    }

    start_session();

    $route = trim((string) ($_GET['r'] ?? ''), '/');
    $id = isset($_GET['id']) && ctype_digit((string) $_GET['id']) ? (int) $_GET['id'] : null;

    if ($route === 'health') {
        db()->query('SELECT 1');
        json_out(['ok' => true, 'php' => PHP_VERSION, 'time' => date(DATE_ATOM)]);
    }
    if (strpos($route, 'auth/') === 0) {
        handle_auth(substr($route, 5), $method);
    }
    if ($route === 'dashboard') {
        handle_dashboard();
    }
    if (!preg_match('/^[a-z_]+$/', $route)) {
        throw new HttpError(404, 'Not found.');
    }
    handle_resource($route, $method, $id);
} catch (HttpError $e) {
    json_out(['error' => $e->getMessage(), 'details' => $e->details], $e->status);
} catch (PDOException $e) {
    error_log('CRM DB error: ' . $e->getMessage());
    $debug = !empty(config()['debug']);
    if ($e->getCode() === '23000') {
        $msg = stripos($e->getMessage(), 'Duplicate') !== false
            ? 'That value is already used by another record (e.g. email or number).'
            : 'This record is linked to other records (or references one that does not exist), so it cannot be saved or deleted.';
        json_out(['error' => $msg, 'details' => $debug ? $e->getMessage() : null], 409);
    }
    $msg = preg_match('/\[(1044|1045|1049|2002|2005|2006)\]/', $e->getMessage())
        ? 'Cannot connect to the database. Check api/config.php.'
        : (stripos($e->getMessage(), "doesn't exist") !== false
            ? 'Database tables are missing. Import database/schema.sql in phpMyAdmin.'
            : 'Database error.');
    json_out(['error' => $msg, 'details' => $debug ? $e->getMessage() : null], 500);
} catch (Throwable $e) {
    error_log('CRM error: ' . $e);
    json_out(['error' => 'Server error.', 'details' => !empty(config()['debug']) ? $e->getMessage() : null], 500);
}
