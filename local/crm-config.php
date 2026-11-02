<?php
/**
 * Configuration used ONLY when running the CRM on your computer with start-crm.bat.
 * It is mounted outside the web root, where the API looks before api/config.php,
 * so your real api/config.php (for Hostinger) stays untouched.
 */
defined('CRM') or exit;

return [
    'db' => [
        'host'     => 'db',          // the database container
        'port'     => 3306,
        'name'     => 'crm',
        'user'     => 'crm',
        'password' => 'crm-local-only',
    ],
    'session_name'     => 'omnicrm_sid',
    'session_lifetime' => 43200,
    'session_absolute' => 604800,
    'maintenance'      => false,
    'debug'            => true,     // show real error details while developing locally
    'timezone'         => 'Asia/Kolkata',
];
