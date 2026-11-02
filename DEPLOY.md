# Deploying Creative Advs CRM on Hostinger

The CRM is a static front end (`*.html`, `styles.css`, `assets/`) plus a PHP REST API (`api/`) backed by MySQL. It runs on any Hostinger plan with PHP 7.4+ (8.x recommended) — Premium, Business or Cloud. No Node.js, Composer or build step is needed.

## Run it on your computer (no hosting needed)

The CRM needs PHP and MySQL, so opening the HTML files directly, or with VS Code Live Server,
cannot work. You'll see "PHP is not running on this server". Instead:

1. Install **Docker Desktop** (free) once: https://www.docker.com/products/docker-desktop/
2. Double-click **`start-crm.bat`** in the project folder. The first run downloads PHP and MariaDB
   (a few minutes); after that it starts in seconds. Your browser opens **http://localhost:8088**.
3. Create your admin account, then click **Load demo data** on the Dashboard.

- **Stop:** double-click `stop-crm.bat`. Your data is kept for next time.
- **Start completely fresh:** run `stop-crm.bat --reset` from a terminal (deletes all local data).
- **Edits show immediately:** the project folder is served live, so changes to `.html`, `.css`,
  `.js` and `.php` files appear as soon as you reload the page.
- **Settings:** the local setup uses `local/crm-config.php`, so your `api/config.php` for Hostinger
  stays untouched. Don't upload the `local/` folder or the `.bat` files to Hostinger; `.htaccess`
  blocks them if you do.

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
├── 404.html, 403.html, 500.html, maintenance.html   (error pages)
├── styles.css
├── assets/         (app.js, app.css, *.svg leaf artwork)
└── api/            (index.php, config.php, .htaccess, lib/)
```

You do **not** need to upload `database/`, `DEPLOY.md` or `.git/`. If you do, `.htaccess` blocks access to them.

Make sure the hidden `.htaccess` files are uploaded. In File Manager, enable "Show hidden files".

## 4. First sign-in

1. Open `https://your-domain.com/api/?r=health` — this needs the header, so you should see `{"error":"Missing X-CRM request header."}`. That message means PHP is running.
2. Open `https://your-domain.com/`. You'll be sent to the login page, which shows **Set up your workspace** on first visit.
3. Create the administrator account. Passwords need 8+ characters with a letter and a number or symbol. If you use the seeded email `admin@creativeadvs.com`, your account takes over the sample "Vikram Malhotra" record.
4. Add teammates under **Team & Access** (sidebar, admins only). Give each person a login email and password, and pick a role:

| Role    | View | Add & edit | Delete | Manage team |
|---------|------|------------|--------|-------------|
| Admin   | ✔    | ✔          | ✔      | ✔           |
| Manager | ✔    | ✔          | ✔      | —           |
| Member  | ✔    | ✔          | —      | —           |
| Viewer  | ✔    | —          | —      | —           |

## 5. Turn on HTTPS

Once SSL shows as active in hPanel → **Security → SSL**, open the root `.htaccess` and remove the `#` from the five "Force HTTPS" lines.

## Upgrading an existing installation

If your database was created with an older `schema.sql`, keep your data and run these once
in phpMyAdmin → SQL (both are safe to run twice):

1. `database/migrations/2026-11-02-security-and-indexes.sql` — Security Log table and speed indexes.
2. `database/migrations/2026-11-03-demo-data.sql` — optional: the demo-data button creates its table automatically on first use.

Then upload the new files. Everyone will need to sign in again once.

## Free demo data

Admins see **Load demo data** on the Dashboard (Onboarding Hub and Command Center tabs). Managers, members and viewers don't. One click adds a realistic sample
agency dated around today: 10 clients, 36 leads, 12 deals, follow-ups, 3 onboardings with checklists,
approvals, 6 campaigns, a content calendar, 5 projects with tasks, proposals, 14 invoices with payments,
and any missing months of financials. A brand-new, empty workspace shows a welcome banner offering it.

The same button then reads **Remove demo data** and deletes exactly the rows the demo created; your
own records are never touched. If the button reports that the server is missing the demo feature,
upload the latest `api/index.php` and `api/lib/demo.php`. If you attached your own invoice or payment to a demo client, removal
stops and names those records so you can delete or move them first.

