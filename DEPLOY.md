# Deploying Creative Advs CRM on Hostinger

The CRM is a complete Node.js application: `server.js` serves the pages (`*.html`, `styles.css`, `assets/`)
and the REST API, and stores everything in MySQL. `package.json` lists everything Hostinger needs to
install and start it. There is no build step.

```
package.json        ← Hostinger reads this: installs dependencies, runs "npm start"
server.js           ← entry file
server/             ← API, sign-in, demo data, automatic table setup
database/schema.sql ← table definitions (the app creates the tables itself on first start)
*.html, styles.css, assets/
```

## Deploy on Hostinger (Node.js Web App)

### 1. Create the database

1. hPanel → **Databases → MySQL Databases**.
2. Create a database and a user (for example `u123456789_crm` / `u123456789_crmuser`) with a strong
   password. Write down the database name, user, password and the MySQL host shown on that page.

You do **not** need to import anything in phpMyAdmin: the app creates all tables on its first start.

### 2. Create the Node.js app

1. hPanel → **Websites → Add website → Node.js Apps** (the exact labels may differ slightly).
2. Choose how to send the code:
   - **Upload files:** upload `creative-advs-crm-node.zip`. `package.json` must be at the top level
     of the ZIP, not inside a folder.
   - **Import Git repository:** connect the GitHub repository that holds this project.
3. Build settings:
   - Framework: **Express** (or "Other")
   - Node.js version: **20** or newer (18 works too)
   - Entry file: **server.js**
   - Install command `npm install` and start command `npm start` (usually filled in automatically)
4. **Environment variables.** Add these (values from step 1):

   | Name | Example |
   |---|---|
   | `DB_HOST` | `localhost` (or the MySQL host shown in hPanel) |
   | `DB_NAME` | `u123456789_crm` |
   | `DB_USER` | `u123456789_crmuser` |
   | `DB_PASSWORD` | your database password |
   | `TIMEZONE` | `Asia/Kolkata` |

   Optional: `FORCE_HTTPS=true` once SSL is active, `MAINTENANCE=true`, `DEBUG=true` (only while fixing a problem).
   Hostinger sets `PORT` itself. You don't need to set it.
5. Click **Deploy**. When it finishes, the app log shows
   `Creative Advs CRM running on port …` and, on the first start, `created 24 database tables`.

If your plan has no environment-variable screen, copy `.env.example` to `.env`, fill it in and upload it
with the other files. The server never serves `.env` to browsers.

### 3. First sign-in

1. Open `https://your-domain.com/api/index.php?r=health`. You should see `{"error":"Missing X-CRM request header."}`, which means the app is running.
2. Open `https://your-domain.com/`. You'll be sent to the login page, which shows **Set up your workspace** on first visit.
3. Create the administrator account. Passwords need 8+ characters with a letter and a number or symbol.
4. Click **Load demo data** on the Dashboard if you want sample data to explore.
5. Add teammates under **Team & Access** (sidebar, admins only). Give each person a login email and password, and pick a role:

| Role    | View | Add & edit | Delete | Manage team |
|---------|------|------------|--------|-------------|
| Admin   | ✔    | ✔          | ✔      | ✔           |
| Manager | ✔    | ✔          | ✔      | —           |
| Member  | ✔    | ✔          | —      | —           |
| Viewer  | ✔    | —          | —      | —           |

### 4. HTTPS

Once SSL shows as active for the domain, set the environment variable `FORCE_HTTPS=true` and redeploy / restart the app.

### Updating to a new version

Upload the new ZIP (or push to the connected Git repository) and redeploy. Your data stays in MySQL.
New tables are added automatically on start; existing tables and data are never changed.

### Moving from the PHP version

Point `DB_NAME`, `DB_USER` and `DB_PASSWORD` at your existing database. All data, users and passwords keep
working (both versions use the same tables and bcrypt passwords). Everyone signs in once more.

## Run it on your computer

