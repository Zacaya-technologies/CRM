-- =====================================================================
--  Upgrade an EXISTING Creative Advs CRM database (keeps all your data).
--  Run in phpMyAdmin → select the database → SQL → paste all → Go.
--  Safe to run more than once. New installs don't need this:
--  database/schema.sql already includes everything below.
-- =====================================================================

-- Sign-ins, lockouts and account changes (admin → Team & Access → Security Log).
CREATE TABLE IF NOT EXISTS security_log (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event      VARCHAR(40)  NOT NULL,
  user_id    INT UNSIGNED NULL,
  email      VARCHAR(190) NULL,
  ip         VARCHAR(45)  NULL,
  user_agent VARCHAR(255) NULL,
  detail     VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sec_created (created_at),
  INDEX idx_sec_event (event, created_at),
  CONSTRAINT fk_sec_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Adds an index only if it isn't there yet (works on MySQL 5.7+/8 and MariaDB).
DROP PROCEDURE IF EXISTS crm_add_index;
DELIMITER //
CREATE PROCEDURE crm_add_index(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN cols VARCHAR(255))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = tbl AND index_name = idx) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD INDEX `', idx, '` (', cols, ')');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL crm_add_index('leads',          'idx_leads_created',    'created_at');
CALL crm_add_index('leads',          'idx_leads_score',      'score');
CALL crm_add_index('clients',        'idx_clients_status',   'status');
CALL crm_add_index('clients',        'idx_clients_renewal',  'renewal_date');
CALL crm_add_index('deals',          'idx_deals_stage',      'stage');
CALL crm_add_index('followups',      'idx_followups_due',    'done, due_at');
CALL crm_add_index('approvals',      'idx_approvals_status', 'status');
CALL crm_add_index('campaigns',      'idx_campaigns_status', 'status');
CALL crm_add_index('projects',       'idx_projects_status',  'status');
CALL crm_add_index('tasks',          'idx_tasks_col',        'col, due_date');
CALL crm_add_index('proposals',      'idx_proposals_status', 'status');
CALL crm_add_index('invoices',       'idx_invoices_open',    'paid_date, due_date');
CALL crm_add_index('invoices',       'idx_invoices_issued',  'issued_date');
CALL crm_add_index('payments',       'idx_payments_paid',    'paid_on');
CALL crm_add_index('login_attempts', 'idx_login_email',      'email, attempted_at');

DROP PROCEDURE crm_add_index;
