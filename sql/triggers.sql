-- =====================================================================
-- Mockfolio — 02_triggers.sql
--
-- RUN THIS WITH THE mysql CLI:
--     mysql -u mf_migrate -p mockfolio < sql/02_triggers.sql
--
-- DO NOT run it from SQLTools / DBeaver "execute selection". DELIMITER is a
-- CLIENT command, not SQL — most GUI clients either ignore it or choke on it,
-- and you get error 1064 on a trigger body that is actually fine.
-- =====================================================================

USE mockfolio;

-- ---------------------------------------------------------------------
-- THE TRAP IN YOUR BRIEF
-- ---------------------------------------------------------------------
-- Section 6 says: "a trigger that closes a holding when quantity reaches
-- zero". If you implement that as a trigger on `holdings` that DELETEs from
-- `holdings`, MySQL raises error 1442:
--     "Can't update table 'holdings' in stored function/trigger because it is
--      already used by statement which invoked this trigger."
-- A trigger can never modify its own table.
--
-- Correct answer: leave the zero-quantity row in place (the view already
-- filters WHERE quantity <> 0), or delete it in sp_place_order / Python after
-- the UPDATE. Do NOT try to be clever here.
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_holdings_ai;
DROP TRIGGER IF EXISTS trg_holdings_au;
DROP TRIGGER IF EXISTS trg_holdings_ad;

DELIMITER $$

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
    -- Skip no-op updates: an UPSERT that changes nothing would otherwise
    -- double your audit volume during the load test.
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
VALUES ('002', '02_triggers.sql')
ON DUPLICATE KEY UPDATE applied_at = applied_at;

SHOW TRIGGERS FROM vtf;