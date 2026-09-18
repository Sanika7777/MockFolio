USE mockfolio;
DROP PROCEDURE IF EXISTS reset_user_account;
DROP PROCEDURE IF EXISTS reset_market;
DELIMITER $$
CREATE PROCEDURE reset_user_account(IN p_user_id INT)
BEGIN
  START TRANSACTION;
  DELETE FROM holdings WHERE user_id = p_user_id;
  DELETE FROM trades WHERE user_id = p_user_id;
  DELETE FROM orders WHERE user_id = p_user_id;
  UPDATE accounts SET cash_balance = starting_balance WHERE user_id = p_user_id;
  COMMIT;
END$$
CREATE PROCEDURE reset_market()
BEGIN
  START TRANSACTION;
  UPDATE stocks SET previous_simulated_price = reference_price, simulated_price = reference_price;
  DELETE FROM price_history;
  COMMIT;
END$$
DELIMITER ;
