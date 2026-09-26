"""Task 9 items 1 & 2: holding audit trigger coverage, and proof that
reset_user_account leaves audit_log intact (no cascade)."""
from sqlalchemy import text

import backend.transactions as transactions
from backend.trading import execute_trade_tx

import helpers


def test_holding_insert_and_delete_are_audited():
    helpers.reset_db()
    user_id = helpers.make_users(1)[0]
    stock_id = helpers.get_stock_ids(1)[0]

    execute_trade_tx(user_id, stock_id, 5, "BUY")  # first buy -> INSERT into holdings

    db = transactions.SessionLocal()
    try:
        create_rows = db.execute(text("SELECT old_value, new_value FROM audit_log WHERE action = 'HOLDING_CREATE'")).all()
        assert len(create_rows) == 1
        assert create_rows[0].old_value is None
        assert create_rows[0].new_value == "5"
    finally:
        db.close()

    execute_trade_tx(user_id, stock_id, 5, "SELL")  # sell the full position -> DELETE from holdings

    db = transactions.SessionLocal()
    try:
        delete_rows = db.execute(text("SELECT old_value, new_value FROM audit_log WHERE action = 'HOLDING_DELETE'")).all()
        assert len(delete_rows) == 1
        assert delete_rows[0].old_value == "5"
        assert delete_rows[0].new_value is None
    finally:
        db.close()


def test_reset_user_account_does_not_cascade_into_audit_log():
    helpers.reset_db()
    user_id = helpers.make_users(1)[0]
    stock_id = helpers.get_stock_ids(1)[0]

    execute_trade_tx(user_id, stock_id, 3, "BUY")

    db = transactions.SessionLocal()
    try:
        audit_count_before = db.execute(text("SELECT COUNT(*) FROM audit_log")).scalar()
        assert audit_count_before >= 1  # the HOLDING_CREATE row from the buy above

        db.execute(text("CALL reset_user_account(:uid)"), {"uid": user_id})
        db.commit()

        # The procedure's DELETE FROM holdings fires trg_holding_audit_delete,
        # so the count should grow (not shrink or stay flat), proving the
        # earlier audit_log rows were not cascade-deleted along with the
        # holdings/trades/orders rows the procedure removes.
        audit_count_after = db.execute(text("SELECT COUNT(*) FROM audit_log")).scalar()
        assert audit_count_after > audit_count_before

        remaining_holdings = db.execute(text("SELECT COUNT(*) FROM holdings WHERE user_id = :uid"), {"uid": user_id}).scalar()
        remaining_orders = db.execute(text("SELECT COUNT(*) FROM orders WHERE user_id = :uid"), {"uid": user_id}).scalar()
        remaining_trades = db.execute(text("SELECT COUNT(*) FROM trades WHERE user_id = :uid"), {"uid": user_id}).scalar()
        assert (remaining_holdings, remaining_orders, remaining_trades) == (0, 0, 0)
    finally:
        db.close()
