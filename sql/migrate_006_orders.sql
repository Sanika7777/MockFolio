-- 006: stop-loss / target brackets on orders, plus the crowd-noise setting.
-- Safe to re-run: each column is added only if it is missing.

SET @has_col := (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'stop_loss');
SET @ddl := IF(@has_col = 0,
  'ALTER TABLE orders
     ADD COLUMN stop_loss DECIMAL(20,4) NULL AFTER trigger_price,
     ADD COLUMN target_price DECIMAL(20,4) NULL AFTER stop_loss,
     ADD COLUMN parent_order_id BIGINT UNSIGNED NULL AFTER target_price,
     ADD KEY idx_orders_status_instr (status, instrument_id),
     ADD KEY idx_orders_parent (parent_order_id)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO settings (setting_key, setting_value, value_type, description) VALUES
  ('crowd_noise_pct', '0.0012', 'DECIMAL', 'Per-tick random crowd pressure on the MockFolio price, scaled by each stock''s volatility')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO schema_migrations (version, filename)
VALUES ('006', 'migrate_006_orders.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;
