-- =====================================================================
--  Upgrade an EXISTING database for the dashboard's demo-data button.
--  Run once in phpMyAdmin → SQL. Safe to run more than once.
-- =====================================================================

-- Rows created by the dashboard's "Load demo data" button, so "Remove demo data" deletes only those.
CREATE TABLE IF NOT EXISTS demo_records (
  entity VARCHAR(40)  NOT NULL,
  row_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (entity, row_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
