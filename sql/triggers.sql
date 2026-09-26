DROP TRIGGER IF EXISTS trg_users_ai_account;
DROP TRIGGER IF EXISTS trg_holdings_ai;
DROP TRIGGER IF EXISTS trg_holdings_au;
DROP TRIGGER IF EXISTS trg_holdings_ad;

DELIMITER $$

CREATE TRIGGER trg_users_ai_account
AFTER INSERT ON users
FOR EACH ROW
BEGIN
    DECLARE v_cash DECIMAL(20,5);
    SELECT CAST(setting_value AS DECIMAL(20,5)) INTO v_cash
    FROM settings WHERE setting_key = 'starting_cash';
    IF v_cash IS NULL THEN
        SET v_cash = 500000.00000;
    END IF;
    INSERT INTO accounts (user_id, cash_balance, starting_cash)
    VALUES (NEW.user_id, v_cash, v_cash);
END$$

CREATE TRIGGER trg_holdings_ai
AFTER INSERT ON holdings
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, action, row_key, old_value, new_value, db_user)
    VALUES (
        'holdings', 'INSERT',
        CONCAT('acct=', NEW.account_id, ';instr=', NEW.instrument_id),
        NULL,
        JSON_OBJECT('quantity', NEW.quantity, 'avg_price', NEW.avg_price),
        CURRENT_USER()
    );
END$$

CREATE TRIGGER trg_holdings_au
AFTER UPDATE ON holdings
FOR EACH ROW
BEGIN
    IF NEW.quantity <> OLD.quantity OR NEW.avg_price <> OLD.avg_price THEN
        INSERT INTO audit_log (table_name, action, row_key, old_value, new_value, db_user)
        VALUES (
            'holdings', 'UPDATE',
            CONCAT('acct=', NEW.account_id, ';instr=', NEW.instrument_id),
            JSON_OBJECT('quantity', OLD.quantity, 'avg_price', OLD.avg_price),
            JSON_OBJECT('quantity', NEW.quantity, 'avg_price', NEW.avg_price),
            CURRENT_USER()
        );
    END IF;
END$$

CREATE TRIGGER trg_holdings_ad
AFTER DELETE ON holdings
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, action, row_key, old_value, new_value, db_user)
    VALUES (
        'holdings', 'DELETE',
        CONCAT('acct=', OLD.account_id, ';instr=', OLD.instrument_id),
        JSON_OBJECT('quantity', OLD.quantity, 'avg_price', OLD.avg_price),
        NULL,
        CURRENT_USER()
    );
END$$

DELIMITER ;

INSERT INTO schema_migrations (version, filename)
VALUES ('002', 'triggers.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;
