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

DROP TRIGGER IF EXISTS trg_holding_audit_insert;
DELIMITER $$
CREATE TRIGGER trg_holding_audit_insert AFTER INSERT ON holdings FOR EACH ROW
BEGIN
  INSERT INTO audit_log(action, table_name, record_id, old_value, new_value) VALUES ('HOLDING_CREATE', 'holdings', NEW.id, NULL, CAST(NEW.quantity AS CHAR));
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_holding_audit_delete;
DELIMITER $$
CREATE TRIGGER trg_holding_audit_delete AFTER DELETE ON holdings FOR EACH ROW
BEGIN
  INSERT INTO audit_log(action, table_name, record_id, old_value, new_value) VALUES ('HOLDING_DELETE', 'holdings', OLD.id, CAST(OLD.quantity AS CHAR), NULL);
END$$
DELIMITER ;
