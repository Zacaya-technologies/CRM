# Deploying OmniAgency CRM on Hostinger

The CRM is a static front end (`*.html`, `styles.css`, `assets/`) plus a PHP REST API (`api/`) backed by MySQL. It runs on any Hostinger plan with PHP 7.4+ (8.x recommended) — Premium, Business or Cloud. No Node.js, Composer or build step is needed.

## 1. Create the database

1. hPanel → **Databases → MySQL Databases**.
2. Create a database and a user (for example `u123456789_crm` / `u123456789_crmuser`) with a strong password. Write all three down.
3. Click **Enter phpMyAdmin** next to the new database.
4. In phpMyAdmin, select the database in the left column → **Import** → choose `database/schema.sql` → **Go**.
   This creates all tables and loads the sample agency data. Re-importing wipes and recreates everything.

## 2. Configure the API

Edit `api/config.php` and fill in the values from step 1:

```php
'db' => [
    'host'     => 'localhost',
    'port'     => 3306,
    'name'     => 'u123456789_crm',
    'user'     => 'u123456789_crmuser',
    'password' => 'your-db-password',
],
'timezone' => 'Asia/Kolkata',
```

**Optional, more secure:** copy the finished file to `/home/<your-user>/crm-config.php` (one level above `public_html`), then put the placeholder values back in `api/config.php`. The API reads the file outside `public_html` first if it exists.

## 3. Upload the files

hPanel → **Files → File Manager → public_html** (or use FTP / Git). Upload:

```
public_html/
├── .htaccess
├── index.html, login.html, team.html, …all other *.html
├── styles.css
├── assets/         (app.js, app.css)
└── api/            (index.php, config.php, .htaccess, lib/)
```

You do **not** need to upload `database/`, `DEPLOY.md` or `.git/`. If you do, `.htaccess` blocks access to them.

Make sure the hidden `.htaccess` files are uploaded. In File Manager, enable "Show hidden files".

## 4. First sign-in

1. Open `https://your-domain.com/api/?r=health` — this needs the header, so you should see `{"error":"Missing X-CRM request header."}`. That message means PHP is running.
2. Open `https://your-domain.com/`. You'll be sent to the login page, which shows **Set up your workspace** on first visit.
3. Create the administrator account. If you use the seeded email `admin@apexdigital.agency`, your account takes over the sample "Vikram Malhotra" record.
4. Add teammates under **Team & Access** (sidebar, admins only). Give each person a login email and password, and pick a role:

| Role    | View | Add & edit | Delete | Manage team |
|---------|------|------------|--------|-------------|
| Admin   | ✔    | ✔          | ✔      | ✔           |
| Manager | ✔    | ✔          | ✔      | —           |
| Member  | ✔    | ✔          | —      | —           |
| Viewer  | ✔    | —          | —      | —           |

## 5. Turn on HTTPS

Once SSL shows as active in hPanel → **Security → SSL**, open the root `.htaccess` and remove the `#` from the five "Force HTTPS" lines.

## Starting with an empty CRM

The sample data is for demonstration. To start clean, run this in phpMyAdmin → SQL (it keeps your users and logins):

```sql
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE activity; TRUNCATE payments; TRUNCATE invoices; TRUNCATE proposals; TRUNCATE tasks;
TRUNCATE milestones; TRUNCATE project_members; TRUNCATE projects; TRUNCATE content_posts;
TRUNCATE campaigns; TRUNCATE approvals; TRUNCATE onboarding_items; TRUNCATE onboardings;
TRUNCATE services; TRUNCATE followups; TRUNCATE deals; TRUNCATE leads; TRUNCATE clients;
TRUNCATE finance_monthly; TRUNCATE saved_reports;
SET FOREIGN_KEY_CHECKS = 1;
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red bar "Cannot connect to the database" | Wrong details in `api/config.php`. Re-check the database name, user and password in hPanel. |
| "Database tables are missing" | Import `database/schema.sql` into the right database (step 1.4). |
| Red bar "Server error (500)… Is PHP enabled" | Set PHP 8.x in hPanel → **Advanced → PHP Configuration**, and confirm the `pdo_mysql` extension is enabled there. |
| "Too many failed attempts" | Sign-in locks for 15 minutes after 8 wrong passwords from one IP. Wait, or run `TRUNCATE login_attempts;` in phpMyAdmin. |
| Forgot the only admin password | In phpMyAdmin run `UPDATE users SET password_hash = NULL WHERE role = 'admin';`, then open the login page to run setup again. |
| Need to see the actual SQL error | Temporarily set `'debug' => true` in `api/config.php`, reproduce the error, then set it back to `false`. |

## API reference

Every request goes to `api/index.php` with the header `X-CRM: 1` and the session cookie set by login.

| Route | Methods | Purpose |
|---|---|---|
| `?r=auth/status` | GET | Current user and whether first-run setup is needed |
| `?r=auth/setup` | POST | Create the first admin (only while none exists) |
| `?r=auth/login` / `auth/logout` | POST | Start / end a session |
| `?r=auth/password` | POST | Change your own password `{current, new}` |
| `?r=dashboard` | GET | Command Center aggregates |
| `?r=<resource>` | GET, POST | List (filter by any field, `q=` search, `limit=`) / create |
| `?r=<resource>&id=N` | GET, PUT, DELETE | Read / update (partial) / delete |

Resources: `leads, clients, deals, followups, services, onboardings, onboarding_items, approvals, campaigns, posts, projects, milestones, tasks, proposals, invoices, payments, finance, saved_reports, activity, users`. Their fields are defined in `api/lib/resources.php`.

Automatic behaviour:
- New invoices and proposals get the next number (`INV-1089`, `PR-2026-042`).
- Marking an invoice paid records a settled payment.
- Moving a deal stage records the time it changed.
- Deciding an approval records who decided it and when.
- A new onboarding gets the standard 15-gate checklist.
- Every change is written to the activity log.

## Features that still need third-party accounts

These panels in the original design are still illustrative content. Making them live needs API keys from those services:
- **Campaign Lab:** creative split tests, landing-page health and the AI recommendation (Meta / Google Ads APIs).
- **Lead routing rules and invoice auto-reminders:** these need a cron job plus an email or WhatsApp provider.

Campaign metrics (spend, ROAS, impressions and so on) are entered or edited by hand in each campaign's form.
