SET time_zone = '+00:00';

INSERT INTO settings (setting_key, setting_value, value_type, description) VALUES
  ('kappa',            '120',    'DECIMAL', 'Liquidity scaling constant; retune in phase 7.3 against real ADV'),
  ('tau_seconds',      '300',    'INT',     'Temporary impact decay half-life in seconds'),
  ('perm_fraction',    '0.30',   'DECIMAL', 'Share of impact that is permanent'),
  ('brokerage_pct',    '0.0003', 'DECIMAL', 'Brokerage as a fraction of trade value'),
  ('starting_cash',    '500000', 'DECIMAL', 'Virtual capital credited on registration'),
  ('tick_interval_s',  '3',      'INT',     'Tick worker poll interval'),
  ('max_order_qty',    '100000', 'INT',     'Hard cap per order'),
  ('max_impact_pct',   '0.05',   'DECIMAL', 'Hard cap on a single order price move')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

INSERT INTO instruments
  (symbol, exchange, yf_ticker, company_name, sector, avg_daily_vol, daily_sigma) VALUES
  ('RELIANCE',   'NSE', 'RELIANCE.NS',   'Reliance Industries',       'Energy',        9000000,  0.014000),
  ('TCS',        'NSE', 'TCS.NS',        'Tata Consultancy Services', 'IT',            2500000,  0.013000),
  ('HDFCBANK',   'NSE', 'HDFCBANK.NS',   'HDFC Bank',                 'Banking',      12000000,  0.012000),
  ('INFY',       'NSE', 'INFY.NS',       'Infosys',                   'IT',            7000000,  0.015000),
  ('ICICIBANK',  'NSE', 'ICICIBANK.NS',  'ICICI Bank',                'Banking',      11000000,  0.013500),
  ('SBIN',       'NSE', 'SBIN.NS',       'State Bank of India',       'Banking',      15000000,  0.017000),
  ('BHARTIARTL', 'NSE', 'BHARTIARTL.NS', 'Bharti Airtel',             'Telecom',       6000000,  0.014500),
  ('ITC',        'NSE', 'ITC.NS',        'ITC Limited',               'FMCG',         13000000,  0.011000),
  ('LT',         'NSE', 'LT.NS',         'Larsen & Toubro',           'Construction',  2800000,  0.015000),
  ('AXISBANK',   'NSE', 'AXISBANK.NS',   'Axis Bank',                 'Banking',       8000000,  0.016000),
  ('KOTAKBANK',  'NSE', 'KOTAKBANK.NS',  'Kotak Mahindra Bank',       'Banking',       3500000,  0.014000),
  ('MARUTI',     'NSE', 'MARUTI.NS',     'Maruti Suzuki',             'Automobile',     900000,  0.014500),
  ('SUNPHARMA',  'NSE', 'SUNPHARMA.NS',  'Sun Pharmaceutical',        'Pharma',        3000000,  0.013000),
  ('TATAMOTORS', 'NSE', 'TMPV.NS',       'Tata Motors',               'Automobile',   18000000,  0.020000),
  ('WIPRO',      'NSE', 'WIPRO.NS',      'Wipro',                     'IT',            9000000,  0.016000),
  ('HINDUNILVR', 'NSE', 'HINDUNILVR.NS', 'Hindustan Unilever',        'FMCG',          2000000,  0.011500),
  ('BAJFINANCE', 'NSE', 'BAJFINANCE.NS', 'Bajaj Finance',             'Finance',       2200000,  0.018000),
  ('ASIANPAINT', 'NSE', 'ASIANPAINT.NS', 'Asian Paints',              'Consumer',      1500000,  0.013500),
  ('HCLTECH',    'NSE', 'HCLTECH.NS',    'HCL Technologies',          'IT',            3200000,  0.015500),
  ('TITAN',      'NSE', 'TITAN.NS',      'Titan Company',             'Consumer',      1400000,  0.016500),
  ('ULTRACEMCO', 'NSE', 'ULTRACEMCO.NS', 'UltraTech Cement',          'Cement',         700000,  0.014000),
  ('NESTLEIND',  'NSE', 'NESTLEIND.NS',  'Nestle India',              'FMCG',           600000,  0.011000),
  ('POWERGRID',  'NSE', 'POWERGRID.NS',  'Power Grid Corporation',    'Utilities',    14000000,  0.012500),
  ('NTPC',       'NSE', 'NTPC.NS',       'NTPC Limited',              'Utilities',    16000000,  0.013000),
  ('JSWSTEEL',   'NSE', 'JSWSTEEL.NS',   'JSW Steel',                 'Metals',        4500000,  0.017500),
  ('TATASTEEL',  'NSE', 'TATASTEEL.NS',  'Tata Steel',                'Metals',       25000000,  0.018500),
  ('ADANIENT',   'NSE', 'ADANIENT.NS',   'Adani Enterprises',         'Conglomerate',  5000000,  0.024000),
  ('ONGC',       'NSE', 'ONGC.NS',       'Oil & Natural Gas Corp',    'Energy',       12000000,  0.015000),
  ('COALINDIA',  'NSE', 'COALINDIA.NS',  'Coal India',                'Energy',       10000000,  0.014500),
  ('TECHM',      'NSE', 'TECHM.NS',      'Tech Mahindra',             'IT',            3800000,  0.016000)
ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), sector = VALUES(sector);

INSERT INTO price_state (instrument_id, raw_price, prev_close, last_tick_at, last_decay_at)
SELECT i.instrument_id, 1000.00000, 1000.00000, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM instruments i
ON DUPLICATE KEY UPDATE last_decay_at = UTC_TIMESTAMP(3);

INSERT INTO users (username, email, password_hash, role) VALUES
  ('admin',   'admin@mockfolio.local',   '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'ADMIN'),
  ('trader1', 'trader1@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader2', 'trader2@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader3', 'trader3@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader4', 'trader4@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader5', 'trader5@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader6', 'trader6@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader7', 'trader7@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader8', 'trader8@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER'),
  ('trader9', 'trader9@mockfolio.local', '$2b$12$0AwJmFwHtsDAVKVSDQiQ8uxlhTl9A39r8nkyqxEZxaIGa.Y7pNrYq', 'USER')
ON DUPLICATE KEY UPDATE email = VALUES(email);

INSERT INTO watchlist (account_id, instrument_id, sort_order)
SELECT a.account_id, i.instrument_id, i.instrument_id
FROM accounts a
CROSS JOIN instruments i
WHERE i.instrument_id <= 8
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

INSERT INTO schema_migrations (version, filename)
VALUES ('005', 'seed.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;

SELECT
  (SELECT COUNT(*) FROM users)       AS users,
  (SELECT COUNT(*) FROM accounts)    AS accounts,
  (SELECT COUNT(*) FROM instruments) AS instruments,
  (SELECT COUNT(*) FROM price_state) AS price_rows,
  (SELECT COUNT(*) FROM settings)    AS settings,
  (SELECT COUNT(*) FROM watchlist)   AS watchlist;
