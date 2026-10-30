<?php
/**
 * Generic, resource-driven CRUD engine.
 *   GET    ?r=leads              list (filters: any writable field, q=search, limit=N)
 *   GET    ?r=leads&id=5         one record
 *   POST   ?r=leads              create
 *   PUT    ?r=leads&id=5         update (partial — only sent fields change)
 *   DELETE ?r=leads&id=5         delete
 */
defined('CRM') or exit;

function resource(string $name): array
{
    $all = resources();
    if (!isset($all[$name])) {
        throw new HttpError(404, "Unknown resource '$name'.");
    }
    return $all[$name];
}

function select_sql(array $res): string
{
    $parts = ['t.id AS `id`'];
    foreach ($res['fields'] as $key => $f) {
        if (!empty($f['hidden']) || (!isset($f['expr']) && !isset($f['col']))) {
            continue;
        }
        $parts[] = ($f['expr'] ?? 't.' . $f['col']) . " AS `$key`";
    }
    $parts[] = 't.created_at AS `createdAt`';
    return 'SELECT ' . implode(', ', $parts) . ' FROM ' . ($res['from'] ?? $res['table'] . ' t');
}

function cast_row(array $res, array $row): array
{
    $row['id'] = (int) $row['id'];
    $row['createdAt'] = iso_datetime($row['createdAt']);
    foreach ($res['fields'] as $key => $f) {
        if (!array_key_exists($key, $row) || $row[$key] === null) {
            continue;
        }
        $v = $row[$key];
        switch ($f['type'] ?? 'str') {
            case 'int':      $row[$key] = (int) $v; break;
            case 'num':      $row[$key] = (float) $v; break;
            case 'bool':     $row[$key] = (bool) (int) $v; break;
            case 'datetime': $row[$key] = iso_datetime($v); break;
            case 'csv':      $row[$key] = $v === '' ? [] : explode(',', $v); break;
        }
    }
    foreach ($res['fields'] as $key => $f) {
        if (($f['type'] ?? '') === 'csv' && ($row[$key] ?? null) === null && array_key_exists($key, $row)) {
            $row[$key] = [];
        }
    }
    return $row;
}

function iso_datetime(?string $v): ?string
{
    return $v === null ? null : (new DateTime($v))->format(DATE_ATOM);
}

