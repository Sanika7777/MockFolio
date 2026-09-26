DROP PROCEDURE IF EXISTS sp_reset_account;
DROP PROCEDURE IF EXISTS sp_reset_market;

DELIMITER $$

CREATE PROCEDURE sp_reset_account(IN p_account_id INT UNSIGNED)
BEGIN
    DECLARE v_locked INT UNSIGNED;
    SELECT account_id INTO v_locked FROM accounts WHERE account_id = p_account_id FOR UPDATE;
    DELETE FROM holdings WHERE account_id = p_account_id;
    DELETE FROM trades WHERE account_id = p_account_id;
    DELETE FROM orders WHERE account_id = p_account_id;
    UPDATE accounts
    SET cash_balance = starting_cash,
        realised_pl = 0,
        blocked_margin = 0,
        version = version + 1
    WHERE account_id = p_account_id;
END$$

CREATE PROCEDURE sp_reset_market()
BEGIN
    UPDATE price_state
    SET perm_offset = 0,
        temp_offset = 0,
        last_decay_at = UTC_TIMESTAMP(3)
    ORDER BY instrument_id;
    DELETE FROM candles_1m WHERE is_adjusted = 1;
END$$

DELIMITER ;

INSERT INTO schema_migrations (version, filename)
VALUES ('004', 'procedures.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;
