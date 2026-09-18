-- RUN ORDER schemas.sql => triggers.sql => seed.sql

CREATE DATABASE IF NOT EXISTS mockfolio CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE mockfolio;

SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) NOT NULL PRIMARY KEY, 
    filename VARCHAR(256) NOT NULL, 
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(64)  NOT NULL PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    value_type ENUM('INT','DECIMAL','BOOL','STRING') NOT NULL DEFAULT 'DECIMAL',
    description VARCHAR(255) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users ( 
    user_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, 
    username VARCHAR(256) NOT NULL UNIQUE, 
    password_hash VARCHAR(256) NOT NULL, 
    email VARCHAR(256) NOT NULL UNIQUE, 
    role ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER', 
    is_active TINYINT UNSIGNED NOT NULL DEFAULT 1, 
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS accounts(
    account_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, 
    user_id INT UNSIGNED NOT NULL, 
    cash_balance DECIMAL(20,5) NOT NULL DEFAULT 500000.00, 
    blocked_margin DECIMAL(20,5) NOT NULL DEFAULT 0.00, 
    realised_pl DECIMAL(20,5) NOT NULL DEFAULT 0.00, 
    version INT UNSIGNED NOT NULL DEFAULT 0, 
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_accounts_user(user_id),
    CONSTRAINT fk_accounts_user FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT chk_accounts_cash CHECK(cash_balance >= 0),
    CONSTRAINT chk_accounts_margin CHECK (blocked_margin >= 0)
)ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS instruments( 
    instrument_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, 
    symbol VARCHAR(256) NOT NULL UNIQUE, 
    exchange ENUM('NSE', 'BSE') NOT NULL DEFAULT 'NSE',
    angel_token VARCHAR(256) NULL, 
    yf_ticker VARCHAR(256) NULL, -- yfinance stub
    company_name VARCHAR(256) NOT NULL,
    avg_daily_vol BIGINT UNSIGNED NOT NULL,
    daily_sigma DECIMAL(10,6) NOT NULL,
    tick_size DECIMAL(10,4) NOT NULL DEFAULT 0.0500,
    lot_size INT UNSIGNED NOT NULL DEFAULT 1,
    is_active TINYINT UNSIGNED NOT NULL DEFAULT 1,
    kappa_override DECIMAL(12,4) NULL,
    UNIQUE KEY uq_instr_symbol_exch (symbol, exchange),
    CONSTRAINT chk_instr_adv CHECK (avg_daily_vol > 0),
    CONSTRAINT chk_instr_sigma CHECK(daily_sigma >0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS price_state(
    instrument_id INT UNSIGNED NOT NULL PRIMARY KEY, 
    raw_price DECIMAL(20,5) NOT NULL,
    prev_close DECIMAL(20, 5) NOT NULL DEFAULT 0.00000, 
    perm_offset DECIMAL(20, 6) NOT NULL DEFAULT 0.000000, 
    temp_offset DECIMAL(20, 6) NOT NULL DEFAULT 0.000000, 
    adjusted_price DECIMAL(20, 5) AS (GREATEST(raw_price + perm_offset + temp_offset, 0.0500)) STORED,
    last_tick_at DATETIME(3) NOT NULL,
    last_decay_at DATETIME(3) NOT NULL, 
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_pricestate_instr FOREIGN KEY(instrument_id) REFERENCES instruments(instrument_id) ON DELETE CASCADE,
    CONSTRAINT chk_pricestate_raw CHECK(raw_price > 0)
)ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders(
    order_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, 
    client_order_id CHAR(36) NOT NULL,
    account_id INT UNSIGNED NOT NULL,
    instrument_id INT UNSIGNED NOT NULL,
    side ENUM('BUY','SELL') NOT NULL,
    order_type ENUM('MARKET', 'LIMIT', 'STOPLOSS') NOT NULL DEFAULT 'MARKET',
    quantity INT UNSIGNED NOT NULL,
    limit_price DECIMAL(20,4) NULL,
    trigger_price DECIMAL(20,4) NULL,
    status ENUM('PENDING', 'FILLED', 'PARTIAL', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    reject_reason VARCHAR(256) NULL,
    retry_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_orders_client_id (client_order_id),
    KEY idx_orders_account_status(account_id, status, order_id),
    KEY idx_orders_instr_time(instrument_id, created_at),
    CONSTRAINT fk_orders_account FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE RESTRICT,
    CONSTRAINT fk_orders_instr FOREIGN KEY (instrument_id) REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    CONSTRAINT chk_orders_qty CHECK (quantity > 0),
    CONSTRAINT chk_orders_limit CHECK (order_type <> 'LIMIT' OR limit_price IS NOT NULL)

)ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trades(
    trade_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(order_id), 
    account_id INT UNSIGNED NOT NULL,
    instrument_id INT UNSIGNED NOT NULL, FOREIGN KEY (instrument_id) REFERENCES instruments(instrument_id) ,
    side ENUM('BUY', 'SELL') NOT NULL,
    pre_trade_price DECIMAL(20,5) NOT NULL,
    exec_price DECIMAL(20,5) NOT NULL, 
    quantity INT UNSIGNED NOT NULL,
    brokerage DECIMAL(20,5) NOT NULL DEFAULT 0.00,
    realised_pl DECIMAL(18,2) NULL,
    price_impact DECIMAL(20, 6),
    executed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_trades_account_time (account_id, executed_at),
    KEY idx_trades_instr_time(instrument_id, executed_at),
    KEY idx_trades_order (order_id),
    CONSTRAINT fk_trades_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE RESTRICT,
    CONSTRAINT fk_trades_account FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE RESTRICT,
    CONSTRAINT fk_trades_instr FOREIGN KEY(instrument_id) REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    CONSTRAINT chk_trades_qty CHECK(quantity > 0),
    CONSTRAINT chk_trades_price CHECK(exec_price > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS holdings(
    account_id INT UNSIGNED NOT NULL,
    instrument_id INT UNSIGNED NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    avg_price DECIMAL (20,4) NOT NULL DEFAULT 0.0000,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (account_id, instrument_id), -- composite key
    KEY idx_holdings_instr (instrument_id),
    CONSTRAINT fk_holdings_account FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
    CONSTRAINT fk_holdings_instr FOREIGN KEY(instrument_id) REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    CONSTRAINT chk_holdings_qty CHECK (quantity >= 0)
)ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS candles_1m(
    instrument_id INT UNSIGNED NOT NULL,
    bucket_start DATETIME NOT NULL,
    is_adjusted TINYINT(2) NOT NULL,
    open_price DECIMAL(20,4) NOT NULL,
    high_price DECIMAL(20,4) NOT NULL,
    low_price DECIMAL(20,4) NOT NULL,
    close_price DECIMAL(20,4) NOT NULL,
    volume DECIMAL(20,4) NOT NULL,
    trade_count INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (instrument_id, is_adjusted, bucket_start),
    CONSTRAINT fk_candles_instr FOREIGN KEY (instrument_id) REFERENCES instruments(instrument_id) ON DELETE CASCADE
)ENGINE=InnoDB;

CREATE TABLE watchlist (
  account_id INT UNSIGNED NOT NULL,
  instrument_id INT UNSIGNED NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (account_id, instrument_id),
  CONSTRAINT fk_watchlist_account FOREIGN KEY (account_id) REFERENCES accounts (account_id) ON DELETE CASCADE,
  CONSTRAINT fk_watchlist_instr FOREIGN KEY (instrument_id) REFERENCES instruments (instrument_id) ON DELETE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE audit_log (
  log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  table_name VARCHAR(64) NOT NULL,
  action ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  row_key VARCHAR(64) NOT NULL,   -- e.g. "acct=3;instr=7"
  old_value JSON NULL,
  new_value JSON NULL,
  db_user VARCHAR(96) NOT NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (log_id), 
  KEY idx_audit_table_time (table_name, changed_at)
) ENGINE=InnoDB;
 
CREATE TABLE concurrency_runs (
  run_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  label VARCHAR(64) NOT NULL,
  isolation_level VARCHAR(32) NOT NULL,
  lock_ordering TINYINT UNSIGNED NOT NULL,
  use_for_update TINYINT UNSIGNED NOT NULL,
  threads SMALLINT UNSIGNED NOT NULL,
  duration_sec SMALLINT UNSIGNED NOT NULL,
  orders_attempted INT UNSIGNED NOT NULL DEFAULT 0,
  orders_filled INT UNSIGNED NOT NULL DEFAULT 0,
  deadlocks INT UNSIGNED NOT NULL DEFAULT 0,
  avg_latency_ms DECIMAL(10,2) NULL,
  p95_latency_ms DECIMAL(10,2) NULL,
  notes TEXT NULL,
  run_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (run_id)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW v_portfolio_summary AS
SELECT
    a.account_id,
    a.user_id,
    u.username,
    i.instrument_id,
    i.symbol,
    i.exchange,
    h.quantity,
    h.avg_price,
    ps.adjusted_price AS ltp,
    ROUND(h.quantity * h.avg_price, 2) AS invested_value,
    ROUND(h.quantity * ps.adjusted_price, 2) AS market_value,
    ROUND(h.quantity * (ps.adjusted_price - h.avg_price), 2) AS unrealised_pnl
FROM holdings h
JOIN accounts    a  ON a.account_id    = h.account_id
JOIN users       u  ON u.user_id       = a.user_id
JOIN instruments i  ON i.instrument_id = h.instrument_id
JOIN price_state ps ON ps.instrument_id = h.instrument_id
WHERE h.quantity <> 0;
 

-- Verification: this MUST return zero rows.
SELECT table_name, engine, table_collation
FROM information_schema.tables
WHERE table_schema = 'mockfolio' AND engine <> 'InnoDB';
 
INSERT INTO schema_migrations (version, filename)
VALUES ('001', '01_schema.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;
