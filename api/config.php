<?php
/**
 * OmniAgency CRM — server configuration.
 *
 * Fill in the MySQL details from Hostinger hPanel → Databases → MySQL Databases.
 * On Hostinger the host is almost always "localhost"; the database name and
 * user both start with your account prefix, e.g. "u123456789_crm".
 *
 * Tip: for extra safety you can move this file one level ABOVE public_html
 * (e.g. /home/u123456789/crm-config.php). The API looks there first.
 */
defined('CRM') or exit;

return [
    'db' => [
        'host'     => 'localhost',
        'port'     => 3306,
        'name'     => 'u123456789_crm',      // ← your database name
        'user'     => 'u123456789_crmuser',  // ← your database user
        'password' => 'CHANGE_ME',           // ← your database password
    ],

    // Session cookie name and lifetime (seconds). 12 hours by default.
    'session_name'     => 'omnicrm_sid',
    'session_lifetime' => 43200,

    // Set to true only while debugging — shows SQL errors in API responses.
    'debug' => false,

    // Timezone used for "today", overdue checks and timestamps.
    'timezone' => 'Asia/Kolkata',
];