**Option A: Node.js + any MySQL/MariaDB** (for example XAMPP's MySQL):

```
npm install
copy .env.example .env     (then fill in the DB_ settings)
npm start                  → http://localhost:3000
```

**Option B: Docker (no other installs).** Install **Docker Desktop** once, then double-click
**`start-crm.bat`**. It starts the Node server and a MariaDB database and opens **http://localhost:8088**.
Stop it with `stop-crm.bat` (data is kept); `stop-crm.bat --reset` deletes all local data.

Opening the HTML files directly or with VS Code Live Server cannot work: the pages need the server.

## Free demo data

Admins see **Load demo data** on the Dashboard (Onboarding Hub and Command Center tabs). Managers, members and viewers don't. One click adds a realistic sample
agency dated around today: 10 clients, 36 leads, 12 deals, follow-ups, 3 onboardings with checklists,
approvals, 6 campaigns, a content calendar, 5 projects with tasks, proposals, 14 invoices with payments,
and any missing months of financials. A brand-new, empty workspace shows a welcome banner offering it.

The same button then reads **Remove demo data** and deletes exactly the rows the demo created; your
own records are never touched. If you attached your own invoice or payment to a demo client, removal
stops and names those records so you can delete or move them first.

## Security built in

- Passwords are stored with bcrypt; 8–72 characters with a letter and a number or symbol.
- Sign-in locks for 15 minutes after 8 failures from one IP **or** 5 failures on one account.
- Sessions end after 12 hours idle or 7 days in total (`SESSION_LIFETIME`, `SESSION_ABSOLUTE`).
- Changing a password, an admin reset, or deactivating someone signs out their other sessions immediately.
- Every request needs the `X-CRM` header and a same-site origin, which blocks cross-site request forgery.
- Pages send a Content-Security-Policy, HSTS (on HTTPS), and anti-framing and no-sniff headers. API responses are never cached.
- Only the pages, `styles.css` and `assets/` are public. Server code, `.env`, `database/` and `node_modules/` can never be downloaded.
- **Team & Access → Security Log** (admins only) lists sign-ins, failed attempts, lockouts, password and role changes, with IP and browser.

## Maintenance mode

Set the environment variable `MAINTENANCE=true` and restart the app. Everyone except signed-in admins sees the maintenance page, which checks every 30 seconds and returns users to where they were once you set it back to `false`.

## After changing CSS or JavaScript

Browsers cache `styles.css`, `assets/app.css` and `assets/app.js` for 30 days, which makes pages load faster. Every page links them as `?v=13`. When you edit one of these files, change `v=13` to `v=14` in all `*.html` files so everyone gets the new version. HTML pages are never cached.

## Backups

For the data, run phpMyAdmin → your database → **Export → Quick → SQL** regularly, for example weekly, and keep the file somewhere off the server.

## Starting with an empty CRM

Use **Remove demo data** on the Dashboard. If you imported `database/schema.sql` (which has its own sample rows), run this in phpMyAdmin → SQL instead (it keeps your users and logins):

```sql
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE activity; TRUNCATE payments; TRUNCATE invoices; TRUNCATE proposals; TRUNCATE tasks;
TRUNCATE milestones; TRUNCATE project_members; TRUNCATE projects; TRUNCATE content_posts;
TRUNCATE campaigns; TRUNCATE approvals; TRUNCATE onboarding_items; TRUNCATE onboardings;
TRUNCATE services; TRUNCATE followups; TRUNCATE deals; TRUNCATE leads; TRUNCATE clients;
TRUNCATE finance_monthly; TRUNCATE saved_reports; TRUNCATE security_log; TRUNCATE demo_records;
SET FOREIGN_KEY_CHECKS = 1;
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Hostinger says `package.json` is missing | The ZIP has the files inside a folder. Zip the *contents* of the project folder so `package.json` is at the top level. |
| Red bar "Cannot connect to the database" | Check `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` in the app's environment variables, then restart. Try the MySQL host shown in hPanel if `localhost` doesn't work. |
| "Database tables are missing" | Restart the app; it creates missing tables on start. Check the app log for errors. |
| The site shows a Hostinger error page | Open the app's logs in hPanel. A missing `DB_` setting or a typo in the entry file (`server.js`) is the usual cause. |
| "Too many failed attempts" | Sign-in locks for 15 minutes after 8 wrong passwords from one IP or 5 on one account. Wait, or run `TRUNCATE login_attempts;` in phpMyAdmin. |
| Everyone was signed out | Expected after a password change, an admin reset, or when moving to a new version. |
| Forgot the only admin password | In phpMyAdmin run `UPDATE users SET password_hash = NULL WHERE role = 'admin';`, then open the login page to run setup again. |
| Need to see the actual SQL error | Temporarily set `DEBUG=true`, reproduce the error, then set it back to `false`. |

## API reference

Every request goes to `api/index.php` with the header `X-CRM: 1` and the session cookie set by login.

| Route | Methods | Purpose |
|---|---|---|
| `?r=health` | GET | Server and database check |
| `?r=auth/status` | GET | Current user and whether first-run setup is needed |
| `?r=auth/setup` | POST | Create the first admin (only while none exists) |
| `?r=auth/login` / `auth/logout` | POST | Start / end a session |
| `?r=auth/password` | POST | Change your own password `{current, new}`; signs out other sessions |
| `?r=security_log` | GET | Security events (admins only) |
| `?r=dashboard` | GET | Command Center aggregates |
| `?r=demo/status` / `demo/load` / `demo/remove` | GET / POST | Demo data (admins only) |
| `?r=<resource>` | GET, POST | List (filter by any field, `q=` search, `limit=`) / create |
| `?r=<resource>&id=N` | GET, PUT, DELETE | Read / update (partial) / delete |

Resources: `leads, clients, deals, followups, services, onboardings, onboarding_items, approvals, campaigns, posts, projects, milestones, tasks, proposals, invoices, payments, finance, saved_reports, activity, users`. Their fields are defined in `server/resources.js`.

Automatic behaviour:
- New invoices and proposals get the next number (`INV-1089`, `PR-2026-042`).
- Marking an invoice paid records a settled payment.
- Moving a deal stage records the time it changed.
- Deciding an approval records who decided it and when.
- A new onboarding gets the standard 15-gate checklist.
- Every change is written to the activity log.

## Alternative: PHP shared hosting

The original PHP version of the API is still in `api/` (with the root `.htaccess`). On a plain PHP hosting
plan, upload everything except `server.js`, `server/` and `node_modules/` to `public_html`, import
`database/schema.sql` in phpMyAdmin and fill in `api/config.php`.

## Features that still need third-party accounts

These panels in the original design are still illustrative content. Making them live needs API keys from those services:
- **Campaign Lab:** creative split tests, landing-page health and the AI recommendation (Meta / Google Ads APIs).
- **Lead routing rules and invoice auto-reminders:** these need a scheduled job plus an email or WhatsApp provider.

Campaign metrics (spend, ROAS, impressions and so on) are entered or edited by hand in each campaign's form.
