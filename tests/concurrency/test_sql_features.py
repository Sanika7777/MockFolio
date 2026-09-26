from sqlalchemy import text

import backend.database as database
from backend.trading import execute_trade_tx

import helpers


def _audit(action: str):
    db = database.SessionLocal()
    try:
        return db.execute(
            text(
                "SELECT row_key, old_value->>'$.quantity' AS old_qty, new_value->>'$.quantity' AS new_qty "
                "FROM audit_log WHERE table_name = 'holdings' AND action = :a ORDER BY log_id"
            ),
            {"a": action},
        ).all()
    finally:
        db.close()


def test_first_buy_is_audited_as_an_insert():
    helpers.reset_db()
    account_id = helpers.make_accounts(1)[0]
    instrument_id = helpers.get_instrument_ids(1)[0]

    execute_trade_tx(account_id, instrument_id, 5, "BUY")

    rows = _audit("INSERT")
    assert len(rows) == 1
    assert rows[0].old_qty is None
    assert rows[0].new_qty == "5"
    assert rows[0].row_key == f"acct={account_id};instr={instrument_id}"


def test_selling_the_whole_position_is_audited_as_an_update_to_zero():
    helpers.reset_db()
    account_id = helpers.make_accounts(1)[0]
    instrument_id = helpers.get_instrument_ids(1)[0]

    execute_trade_tx(account_id, instrument_id, 5, "BUY")
    execute_trade_tx(account_id, instrument_id, 5, "SELL")

    rows = _audit("UPDATE")
    assert rows, "selling the full position should leave an UPDATE audit row"
    assert rows[-1].old_qty == "5"
    assert rows[-1].new_qty == "0"

    db = database.SessionLocal()
    try:
        quantity = db.execute(
            text("SELECT quantity FROM holdings WHERE account_id = :a AND instrument_id = :i"),
            {"a": account_id, "i": instrument_id},
        ).scalar()
        assert quantity == 0, "the zero-quantity row is kept on purpose; the portfolio view filters it out"
        visible = db.execute(
            text("SELECT COUNT(*) FROM v_portfolio_summary WHERE account_id = :a"), {"a": account_id}
        ).scalar()
        assert visible == 0
    finally:
        db.close()


def test_reset_account_does_not_cascade_into_audit_log():
    helpers.reset_db()
    account_id = helpers.make_accounts(1)[0]
    instrument_id = helpers.get_instrument_ids(1)[0]

    execute_trade_tx(account_id, instrument_id, 3, "BUY")

    db = database.SessionLocal()
    try:
        before = db.execute(text("SELECT COUNT(*) FROM audit_log")).scalar()
        assert before >= 1

        db.execute(text("CALL sp_reset_account(:a)"), {"a": account_id})
        db.commit()

        after = db.execute(text("SELECT COUNT(*) FROM audit_log")).scalar()
        assert after > before

        counts = db.execute(
            text(
                "SELECT (SELECT COUNT(*) FROM holdings WHERE account_id = :a) AS n_holdings, "
                "(SELECT COUNT(*) FROM orders WHERE account_id = :a) AS n_orders, "
                "(SELECT COUNT(*) FROM trades WHERE account_id = :a) AS n_trades"
            ),
            {"a": account_id},
        ).one()
        assert (counts.n_holdings, counts.n_orders, counts.n_trades) == (0, 0, 0)

        cash = db.execute(
            text("SELECT cash_balance = starting_cash FROM accounts WHERE account_id = :a"), {"a": account_id}
        ).scalar()
        assert cash == 1
    finally:
        db.close()
