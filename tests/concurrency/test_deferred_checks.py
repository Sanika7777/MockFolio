"""Real-database proofs for acceptance checks that were only unit-tested
against fakes (or not exercised at all) while MySQL access was unavailable.

Lives under tests/concurrency/ so it benefits from conftest.py's autouse
fixture pointing backend.transactions/trading/database.SessionLocal at the
dedicated test database.
"""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import backend.database as database
from backend.main import app, current_user
from backend.models import Order
from backend.trading import IdempotencyConflict, execute_trade_tx

import helpers


def _fake_admin():
    return SimpleNamespace(id=1, username="admin", email="admin@test.local", is_admin=True)


# --- Task 2: idempotency conflicts against a real Order row, not a fake ---

def test_same_key_different_quantity_conflicts_for_real():
    helpers.reset_db()
    account_id = helpers.make_accounts(1)[0]
    instrument_id = helpers.get_instrument_ids(1)[0]
    key = "conflict-qty-key"

    execute_trade_tx(account_id, instrument_id, 5, "BUY", key)
    with pytest.raises(IdempotencyConflict):
        execute_trade_tx(account_id, instrument_id, 10, "BUY", key)

    db = database.SessionLocal()
    try:
        orders = db.scalars(select(Order).where(Order.client_order_id == key)).all()
        assert len(orders) == 1, "the conflicting request must not have inserted a second order"
    finally:
        db.close()


def test_same_key_different_user_does_not_leak_for_real():
    helpers.reset_db()
    user_a, user_b = helpers.make_accounts(2)
    instrument_id = helpers.get_instrument_ids(1)[0]
    key = "conflict-user-key"

    trade_a = execute_trade_tx(user_a, instrument_id, 5, "BUY", key)
    with pytest.raises(IdempotencyConflict):
        execute_trade_tx(user_b, instrument_id, 5, "BUY", key)

    db = database.SessionLocal()
    try:
        orders = db.scalars(select(Order).where(Order.client_order_id == key)).all()
        assert len(orders) == 1
        assert orders[0].account_id == user_a
        assert orders[0].order_id == trade_a.order_id
    finally:
        db.close()


# --- Task 3: admin gate actually reaches the database and succeeds ---

def test_decay_succeeds_for_admin_for_real():
    helpers.reset_db()
    app.dependency_overrides[current_user] = _fake_admin
    try:
        client = TestClient(app)
        resp = client.post("/simulation/decay")
        assert resp.status_code == 200
        assert resp.json()["instruments"] > 0
    finally:
        app.dependency_overrides.pop(current_user, None)
