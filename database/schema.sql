-- =====================================================================
--  OmniAgency Enterprise CRM — MySQL / MariaDB schema + seed data
--  Import this file once in Hostinger hPanel → Databases → phpMyAdmin
--  (select your database first, then Import → choose this file → Go).
--  Compatible with MySQL 5.7+, MySQL 8 and MariaDB 10.3+.
-- =====================================================================

SET NAMES utf8mb4;
-- Seed timestamps (NOW(), CURRENT_TIMESTAMP) are written in this timezone.
-- Keep it in step with 'timezone' in api/config.php (Asia/Kolkata = +05:30).
SET time_zone = '+05:30';
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS login_attempts, activity, saved_reports, finance_monthly, payments, invoices,
  proposals, tasks, milestones, project_members, projects, content_posts, campaigns,
  approvals, onboarding_items, onboardings, services, followups, deals, leads,
  clients, users;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
--  Users = team members. A user can log in only once a password is set.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  initials      VARCHAR(4)   NOT NULL,
  email         VARCHAR(190) NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  role          ENUM('admin','manager','member','viewer') NOT NULL DEFAULT 'member',
  title         VARCHAR(120) NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE clients (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(160) NOT NULL,
  industry     VARCHAR(120) NULL,
  email        VARCHAR(190) NULL,
  phone        VARCHAR(40)  NULL,
  mrr          DECIMAL(12,2) NOT NULL DEFAULT 0,
  health       TINYINT UNSIGNED NOT NULL DEFAULT 75,
  renewal_date DATE NULL,
  status       ENUM('active','paused','churned') NOT NULL DEFAULT 'active',
  owner_id     INT UNSIGNED NULL,
  color1       VARCHAR(9) NOT NULL DEFAULT '#8B7FF5',
  color2       VARCHAR(9) NOT NULL DEFAULT '#5145E8',
  revenue_ytd  DECIMAL(14,2) NOT NULL DEFAULT 0,
  cost_ytd     DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_clients_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leads (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  company    VARCHAR(160) NULL,
  email      VARCHAR(190) NULL,
  phone      VARCHAR(40)  NULL,
  source     VARCHAR(60)  NOT NULL DEFAULT 'Website Form',
  score      TINYINT UNSIGNED NOT NULL DEFAULT 50,
  status     ENUM('New','Contacted','Qualified','Unqualified') NOT NULL DEFAULT 'New',
  owner_id   INT UNSIGNED NULL,
  notes      TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_leads_status (status),
  CONSTRAINT fk_leads_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE deals (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(160) NOT NULL,
  industry         VARCHAR(120) NULL,
  tag              VARCHAR(60)  NULL,
  value            DECIMAL(12,2) NOT NULL DEFAULT 0,
  stage            ENUM('discovery','pitch','negotiation','won','lost') NOT NULL DEFAULT 'discovery',
  owner_id         INT UNSIGNED NULL,
  stage_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_deals_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE followups (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type       ENUM('call','mail','wa','meet') NOT NULL DEFAULT 'call',
  title      VARCHAR(200) NOT NULL,
  details    VARCHAR(255) NULL,
  owner_id   INT UNSIGNED NULL,
  due_at     DATETIME NOT NULL,
  done       TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_followups_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE services (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  icon           ENUM('ads','seo','social','content','email','creative') NOT NULL DEFAULT 'ads',
  name           VARCHAR(160) NOT NULL,
  description    VARCHAR(500) NULL,
  tier           ENUM('Core','Add-on') NOT NULL DEFAULT 'Core',
  active_clients INT UNSIGNED NOT NULL DEFAULT 0,
  mrr            DECIMAL(12,2) NOT NULL DEFAULT 0,
  revenue_ytd    DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE onboardings (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id  INT UNSIGNED NOT NULL,
  gate       VARCHAR(160) NULL,
  blocker    VARCHAR(160) NULL,
  lead_id    INT UNSIGNED NULL,
  go_live    DATE NULL,
  status     ENUM('active','completed') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_onb_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_onb_lead FOREIGN KEY (lead_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE onboarding_items (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  onboarding_id INT UNSIGNED NOT NULL,
  category      VARCHAR(120) NOT NULL,
  sort          SMALLINT NOT NULL DEFAULT 0,
  title         VARCHAR(200) NOT NULL,
  detail        VARCHAR(255) NULL,
  badge         VARCHAR(60)  NULL,
  done          TINYINT(1) NOT NULL DEFAULT 0,
  flag          ENUM('none','critical','resend','join') NOT NULL DEFAULT 'none',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_items_onb (onboarding_id, sort),
  CONSTRAINT fk_items_onb FOREIGN KEY (onboarding_id) REFERENCES onboardings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approvals (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id    INT UNSIGNED NOT NULL,
  item         VARCHAR(200) NOT NULL,
  type         ENUM('Creative','Budget','Contract') NOT NULL DEFAULT 'Creative',
  preview      VARCHAR(500) NULL,
  status       ENUM('pending','approved','changes') NOT NULL DEFAULT 'pending',
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at       DATETIME NULL,
  decided_at   DATETIME NULL,
  decided_by   INT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appr_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_appr_user FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campaigns (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  client_id     INT UNSIGNED NULL,
  channel       ENUM('meta','google','linkedin','youtube') NOT NULL DEFAULT 'meta',
  status        ENUM('live','paused','scheduled','ended') NOT NULL DEFAULT 'scheduled',
  status_note   VARCHAR(60) NULL,
  objective     VARCHAR(255) NULL,
  pace          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  spend         DECIMAL(12,2) NOT NULL DEFAULT 0,
  budget        DECIMAL(12,2) NOT NULL DEFAULT 0,
  roas          DECIMAL(6,2) NULL,
  cpl           DECIMAL(12,2) NULL,
  impressions   INT UNSIGNED NULL,
  ctr           DECIMAL(5,2) NULL,
  conversions   INT UNSIGNED NULL,
  conv_label    VARCHAR(60) NULL,
  conv_unit     VARCHAR(30) NULL,
  cost_per_conv DECIMAL(12,2) NULL,
  roas_note     VARCHAR(60) NULL,
  owner_id      INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_camp_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_camp_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE content_posts (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  publish_date DATE NOT NULL,
  title        VARCHAR(200) NOT NULL,
  client_id    INT UNSIGNED NULL,
  channel      ENUM('instagram','linkedin','blog','email','youtube') NOT NULL DEFAULT 'instagram',
  format       VARCHAR(60) NULL,
  status       ENUM('draft','review','scheduled','published') NOT NULL DEFAULT 'draft',
  owner_id     INT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_posts_date (publish_date),
  CONSTRAINT fk_posts_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE projects (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  client_id   INT UNSIGNED NULL,
  status      ENUM('ontrack','risk','review','done') NOT NULL DEFAULT 'ontrack',
  progress    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  due_date    DATE NULL,
  budget      DECIMAL(12,2) NOT NULL DEFAULT 0,
  tasks_done  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tasks_total SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proj_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_members (
  project_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE milestones (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  name       VARCHAR(200) NOT NULL,
  due_date   DATE NULL,
  status     ENUM('ontrack','risk','review','done') NOT NULL DEFAULT 'ontrack',
  owner_id   INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ms_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tasks (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  project    VARCHAR(160) NULL,
  col        ENUM('todo','progress','review','done') NOT NULL DEFAULT 'todo',
  priority   ENUM('high','med','low') NOT NULL DEFAULT 'med',
  due_date   DATE NULL,
  owner_id   INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE proposals (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  number       VARCHAR(30) NOT NULL UNIQUE,
  title        VARCHAR(200) NOT NULL,
  client_name  VARCHAR(160) NOT NULL,
  value        DECIMAL(12,2) NOT NULL DEFAULT 0,
  sent_date    DATE NULL,
  expires_date DATE NULL,
  status       ENUM('draft','sent','viewed','accepted','declined') NOT NULL DEFAULT 'draft',
  owner_id     INT UNSIGNED NULL,
  views        INT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prop_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invoices (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  number      VARCHAR(30) NOT NULL UNIQUE,
  client_id   INT UNSIGNED NOT NULL,
  description VARCHAR(255) NULL,
  issued_date DATE NOT NULL,
  due_date    DATE NOT NULL,
  amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_date   DATE NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id  INT UNSIGNED NOT NULL,
  invoice_id INT UNSIGNED NULL,
  reference  VARCHAR(40) NULL,
  method     ENUM('Bank transfer','UPI','Card','Razorpay') NOT NULL DEFAULT 'Bank transfer',
  paid_on    DATE NOT NULL,
  amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  status     ENUM('settled','processing','failed') NOT NULL DEFAULT 'settled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pay_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Monthly P&L / collections used by Reports and Payments charts.
CREATE TABLE finance_monthly (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  month          DATE NOT NULL UNIQUE,  -- always the 1st of the month
  revenue        DECIMAL(14,2) NOT NULL DEFAULT 0,
  expenses       DECIMAL(14,2) NOT NULL DEFAULT 0,
  collected      DECIMAL(14,2) NOT NULL DEFAULT 0,
  payments_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saved_reports (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  schedule   VARCHAR(120) NOT NULL DEFAULT 'On demand',
  format     ENUM('PDF','XLSX','CSV') NOT NULL DEFAULT 'PDF',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit log / activity feed. Written automatically by the API.
CREATE TABLE activity (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NULL,
  kind       ENUM('success','info','primary','warning','danger','muted') NOT NULL DEFAULT 'info',
  title      VARCHAR(200) NOT NULL,
  detail     VARCHAR(255) NULL,
  entity     VARCHAR(40)  NULL,
  entity_id  INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_created (created_at),
  CONSTRAINT fk_act_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Failed sign-in attempts, used for brute-force throttling.
CREATE TABLE login_attempts (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip           VARCHAR(45)  NOT NULL,
  email        VARCHAR(190) NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_ip (ip, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
--  SEED DATA (sample agency data shown in the original design).
--  Delete these rows any time from the app or phpMyAdmin.
--  No login passwords are seeded — the first visit to login.html asks
--  you to create the admin account.
-- =====================================================================

INSERT INTO users (id, name, initials, email, role, title) VALUES
 (1,'Vikram Malhotra','VM','admin@apexdigital.agency','admin','Lead Onboarding Director'),
 (2,'Anya Kapoor','AK',NULL,'manager','Account Director'),
 (3,'Rahul Rao','RR',NULL,'member','Growth Lead'),
 (4,'Pooja Lal','PL',NULL,'member','Account Manager'),
 (5,'Sameer Das','SD',NULL,'member','Senior Developer'),
 (6,'Neha Sharma','NS',NULL,'member','Content Strategist'),
 (7,'Mohit Jain','MJ',NULL,'member','CRM Engineer');

INSERT INTO clients (id,name,industry,mrr,health,renewal_date,owner_id,color1,color2,revenue_ytd,cost_ytd) VALUES
 (1,'UrbanStyle Direct','E-commerce D2C',18000,88,'2027-02-12',1,'#8B7FF5','#5145E8',1740000,960000),
 (2,'Zenith Media','Omnichannel SaaS',24000,92,'2027-03-04',2,'#0F9D58','#0B7A43',2180000,1170000),
 (3,'Kinetix Cloud','DevOps Platform',32000,58,'2027-01-28',3,'#2563EB','#1D4ED8',2460000,1590000),
 (4,'Solaris Energy','CleanTech B2B',15000,64,'2027-02-20',4,'#B5790A','#8A5C06',1320000,810000),
 (5,'ApexDigital','B2B SaaS',12000,47,'2027-01-18',1,'#D33B3B','#A62C2C',1190000,860000),
 (6,'PixelForge Studio','Creative Agency',9000,81,'2027-04-02',2,'#6C63F0','#5145E8',830000,440000);

INSERT INTO leads (name,company,source,score,status,owner_id) VALUES
 ('Aditya Verma','Northstar Retail Group','Meta Lead Ads',92,'New',2),
 ('Meera Kapoor','BrightPath Wellness','Website Form',88,'Qualified',1),
 ('Rohan Shetty','Kinetix Cloud','Referral',81,'Contacted',3),
 ('Simran Bhatia','UrbanStyle Direct','Google Ads',74,'Contacted',4),
 ('Farhan Ali','Solaris Energy','WhatsApp Inbound',69,'New',NULL),
 ('Divya Nair','Zenith Media','Website Form',55,'Unqualified',2),
 ('Karan Malhotra','PixelForge Studio','Meta Lead Ads',47,'Unqualified',1);

INSERT INTO deals (name,industry,tag,value,stage,owner_id,stage_changed_at) VALUES
 ('Northstar Retail Group','E-commerce D2C','Meta Lead Ads',180000,'discovery',2,NOW() - INTERVAL 3 DAY),
 ('BrightPath Wellness','Health & Wellness','Referral',220000,'discovery',1,NOW() - INTERVAL 1 DAY),
 ('Kinetix Cloud','DevOps Platform','Outbound',320000,'pitch',3,NOW() - INTERVAL 6 DAY),
 ('Solaris Energy','CleanTech B2B','Website Form',150000,'pitch',4,NOW() - INTERVAL 4 DAY),
 ('PixelForge Studio','Creative Agency','Referral',90000,'pitch',2,NOW() - INTERVAL 2 DAY),
 ('UrbanStyle Direct','E-commerce D2C','Legal Review',180000,'negotiation',1,NOW() - INTERVAL 8 DAY),
 ('Zenith Media','Omnichannel SaaS','Redlines Sent',240000,'negotiation',2,NOW() - INTERVAL 5 DAY),
 ('ApexDigital Retainer','B2B SaaS','Signed',120000,'won',1,NOW() - INTERVAL 2 DAY);

INSERT INTO followups (type,title,details,owner_id,due_at) VALUES
 ('call','Follow-up call — Northstar Retail Group','Confirm budget sign-off after Tuesday demo',2,NOW() - INTERVAL 2 HOUR),
 ('mail','Send revised proposal — Solaris Energy','Include updated CleanTech media plan',4,NOW() - INTERVAL 1 DAY),
 ('wa','Access reminder — Kinetix Cloud','Meta BM partner invite still pending acceptance',3,NOW() - INTERVAL 4 HOUR),
 ('call','Kickoff prep call — BrightPath Wellness','Align on 90-day roadmap before Friday session',1,CURDATE() + INTERVAL 14 HOUR),
 ('meet','QBR — UrbanStyle Direct','Quarterly performance review with CMO',1,CURDATE() + INTERVAL 16 HOUR + INTERVAL 30 MINUTE),
 ('mail','Contract redlines follow-up — Zenith Media','Legal team requested clause clarification',2,CURDATE() + INTERVAL 17 HOUR),
 ('wa','Asset pack nudge — PixelForge Studio','Brand guideline PDF still outstanding',2,CURDATE() + INTERVAL 1 DAY + INTERVAL 10 HOUR),
 ('call','Renewal conversation — ApexDigital','Discuss Q2 retainer scope expansion',1,CURDATE() + INTERVAL 5 DAY + INTERVAL 11 HOUR);

INSERT INTO services (icon,name,description,tier,active_clients,mrr,revenue_ytd) VALUES
 ('ads','Paid Media & Performance Ads','Meta, Google, LinkedIn and YouTube campaign strategy, media buying and optimization.','Core',18,142000,3860000),
 ('seo','SEO & Organic Growth','Technical audits, content-led link building and on-page optimization for compounding traffic.','Core',11,61000,1240000),
 ('social','Social & Community Management','Editorial calendars, community moderation and organic social growth across channels.','Add-on',14,48000,980000),
 ('content','Content & Editorial Production','Blog, video and long-form content production aligned to funnel stage.','Add-on',9,39000,800000),
 ('email','Lifecycle & Email Marketing','Klaviyo / CRM-driven segmentation, automation flows and retention campaigns.','Add-on',8,33000,930000),
 ('creative','Creative & Brand Design','Ad creative, landing pages and brand system design produced in-house.','Core',16,55000,1220000);

INSERT INTO onboardings (id,client_id,gate,blocker,lead_id,go_live) VALUES
 (1,1,'Stage 3 Platform Access','Meta BM Verification',1,'2026-10-28'),
 (2,2,'Strategy Call Setup','Kickoff Ready',2,'2026-10-24'),
 (3,3,'Brand Intake Review','Asset Pack Upload',3,'2026-11-06'),
 (4,4,'Google Ads Access','Legal Validation',4,'2026-11-02');

-- Full 15-gate checklist for UrbanStyle Direct
INSERT INTO onboarding_items (onboarding_id,category,sort,title,detail,badge,done,flag) VALUES
 (1,'Legal, Contracts & Billing Validation',1,'Master Services Agreement (MSA) & SOW Executed','Signed via DocuSign by Sarah Jenkins (CEO) on Oct 14, 10:14 AM','Executed',1,'none'),
 (1,'Legal, Contracts & Billing Validation',2,'Initial Retainer Invoice Cleared (₹18,000)','Wire transfer ID #INV-99420 cleared','Settled',1,'none'),
 (1,'Legal, Contracts & Billing Validation',3,'Tax / GST Identification & Entity Validation','GST certificate and entity documents filed with agency legal','Approved',1,'none'),
 (1,'Brand Assets & Creative Toolkits',4,'Vector Logo Files (SVG, EPS, Light/Dark Lockups)','12 master asset files deposited in client Drive folder','12 Assets',1,'none'),
 (1,'Brand Assets & Creative Toolkits',5,'Typography Licenses & Primary Font Files','OTF web and desktop licenses: Neue Haas Grotesk & GT America','Licensed',1,'none'),
 (1,'Brand Assets & Creative Toolkits',6,'Brand Voice, Tone & Editorial Style Guide','34-page deck reviewed by Lead Copy Strategist','Reviewed',1,'none'),
 (1,'Brand Assets & Creative Toolkits',7,'Product Photography & Video Raw B-Roll Drive','Autumn / Winter catalog 4K footage synced (18.4 GB)','18.4 GB',1,'none'),
 (1,'Platform & Ad Account Permissions',8,'Meta Business Manager Partner Access','OmniAgency Partner ID (948210398) pending acceptance in Meta BM Security Center','Critical Blocker',0,'critical'),
 (1,'Platform & Ad Account Permissions',9,'Google Ads MCC Manager Account Link Request','Linked to MCC #884-219-0091 with Administrative Ownership','Linked',1,'none'),
 (1,'Platform & Ad Account Permissions',10,'Google Analytics 4 & Tag Manager (GTM) Access','Invitation dispatched; awaiting client admin confirmation','Pending Approval',0,'resend'),
 (1,'Platform & Ad Account Permissions',11,'Shopify Collaborator Account Access','Code #7810 approved with Products, Themes, and Analytics permissions','Verified',1,'none'),
 (1,'Platform & Ad Account Permissions',12,'Klaviyo / CRM API Key Integration','Public & private keys connected to OmniSync Engine','API Connected',1,'none'),
 (1,'Go-To-Market Strategy & Kickoff Alignment',13,'Target Persona & Competitor Benchmark Audit','Direct competitive benchmarking against 4 tier-1 D2C competitors completed','Delivered',1,'none'),
 (1,'Go-To-Market Strategy & Kickoff Alignment',14,'Kickoff Deck & 90-Day Roadmap Slide Master','Slide master deck assembled with ROAS projection model','Ready',0,'none'),
 (1,'Go-To-Market Strategy & Kickoff Alignment',15,'Executive Kickoff Strategy Call Scheduled','Google Meet link dispatched with client C-suite and growth team','Confirmed: Friday 2:00 PM',0,'join');

-- Standard 15-gate template for the other cohorts (done counts 14 / 5 / 8)
INSERT INTO onboarding_items (onboarding_id,category,sort,title,badge,done)
SELECT o.id, t.category, t.sort, t.title, t.badge, t.sort <= o.done_n
FROM (SELECT 2 AS id, 14 AS done_n UNION ALL SELECT 3, 5 UNION ALL SELECT 4, 8) o
CROSS JOIN (
  SELECT 'Legal, Contracts & Billing Validation' AS category, 1 AS sort, 'MSA & SOW Executed' AS title, 'Executed' AS badge
  UNION ALL SELECT 'Legal, Contracts & Billing Validation',2,'Initial Retainer Invoice Cleared','Settled'
  UNION ALL SELECT 'Legal, Contracts & Billing Validation',3,'Tax / GST & Entity Validation','Approved'
  UNION ALL SELECT 'Brand Assets & Creative Toolkits',4,'Vector Logo Files','Received'
  UNION ALL SELECT 'Brand Assets & Creative Toolkits',5,'Typography Licenses & Font Files','Licensed'
  UNION ALL SELECT 'Brand Assets & Creative Toolkits',6,'Brand Voice & Style Guide','Reviewed'
  UNION ALL SELECT 'Brand Assets & Creative Toolkits',7,'Product Photography & Video Drive','Synced'
  UNION ALL SELECT 'Platform & Ad Account Permissions',8,'Meta Business Manager Partner Access','Granted'
  UNION ALL SELECT 'Platform & Ad Account Permissions',9,'Google Ads MCC Link','Linked'
  UNION ALL SELECT 'Platform & Ad Account Permissions',10,'GA4 & Tag Manager Access','Granted'
  UNION ALL SELECT 'Platform & Ad Account Permissions',11,'CMS / Store Collaborator Access','Verified'
  UNION ALL SELECT 'Platform & Ad Account Permissions',12,'CRM / Email API Integration','Connected'
  UNION ALL SELECT 'Go-To-Market Strategy & Kickoff Alignment',13,'Persona & Competitor Audit','Delivered'
  UNION ALL SELECT 'Go-To-Market Strategy & Kickoff Alignment',14,'Kickoff Deck & 90-Day Roadmap','Ready'
  UNION ALL SELECT 'Go-To-Market Strategy & Kickoff Alignment',15,'Executive Kickoff Call Scheduled','Confirmed'
) t;

INSERT INTO approvals (client_id,item,type,preview,requested_at,due_at) VALUES
 (1,'Q2 Retargeting Creative Set (6 variants)','Creative','Advantage+ catalog carousel — Autumn/Winter collection, 4 static + 2 video cuts.',NOW() - INTERVAL 4 HOUR,NOW() + INTERVAL 20 HOUR),
 (3,'Additional ₹80,000 budget shift to Google Search','Budget','Reallocation from YouTube Shorts to capture high-intent search demand.',NOW() - INTERVAL 30 HOUR,NOW() - INTERVAL 6 HOUR),
 (2,'Amended SOW — Lifecycle Email add-on','Contract','Adds Klaviyo automation flows at ₹35,000/mo starting next billing cycle.',NOW() - INTERVAL 1 HOUR,NOW() + INTERVAL 23 HOUR),
 (4,'Landing Page v3 — Homepage Hero Redesign','Creative','New hero section with updated CleanTech messaging and CTA hierarchy.',NOW() - INTERVAL 9 HOUR,NOW() + INTERVAL 15 HOUR),
 (6,'Brand Refresh — Logo Lockup Variants','Creative','3 lockup directions delivered for review ahead of Friday kickoff.',NOW() - INTERVAL 2 DAY,NOW() - INTERVAL 1 DAY),
 (5,'Q1 Retainer Renewal — Scope Expansion','Contract','Adds SEO service line at ₹12,000/mo, effective next cycle.',NOW() - INTERVAL 2 HOUR,NOW() + INTERVAL 22 HOUR);

INSERT INTO campaigns (name,client_id,channel,status,status_note,objective,pace,spend,budget,roas,cpl,impressions,ctr,conversions,conv_label,conv_unit,cost_per_conv,roas_note,owner_id) VALUES
 ('Winter Drop — Prospecting',1,'meta','live',NULL,NULL,72,140000,195000,5.10,142,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1),
 ('Retargeting — Cart Abandon',2,'meta','live',NULL,NULL,64,210000,330000,7.80,96,NULL,NULL,NULL,NULL,NULL,NULL,NULL,2),
 ('Brand Search — Always On',3,'google','live',NULL,NULL,96,190000,200000,2.70,610,NULL,NULL,NULL,NULL,NULL,NULL,NULL,3),
 ('Decision Makers — ABM',4,'linkedin','live',NULL,NULL,58,110000,190000,3.40,1240,NULL,NULL,NULL,NULL,NULL,NULL,NULL,4),
 ('Performance Max — Catalog',1,'google','live',NULL,NULL,81,260000,320000,4.60,188,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1),
 ('Lead Gen — Free Trial',5,'meta','paused',NULL,NULL,41,60000,150000,1.90,530,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1),
 ('Thought Leadership — Webinar',3,'linkedin','scheduled',NULL,NULL,0,0,120000,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,3),
 ('Portfolio Showcase — Reels',6,'meta','live',NULL,NULL,49,40000,80000,3.90,210,NULL,NULL,NULL,NULL,NULL,NULL,NULL,2),
 ('Competitor Conquesting',2,'google','paused',NULL,NULL,88,120000,135000,2.10,720,NULL,NULL,NULL,NULL,NULL,NULL,NULL,2),
 -- Campaign Lab deployments (full funnel metrics)
 ('High-AOV Google Search Intent (B2B Core)',3,'google','live','Active','Search Network • Demo Request / SQL • Target ROAS 5.0x',80,420000,500000,5.84,871,142800,4.82,482,'SQLs Generated','leads',871,'High Yield',3),
 ('B2B SaaS Founder Direct Funnel (ABM Tier 1)',2,'linkedin','live','Active','Sponsored InMail + Feed • Executive Bookings • CXO Title Filter',85,510000,600000,3.88,1734,48290,1.94,294,'SQLs Generated','leads',1734,'Deal Pipeline: ₹1.2Cr',2),
 ('Q2 Dynamic Product Retargeting Surge',1,'meta','live','Active','Advantage+ Catalog • Direct Purchase • Lookalike 2%',85,340000,400000,4.92,352,894200,3.12,964,'Conversions','orders',352,'High Volume',1),
 ('YouTube Shorts SaaS Workflow Teaser',3,'youtube','paused','Paused (A/B Test)','Shorts Placement • Top of Funnel Reach • Tech Enthusiasts',72,180000,250000,2.14,NULL,520100,1.45,188400,'Video Views 100%','views',0.95,'Brand Discovery',3);

INSERT INTO content_posts (publish_date,title,client_id,channel,format,status,owner_id) VALUES
 ('2026-10-02','Festive lookbook carousel',1,'instagram','Carousel','published',2),
 ('2026-10-05','Q3 platform reliability report',3,'blog','Long-form','published',3),
 ('2026-10-07','Solar ROI explainer',4,'linkedin','Document post','published',4),
 ('2026-10-09','Behind the brand reel',6,'instagram','Reel','published',2),
 ('2026-10-12','October product digest',2,'email','Newsletter','published',2),
 ('2026-10-14','CTO fireside clip',3,'youtube','Video','published',3),
 ('2026-10-16','Diwali sale teaser',1,'instagram','Story set','published',1),
 ('2026-10-19','Customer win: Metro Logistics',5,'linkedin','Case study','published',1),
 ('2026-10-21','Diwali sale launch',1,'instagram','Reel','published',1),
 ('2026-10-21','Clean energy policy brief',4,'blog','Long-form','published',4),
 ('2026-10-23','Hiring: senior designers',6,'linkedin','Single image','published',2),
 ('2026-10-26','Agency partner spotlight',2,'linkedin','Carousel','published',2),
 ('2026-10-28','Kubernetes cost tips thread',3,'linkedin','Text post','scheduled',3),
 ('2026-10-28','Last-chance Diwali offer',1,'email','Newsletter','scheduled',1),
 ('2026-10-29','Studio tour reel',6,'instagram','Reel','review',2),
 ('2026-10-30','Rooftop install timelapse',4,'youtube','Video','review',4),
 ('2026-10-31','Halloween flash drop',1,'instagram','Carousel','scheduled',1),
 ('2026-11-02','November feature roundup',2,'email','Newsletter','draft',2),
 ('2026-11-04','SaaS pricing teardown',5,'blog','Long-form','review',1),
 ('2026-11-06','Winter collection preview',1,'instagram','Reel','draft',1),
 ('2026-11-10','DevOps summit recap',3,'linkedin','Carousel','draft',3),
 ('2026-11-13','Net-metering FAQ',4,'blog','Long-form','draft',4),
 ('2026-11-18','Client testimonial cut',6,'youtube','Video','draft',2),
 ('2026-11-27','Black Friday countdown',1,'instagram','Story set','draft',1);

INSERT INTO projects (id,name,client_id,status,progress,due_date,budget,tasks_done,tasks_total) VALUES
 (1,'Shopify Plus Migration',1,'ontrack',68,'2026-11-14',650000,22,32),
 (2,'Brand Refresh & Guidelines',2,'review',90,'2026-11-03',320000,27,30),
 (3,'Developer Portal Relaunch',3,'risk',41,'2026-11-08',800000,14,34),
 (4,'Lead-Gen Landing Suite',4,'ontrack',55,'2026-11-21',240000,11,20),
 (5,'HubSpot CRM Rollout',5,'risk',33,'2026-11-05',410000,9,27),
 (6,'Portfolio Site Rebuild',6,'ontrack',76,'2026-11-18',180000,19,25),
 (7,'Q3 SEO Content Sprint',3,'done',100,'2026-10-15',150000,18,18);

INSERT INTO project_members (project_id,user_id) VALUES
 (1,1),(1,2),(1,5),(2,2),(2,6),(3,3),(3,5),(3,7),(4,4),(4,6),(5,1),(5,7),(6,2),(6,5),(7,3),(7,6);

INSERT INTO milestones (project_id,name,due_date,status,owner_id) VALUES
 (2,'Final logo suite sign-off','2026-10-30','review',2),
 (3,'API reference docs migrated','2026-11-01','risk',3),
 (5,'Pipeline stages + deal properties','2026-11-03','risk',1),
 (1,'Product catalog import (2,400 SKUs)','2026-11-06','ontrack',5),
 (6,'Case study page templates','2026-11-10','ontrack',2),
 (4,'Calculator landing page live','2026-11-12','ontrack',4);

INSERT INTO tasks (title,project,col,priority,due_date,owner_id) VALUES
 ('Write product catalog import script','Shopify Plus Migration','todo','high','2026-11-02',5),
 ('Draft November newsletter copy','Zenith Media — Content','todo','med','2026-10-31',2),
 ('Set up deal pipeline stages','HubSpot CRM Rollout','todo','high','2026-10-27',1),
 ('Keyword map for net-metering FAQ','Solaris Energy — SEO','todo','low','2026-11-09',4),
 ('Migrate API reference to new portal','Developer Portal Relaunch','progress','high','2026-10-26',3),
 ('Design case study page template','Portfolio Site Rebuild','progress','med','2026-11-03',2),
 ('Build savings calculator component','Lead-Gen Landing Suite','progress','med','2026-11-04',7),
 ('Edit rooftop timelapse video','Solaris Energy — Content','progress','low','2026-10-30',6),
 ('Logo suite final export','Brand Refresh & Guidelines','review','high','2026-10-29',2),
 ('Studio tour reel cut v2','PixelForge — Social','review','med','2026-10-29',6),
 ('Import 1,200 legacy contacts','HubSpot CRM Rollout','review','med','2026-11-01',7),
 ('Diwali sale campaign wrap report','UrbanStyle — Paid Media','done','med','2026-10-25',1),
 ('Typography + color tokens','Brand Refresh & Guidelines','done','low','2026-10-22',2),
 ('Auth flow for developer portal','Developer Portal Relaunch','done','high','2026-10-20',5);

INSERT INTO proposals (number,title,client_name,value,sent_date,expires_date,status,owner_id,views) VALUES
 ('PR-2026-041','Performance Marketing Retainer','Northstar Retail Group',180000,'2026-10-24','2026-11-07','viewed',2,4),
 ('PR-2026-040','Wellness Brand Launch — 90 Days','BrightPath Wellness',220000,'2026-10-22','2026-11-05','sent',1,0),
 ('PR-2026-039','DevRel Content + Paid Social','Kinetix Cloud',320000,'2026-10-18','2026-11-01','viewed',3,7),
 ('PR-2026-038','LinkedIn ABM Program','Solaris Energy',150000,'2026-10-15','2026-10-30','viewed',4,3),
 ('PR-2026-037','Portfolio Site + SEO','PixelForge Studio',90000,NULL,NULL,'draft',2,0),
 ('PR-2026-036','Omnichannel Growth Retainer','Zenith Media',240000,'2026-10-08','2026-10-22','accepted',2,9),
 ('PR-2026-035','Q4 Festive Campaign Scope','UrbanStyle Direct',180000,'2026-10-02','2026-10-16','accepted',1,5),
 ('PR-2026-034','CRM Implementation','ApexDigital',120000,'2026-09-28','2026-10-12','accepted',1,6),
 ('PR-2026-033','Fintech Brand Identity','LedgerLoop',140000,'2026-09-20','2026-10-04','declined',4,2),
 ('PR-2026-032','Marketplace Ads Management','Craftory',75000,NULL,NULL,'draft',3,0);

INSERT INTO invoices (id,number,client_id,description,issued_date,due_date,amount,paid_date) VALUES
 (1,'INV-1088',1,'November retainer','2026-10-27','2026-11-11',180000,NULL),
 (2,'INV-1087',2,'November retainer','2026-10-27','2026-11-11',240000,NULL),
 (3,'INV-1086',3,'Developer portal — milestone 2','2026-10-20','2026-11-04',260000,NULL),
 (4,'INV-1085',4,'October retainer','2026-10-01','2026-10-16',150000,NULL),
 (5,'INV-1084',5,'HubSpot rollout — phase 1','2026-09-15','2026-09-30',135000,NULL),
 (6,'INV-1083',6,'October retainer','2026-10-01','2026-10-16',90000,'2026-10-14'),
 (7,'INV-1082',1,'October retainer','2026-10-01','2026-10-16',180000,'2026-10-09'),
 (8,'INV-1081',2,'Brand refresh — final','2026-10-01','2026-10-16',160000,'2026-10-21'),
 (9,'INV-1080',3,'October retainer','2026-10-01','2026-10-16',320000,'2026-10-15'),
 (10,'INV-1079',5,'August media spend recharge','2026-08-30','2026-09-14',48000,NULL);

INSERT INTO payments (client_id,invoice_id,reference,method,paid_on,amount,status) VALUES
 (2,8,'INV-1081','Bank transfer','2026-10-21',160000,'settled'),
 (3,9,'INV-1080','Bank transfer','2026-10-15',320000,'settled'),
 (6,6,'INV-1083','UPI','2026-10-14',90000,'settled'),
 (1,7,'INV-1082','Card','2026-10-09',180000,'settled'),
 (4,4,'INV-1085','Razorpay','2026-10-27',150000,'failed'),
 (5,10,'INV-1079','UPI','2026-10-28',48000,'processing'),
 (2,NULL,'INV-1076','Bank transfer','2026-10-06',240000,'settled'),
 (4,NULL,'INV-1077','Bank transfer','2026-10-04',150000,'settled');

INSERT INTO finance_monthly (month,revenue,expenses,collected,payments_count) VALUES
 ('2025-11-01', 740000,460000,      0, 0),
 ('2025-12-01', 790000,490000,      0, 0),
 ('2026-01-01', 820000,510000,      0, 0),
 ('2026-02-01', 860000,520000,      0, 0),
 ('2026-03-01', 910000,550000,      0, 0),
 ('2026-04-01', 940000,560000,      0, 0),
 ('2026-05-01', 960000,580000, 820000,11),
 ('2026-06-01',1010000,600000, 905000,12),
 ('2026-07-01',1030000,610000, 880000,12),
 ('2026-08-01',1100000,640000,1010000,13),
 ('2026-09-01',1160000,670000,1090000,14),
 ('2026-10-01',1240000,710000,1180000,15);

INSERT INTO saved_reports (name,schedule,format) VALUES
 ('Monthly P&L Summary','1st of every month · Email','PDF'),
 ('Client Health & Renewals','Every Monday · Slack','PDF'),
 ('Campaign ROAS by Client','Every Friday · Email','XLSX'),
 ('Team Utilization','On demand','XLSX'),
 ('Receivables Ageing','Every Monday · Email','PDF');

INSERT INTO activity (user_id,kind,title,detail,entity,created_at) VALUES
 (NULL,'muted','MSA Signed by Client','Legal signoff completed by Sarah Jenkins with audit trail cert.','onboardings',NOW() - INTERVAL 1 DAY),
 (NULL,'danger','Meta BM Partner Alert','Invite expired due to 2FA security timeout. Automatic reminder queued.','onboardings',NOW() - INTERVAL 5 HOUR),
 (NULL,'warning','Brand Kit Pack Uploaded','8 SVG logos and 4 typography packages deposited via Client Portal.','onboardings',NOW() - INTERVAL 3 HOUR),
 (NULL,'primary','Retainer Wire Confirmed','₹18,000 received for Month 1 Retainer. Legal lock lifted.','payments',NOW() - INTERVAL 1 HOUR),
 (NULL,'success','Shopify Collab Code Approved','Marcus Lee (UrbanStyle CTO) approved theme and asset scope access.','onboardings',NOW() - INTERVAL 12 MINUTE);
