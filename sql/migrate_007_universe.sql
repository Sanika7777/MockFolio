-- 007: NIFTY 500 universe. Core flag for the original 30 stocks, activity tracking,
-- and real-market day stats from Yahoo. Safe to re-run: each column is added only if missing.

SET @has_col := (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'instruments' AND column_name = 'is_core');
SET @ddl := IF(@has_col = 0,
  'ALTER TABLE instruments ADD COLUMN is_core TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER is_active',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'price_state' AND column_name = 'touched_at');
SET @ddl := IF(@has_col = 0,
  'ALTER TABLE price_state
     ADD COLUMN touched_at DATETIME(3) NULL,
     ADD COLUMN market_prev_close DECIMAL(20,5) NULL,
     ADD COLUMN market_day_high DECIMAL(20,5) NULL,
     ADD COLUMN market_day_low DECIMAL(20,5) NULL,
     ADD COLUMN market_volume BIGINT UNSIGNED NULL,
     ADD KEY idx_pricestate_touched (touched_at)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Every stock that existed before the NIFTY 500 import is a core stock: always ticked, shown on the ticker tape.
-- Only runs while no core stock is set yet, so a re-run after the import doesn't promote all 500.
UPDATE instruments SET is_core = 1
WHERE NOT EXISTS (SELECT 1 FROM (SELECT instrument_id FROM instruments WHERE is_core = 1) AS c);

INSERT INTO schema_migrations (version, filename)
VALUES ('007', 'migrate_007_universe.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;
