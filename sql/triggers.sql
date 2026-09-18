USE mockfolio;
DROP TRIGGER IF EXISTS trg_holding_audit_update;
DELIMITER $$
CREATE TRIGGER trg_holding_audit_update AFTER UPDATE ON holdings FOR EACH ROW
BEGIN
  IF OLD.quantity <> NEW.quantity THEN
    INSERT INTO audit_log(action, table_name, record_id, old_value, new_value) VALUES ('HOLDING_CHANGE', 'holdings', NEW.id, CAST(OLD.quantity AS CHAR), CAST(NEW.quantity AS CHAR));
  END IF;
END$$
DELIMITER ;
