USE mockfolio;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
INSERT INTO settings(setting_key, setting_value, value_type, description) VALUES
  ('kappa',            '1000',   'DECIMAL', 'Liquidity scaling constant for the impact model'),
  ('tau_seconds',      '300',    'INT',     'Temporary impact decay half-life constant'),
  ('perm_fraction',    '0.30',   'DECIMAL', 'Share of impact that is permanent'),
  ('brokerage_pct',    '0.0003', 'DECIMAL', 'Brokerage as a fraction of trade value'),
  ('starting_cash',    '500000', 'DECIMAL', 'Virtual capital credited on registration'),
  ('tick_interval_s',  '3',      'INT',     'Tick worker poll interval'),
  ('max_order_qty',    '100000', 'INT',     'Hard cap per order'),
  ('lock_ordering_on', '1',      'BOOL',    'Flip to 0 to demo deadlocks deliberately')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);


-- ---------------------------------------------------------------------
-- Instruments
-- ---------------------------------------------------------------------
-- avg_daily_vol and daily_sigma below are PLACEHOLDERS in the right order of
-- magnitude, not live figures. Before you tune kappa, replace them with real
-- numbers: pull 90 days of history via yfinance, then
--   avg_daily_vol = df['Volume'].mean()
--   daily_sigma   = df['Close'].pct_change().std()
-- Wrong ADV -> wrong impact -> you tune kappa against noise.
--
-- angel_token is NULL until you download AngelOne's instrument master JSON
-- and match on symbol. Do that in Week 2, not Week 11.
INSERT INTO instruments
  (symbol, exchange, yf_ticker, company_name, avg_daily_vol, daily_sigma) VALUES
  ('RELIANCE',   'NSE', 'RELIANCE.NS',   'Reliance Industries',        9000000,  0.014000),
  ('TCS',        'NSE', 'TCS.NS',        'Tata Consultancy Services',  2500000,  0.013000),
  ('HDFCBANK',   'NSE', 'HDFCBANK.NS',   'HDFC Bank',                 12000000,  0.012000),
  ('INFY',       'NSE', 'INFY.NS',       'Infosys',                    7000000,  0.015000),
  ('ICICIBANK',  'NSE', 'ICICIBANK.NS',  'ICICI Bank',                11000000,  0.013500),
  ('SBIN',       'NSE', 'SBIN.NS',       'State Bank of India',       15000000,  0.017000),
  ('BHARTIARTL', 'NSE', 'BHARTIARTL.NS', 'Bharti Airtel',              6000000,  0.014500),
  ('ITC',        'NSE', 'ITC.NS',        'ITC Limited',               13000000,  0.011000),
  ('LT',         'NSE', 'LT.NS',         'Larsen & Toubro',            2800000,  0.015000),
  ('AXISBANK',   'NSE', 'AXISBANK.NS',   'Axis Bank',                  8000000,  0.016000),
  ('KOTAKBANK',  'NSE', 'KOTAKBANK.NS',  'Kotak Mahindra Bank',        3500000,  0.014000),
  ('MARUTI',     'NSE', 'MARUTI.NS',     'Maruti Suzuki',               900000,  0.014500),
  ('SUNPHARMA',  'NSE', 'SUNPHARMA.NS',  'Sun Pharmaceutical',         3000000,  0.013000),
  ('TATAMOTORS', 'NSE', 'TATAMOTORS.NS', 'Tata Motors',               18000000,  0.020000),
  ('WIPRO',      'NSE', 'WIPRO.NS',      'Wipro',                      9000000,  0.016000)
ON DUPLICATE KEY UPDATE company_name = VALUES(company_name);


-- ---------------------------------------------------------------------
-- price_state — one row per instrument, seeded HERE and never inserted
-- by application code. Placeholder prices; the tick worker overwrites
-- raw_price within 3 seconds of starting.
-- ---------------------------------------------------------------------
INSERT INTO price_state (instrument_id, raw_price, last_tick_at, last_decay_at)
SELECT i.instrument_id, 1000.0000, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM instruments i
ON DUPLICATE KEY UPDATE last_decay_at = UTC_TIMESTAMP(3);


-- ---------------------------------------------------------------------
-- Demo users — password for all of them is: demo1234
-- (bcrypt, cost 12). Regenerate with:
--   python -c "import bcrypt;print(bcrypt.hashpw(b'demo1234',bcrypt.gensalt(12)).decode())"
-- Delete these rows before any submission that gets deployed anywhere real.
-- ---------------------------------------------------------------------
INSERT INTO users (username, email, password_hash, role) VALUES
  ('admin',  'admin@mockfolio.local',  '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'ADMIN'),
  ('trader1','trader1@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader2','trader2@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader3','trader3@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader4','trader4@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader5','trader5@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader6','trader6@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader7','trader7@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader8','trader8@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader9','trader9@mockfolio.local','$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER')
ON DUPLICATE KEY UPDATE email = VALUES(email);

-- One account per user, Rs 5,00,000 each.
INSERT INTO accounts (user_id, cash_balance)
SELECT u.user_id, 500000.00 FROM users u
ON DUPLICATE KEY UPDATE cash_balance = cash_balance;

-- Default watchlist: first 8 instruments for everyone.
INSERT INTO watchlist (account_id, instrument_id, sort_order)
SELECT a.account_id, i.instrument_id, i.instrument_id
FROM accounts a
CROSS JOIN instruments i
WHERE i.instrument_id <= 8
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

INSERT INTO schema_migrations (version, filename)
VALUES ('003', 'seed.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;

SELECT
  (SELECT COUNT(*) FROM users)       AS users,
  (SELECT COUNT(*) FROM accounts)    AS accounts,
  (SELECT COUNT(*) FROM instruments) AS instruments,
  (SELECT COUNT(*) FROM price_state) AS price_rows,
  (SELECT COUNT(*) FROM settings)    AS settings;