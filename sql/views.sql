CREATE OR REPLACE VIEW v_portfolio_summary AS
SELECT
    a.account_id,
    a.user_id,
    u.username,
    i.instrument_id,
    i.symbol,
    i.company_name,
    i.exchange,
    h.quantity,
    h.avg_price,
    ps.raw_price,
    ps.adjusted_price AS ltp,
    ps.adjusted_price,
    ROUND(h.quantity * h.avg_price, 2) AS invested_value,
    ROUND(h.quantity * ps.adjusted_price, 2) AS market_value,
    ROUND(h.quantity * (ps.adjusted_price - h.avg_price), 2) AS unrealised_pnl
FROM holdings h
JOIN accounts a ON a.account_id = h.account_id
JOIN users u ON u.user_id = a.user_id
JOIN instruments i ON i.instrument_id = h.instrument_id
JOIN price_state ps ON ps.instrument_id = h.instrument_id
WHERE h.quantity <> 0;

CREATE OR REPLACE VIEW v_account_value AS
SELECT
    a.account_id,
    a.user_id,
    u.username,
    a.cash_balance,
    a.realised_pl,
    a.starting_cash,
    COALESCE(SUM(h.quantity * ps.adjusted_price), 0) AS holdings_value,
    a.cash_balance + COALESCE(SUM(h.quantity * ps.adjusted_price), 0) AS total_account_value,
    COALESCE(SUM(h.quantity * (ps.adjusted_price - h.avg_price)), 0) AS unrealised_pnl
FROM accounts a
JOIN users u ON u.user_id = a.user_id
LEFT JOIN holdings h ON h.account_id = a.account_id AND h.quantity <> 0
LEFT JOIN price_state ps ON ps.instrument_id = h.instrument_id
GROUP BY a.account_id, a.user_id, u.username, a.cash_balance, a.realised_pl, a.starting_cash;

INSERT INTO schema_migrations (version, filename)
VALUES ('003', 'views.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;
