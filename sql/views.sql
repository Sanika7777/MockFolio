USE mockfolio;
CREATE OR REPLACE VIEW portfolio_view AS
SELECT u.username, s.symbol, h.quantity, h.average_buy_price, s.simulated_price, h.quantity * h.average_buy_price AS invested_value, h.quantity * s.simulated_price AS current_value, h.quantity * (s.simulated_price - h.average_buy_price) AS profit_loss
FROM holdings h JOIN users u ON u.id = h.user_id JOIN stocks s ON s.id = h.stock_id;
CREATE OR REPLACE VIEW account_summary_view AS
SELECT u.username, a.cash_balance, COALESCE(SUM(h.quantity * s.simulated_price), 0) AS holdings_value, a.cash_balance + COALESCE(SUM(h.quantity * s.simulated_price), 0) AS total_account_value, COALESCE(SUM(h.quantity * (s.simulated_price - h.average_buy_price)), 0) AS total_pnl
FROM users u JOIN accounts a ON a.user_id = u.id LEFT JOIN holdings h ON h.user_id = u.id LEFT JOIN stocks s ON s.id = h.stock_id GROUP BY u.id, u.username, a.cash_balance;