/** Validate input against the field map and return [column => value]. */
function input_to_columns(array $res, array $in, bool $create): array
{
    $cols = [];
    $errors = [];
    foreach ($res['fields'] as $key => $f) {
        $writable = isset($f['col']) && empty($f['ro']) && empty($f['virtual']);
        if (!array_key_exists($key, $in)) {
            if ($create && !empty($f['required'])) {
                $errors[$key] = 'is required';
            }
            continue;
        }
        if (!$writable) {
            continue;
        }
        $v = $in[$key];
        $type = $f['type'] ?? 'str';
        $empty = $v === null || (is_string($v) && trim($v) === '');

        if ($empty) {
            if (!empty($f['required'])) {
                $errors[$key] = 'is required';
            } elseif (!empty($f['nullable'])) {
                $cols[$f['col']] = null;
            } elseif ($type === 'str' && empty($f['enum'])) {
                $cols[$f['col']] = '';
            }
            continue; // non-nullable typed field left empty → keep default / current value
        }

        if (is_array($v)) {
            $errors[$key] = 'must be a single value';
            continue;
        }
        if (!empty($f['enum']) && !in_array($v, $f['enum'], true)) {
            $errors[$key] = 'must be one of: ' . implode(', ', $f['enum']);
            continue;
        }

        switch ($type) {
            case 'int':
                if (filter_var($v, FILTER_VALIDATE_INT) === false) { $errors[$key] = 'must be a whole number'; continue 2; }
                $v = (int) $v;
                break;
            case 'num':
                if (!is_numeric($v)) { $errors[$key] = 'must be a number'; continue 2; }
                $v = (float) $v;
                break;
            case 'bool':
                $v = filter_var($v, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
                break;
            case 'date':
                $v = substr((string) $v, 0, 10);
                $d = DateTime::createFromFormat('!Y-m-d', $v);
                if (!$d || $d->format('Y-m-d') !== $v) { $errors[$key] = 'must be a date (YYYY-MM-DD)'; continue 2; }
                break;
            case 'datetime':
                try {
                    $d = new DateTime((string) $v);
                    $d->setTimezone(new DateTimeZone(date_default_timezone_get()));
                    $v = $d->format('Y-m-d H:i:s');
                } catch (Exception $e) {
                    $errors[$key] = 'must be a date and time';
                    continue 2;
                }
                break;
            default:
                $v = trim((string) $v);
                if (mb_strlen($v) > ($f['max'] ?? 255)) { $errors[$key] = 'is too long'; continue 2; }
        }
        $cols[$f['col']] = $v;
    }
    // Validate virtual enums too (e.g. invoice payment method).
    foreach ($res['fields'] as $key => $f) {
        if (!empty($f['virtual']) && !empty($f['enum']) && isset($in[$key]) && $in[$key] !== '' && !in_array($in[$key], $f['enum'], true)) {
            $errors[$key] = 'must be one of: ' . implode(', ', $f['enum']);
        }
    }
    if ($errors) {
        $msg = [];
        foreach ($errors as $k => $e) {
            $msg[] = "$k $e";
        }
        throw new HttpError(422, 'Please check: ' . implode('; ', $msg) . '.', $errors);
    }
    return $cols;
}

function fetch_one(array $res, int $id): ?array
{
    $st = db()->prepare(select_sql($res) . ' WHERE t.id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ? cast_row($res, $row) : null;
}

function fetch_raw(array $res, int $id): ?array
{
    $st = db()->prepare("SELECT * FROM {$res['table']} WHERE id = ?");
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function crud_list(array $res): array
{
    $where = [];
    $args = [];
    foreach ($res['fields'] as $key => $f) {
        if (isset($f['col'], $_GET[$key]) && $_GET[$key] !== '') {
            $where[] = "t.{$f['col']} = ?";
            $args[] = $_GET[$key];
        }
    }
    if (!empty($_GET['q'])) {
        $like = [];
        foreach ($res['fields'] as $f) {
            if (isset($f['col']) && ($f['type'] ?? 'str') === 'str' && empty($f['enum'])) {
                $like[] = "t.{$f['col']} LIKE ?";
                $args[] = '%' . $_GET['q'] . '%';
            }
        }
        if ($like) {
            $where[] = '(' . implode(' OR ', $like) . ')';
        }
    }
    $sql = select_sql($res) . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY ' . $res['order'];
    $limit = min(1000, max(1, (int) ($_GET['limit'] ?? $res['limit'] ?? 1000)));
    $sql .= " LIMIT $limit";

    $st = db()->prepare($sql);
    $st->execute($args);
    return array_map(function ($r) use ($res) { return cast_row($res, $r); }, $st->fetchAll());
}

function crud_write(string $name, array $res, ?int $id): array
{
    $me = require_role($res['write'] ?? 'member');
    $in = body();
    $old = null;
    if ($id) {
        $old = fetch_raw($res, $id);
        if (!$old) {
            throw new HttpError(404, $res['singular'] . ' not found.');
        }
    }
    $op = $id ? 'update' : 'create';
    $cols = input_to_columns($res, $in, !$id);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        if (isset($res['before'])) {
            $res['before']($cols, $old, $in, $op);
        }
        if ($id) {
            if ($cols) {
                $set = implode(', ', array_map(function ($c) { return "`$c` = ?"; }, array_keys($cols)));
                $pdo->prepare("UPDATE {$res['table']} SET $set WHERE id = ?")->execute(array_merge(array_values($cols), [$id]));
            }
        } else {
            $names = implode(', ', array_map(function ($c) { return "`$c`"; }, array_keys($cols)));
            $marks = implode(', ', array_fill(0, count($cols), '?'));
            $pdo->prepare("INSERT INTO {$res['table']} ($names) VALUES ($marks)")->execute(array_values($cols));
            $id = (int) $pdo->lastInsertId();
        }

        $override = isset($res['after']) ? $res['after']($id, $in, $old, $op, fetch_one($res, $id)) : null;
        $row = fetch_one($res, $id);

        if (($res['log'] ?? true) !== false) {
            if ($override) {
                log_activity($override[0], $override[1], $override[2] ?? null, $name, $id);
            } elseif ($op === 'create' || $name !== 'onboarding_items') {
                $label = (string) ($row[$res['label']] ?? '');
                log_activity($op === 'create' ? 'primary' : 'muted', $res['singular'] . ($op === 'create' ? ' added' : ' updated'), $label, $name, $id);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return $row;
}

function crud_delete(string $name, array $res, int $id): array
{
    $me = require_role($res['delete'] ?? 'manager');
    $row = fetch_one($res, $id);
    if (!$row) {
        throw new HttpError(404, $res['singular'] . ' not found.');
    }
    if ($name === 'users' && $id === $me['id']) {
        throw new HttpError(422, 'You cannot delete your own account.');
    }
    db()->prepare("DELETE FROM {$res['table']} WHERE id = ?")->execute([$id]);
    if (($res['log'] ?? true) !== false) {
        log_activity('danger', $res['singular'] . ' deleted', (string) ($row[$res['label']] ?? ''), $name, $id);
    }
    return ['ok' => true];
}

function handle_resource(string $name, string $method, ?int $id): void
{
    $res = resource($name);
    switch ($method) {
        case 'GET':
            require_role($res['read'] ?? 'viewer');
            if ($id) {
                $row = fetch_one($res, $id);
                if (!$row) {
                    throw new HttpError(404, $res['singular'] . ' not found.');
                }
                json_out($row);
            }
            json_out(crud_list($res));
            // no break
        case 'POST':
            if (($res['write'] ?? '') === 'none') {
                throw new HttpError(405, 'This resource is read-only.');
            }
            json_out(crud_write($name, $res, $id ?: null), $id ? 200 : 201);
            // no break
        case 'PUT':
        case 'PATCH':
            if (!$id) {
                throw new HttpError(400, 'An id is required.');
            }
            if (($res['write'] ?? '') === 'none') {
                throw new HttpError(405, 'This resource is read-only.');
            }
            json_out(crud_write($name, $res, $id));
            // no break
        case 'DELETE':
            if (!$id) {
                throw new HttpError(400, 'An id is required.');
            }
            json_out(crud_delete($name, $res, $id));
            // no break
        default:
            throw new HttpError(405, 'Method not allowed.');
    }
}