## Security built in

- Passwords are stored with bcrypt; 8–72 characters with a letter and a number or symbol.
- Sign-in locks for 15 minutes after 8 failures from one IP **or** 5 failures on one account.
- Sessions end after 12 hours idle or 7 days in total (`session_lifetime`, `session_absolute` in `api/config.php`).
- Changing a password, an admin reset, or deactivating someone signs out their other sessions immediately.
- Every request needs the `X-CRM` header and a same-site origin, which blocks cross-site request forgery.
- Pages send a Content-Security-Policy, HSTS (on HTTPS), and anti-framing and no-sniff headers. API responses are never cached.
- `api/config.php`, `api/lib/`, `database/` and dotfiles cannot be downloaded.
- **Team & Access → Security Log** (admins only) lists sign-ins, failed attempts, lockouts, password and role changes, with IP and browser.

## Maintenance mode

Set `'maintenance' => true` in `api/config.php`. Everyone except signed-in admins sees the maintenance page, which checks every 30 seconds and returns users to where they were once you set it back to `false`.

## After changing CSS or JavaScript

Browsers cache `styles.css`, `assets/app.css` and `assets/app.js` for 30 days, which makes pages load faster. Every page links them as `?v=11`. When you edit one of these files, change `v=11` to `v=12` in all `*.html` files so everyone gets the new version. HTML pages are never cached.

## Backups

hPanel → **Files → Backups** covers files. For the data, run phpMyAdmin → your database → **Export → Quick → SQL** regularly, for example weekly, and keep the file somewhere off the server.

## Starting with an empty CRM

The sample data is for demonstration. To start clean, run this in phpMyAdmin → SQL (it keeps your users and logins):

```sql
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE activity; TRUNCATE payments; TRUNCATE invoices; TRUNCATE proposals; TRUNCATE tasks;
TRUNCATE milestones; TRUNCATE project_members; TRUNCATE projects; TRUNCATE content_posts;
TRUNCATE campaigns; TRUNCATE approvals; TRUNCATE onboarding_items; TRUNCATE onboardings;
TRUNCATE services; TRUNCATE followups; TRUNCATE deals; TRUNCATE leads; TRUNCATE clients;
TRUNCATE finance_monthly; TRUNCATE saved_reports; TRUNCATE security_log;
SET FOREIGN_KEY_CHECKS = 1;
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red bar "Cannot connect to the database" | Wrong details in `api/config.php`. Re-check the database name, user and password in hPanel. |
| "Database tables are missing" | Import `database/schema.sql` into the right database (step 1.4). |
| Red bar "Server error (500)… Is PHP enabled" | Set PHP 8.x in hPanel → **Advanced → PHP Configuration**, and confirm the `pdo_mysql` extension is enabled there. |
| "Too many failed attempts" | Sign-in locks for 15 minutes after 8 wrong passwords from one IP or 5 on one account. Wait, or run `TRUNCATE login_attempts;` in phpMyAdmin. |
| Error pages show unstyled | The error pages assume the CRM is at the domain root. If it lives in a sub-folder, update the `ErrorDocument` lines in `.htaccess`. |
| Everyone was signed out | Expected after a password change, an admin reset, or when upgrading to this version. |
| Forgot the only admin password | In phpMyAdmin run `UPDATE users SET password_hash = NULL WHERE role = 'admin';`, then open the login page to run setup again. |
| Need to see the actual SQL error | Temporarily set `'debug' => true` in `api/config.php`, reproduce the error, then set it back to `false`. |

## API reference

Every request goes to `api/index.php` with the header `X-CRM: 1` and the session cookie set by login.

| Route | Methods | Purpose |
|---|---|---|
| `?r=auth/status` | GET | Current user and whether first-run setup is needed |
| `?r=auth/setup` | POST | Create the first admin (only while none exists) |
| `?r=auth/login` / `auth/logout` | POST | Start / end a session |
| `?r=auth/password` | POST | Change your own password `{current, new}`; signs out other sessions |
| `?r=security_log` | GET | Security events (admins only) |
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
