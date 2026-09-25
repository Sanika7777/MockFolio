from datetime import datetime
from decimal import Decimal
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .database import SessionLocal
from .locks import lock_account, lock_holding, lock_stock
from .models import Order, PriceHistory, Trade
from .price_engine import BROKERAGE_RATE, money, moved_price
from .transactions import run_in_transaction, savepoint

class TradingError(Exception):
    pass

class IdempotencyConflict(Exception):
    """Same client_order_key reused for a different user/stock/side/quantity."""
    pass

def _is_duplicate_client_order_key(exc: IntegrityError) -> bool:
    orig = getattr(exc, "orig", None)
    args = getattr(orig, "args", None)
    if not args:
        return False
    message = str(args[1]) if len(args) > 1 else str(args[0])
    return "client_order_key" in message

def _existing_trade_for_key(db: Session, user_id: int, stock_id: int, quantity: int, side: str, client_order_key: str):
    """Look up the order already placed under this idempotency key, if any.

    The key is globally unique (not scoped per user), so a mismatch on
    user/stock/side/quantity means the key was reused for a different
    request and must not silently return someone else's trade.
    """
    existing = db.scalar(select(Order).where(Order.client_order_key == client_order_key))
    if not existing:
        return None
    if existing.user_id != user_id or existing.stock_id != stock_id or existing.order_type != side or existing.quantity != quantity:
        raise IdempotencyConflict("Idempotency key reused with different request")
    return db.scalar(select(Trade).where(Trade.order_id == existing.id, Trade.user_id == user_id))

def _upsert_buy_holding(db: Session, user_id: int, stock_id: int, quantity: int, fill_price: Decimal):
    """Add-to or create a holding for a BUY without ever locking a missing row.

    A `SELECT ... FOR UPDATE` against a (user_id, stock_id) row that does not
    exist yet takes a gap lock on the index gap at REPEATABLE READ. Two
    concurrent first-buys of the same stock both take that gap lock and then
    both block on each other's INSERT, which is a deadlock every time (MySQL
    error 1213), not a rare race. `INSERT ... ON DUPLICATE KEY UPDATE` lets
    MySQL resolve new-row-vs-existing-row atomically in one statement instead
    of a SELECT-then-INSERT/UPDATE pair, so no gap lock is ever taken on a
    missing row. The weighted-average math runs inside the UPDATE clause,
    where `average_buy_price` is evaluated before `quantity` is overwritten
    later in the same clause, so it still sees the pre-trade quantity.
    """
    db.execute(
        text(
            "INSERT INTO holdings (user_id, stock_id, quantity, average_buy_price, updated_at) "
            "VALUES (:user_id, :stock_id, :quantity, :fill_price, :now) "
            "ON DUPLICATE KEY UPDATE "
            "average_buy_price = ROUND(((average_buy_price * quantity) + (:fill_price * :quantity)) / (quantity + :quantity), 2), "
            "quantity = quantity + :quantity, "
            "updated_at = :now"
        ),
        {"user_id": user_id, "stock_id": stock_id, "quantity": quantity, "fill_price": fill_price, "now": datetime.utcnow()},
    )

def execute_trade(db: Session, user_id: int, stock_id: int, quantity: int, side: str, client_order_key: str | None = None):
    if quantity <= 0 or side not in {"BUY", "SELL"}:
        raise TradingError("Quantity must be positive and side must be BUY or SELL")
    if client_order_key:
        existing_trade = _existing_trade_for_key(db, user_id, stock_id, quantity, side, client_order_key)
        if existing_trade:
            return existing_trade
    stock = lock_stock(db, stock_id)
    account = lock_account(db, user_id)
    if not stock or not stock.is_active:
        raise TradingError("Stock is invalid or inactive")
    if not account:
        raise TradingError("Trading account not found")
    before = Decimal(stock.simulated_price)
    after, impact = moved_price(before, quantity, stock.average_daily_volume, side)
    fill = after
    value = money(fill * quantity)
    brokerage = money(value * BROKERAGE_RATE)
    total = value + brokerage
    holding = None
    if side == "BUY":
        if account.cash_balance < total:
            raise TradingError("Insufficient cash")
    else:
        holding = lock_holding(db, user_id, stock_id)
        if not holding or holding.quantity < quantity:
            raise TradingError("Insufficient shares")

    # Everything below this point actually mutates money/shares/price; the order
    # row above is the only "earlier work" that must survive a failure here, so
    # a savepoint isolates this block: a failure rolls back just this mutation
    # (not the order/lock work already done) before re-raising to the caller.
    order = Order(user_id=user_id, stock_id=stock_id, order_type=side, quantity=quantity, requested_price=before, status="FILLED", client_order_key=client_order_key)
    db.add(order)
    db.flush()
    with savepoint(db):
        if side == "BUY":
            account.cash_balance = money(account.cash_balance - total)
            _upsert_buy_holding(db, user_id, stock_id, quantity, fill)
        else:
            account.cash_balance = money(account.cash_balance + value - brokerage)
            holding.quantity -= quantity
            if holding.quantity == 0:
                db.delete(holding)
        stock.previous_simulated_price = before
        stock.simulated_price = after
        trade = Trade(order_id=order.id, user_id=user_id, stock_id=stock_id, side=side, quantity=quantity, fill_price=fill, brokerage=brokerage, price_before=before, price_after=after, price_impact=after - before, deviation_after_trade=after - stock.reference_price)
        db.add(trade)
        db.add(PriceHistory(stock_id=stock_id, reference_price=stock.reference_price, simulated_price=after, deviation=after - stock.reference_price, deviation_percentage=(after - stock.reference_price) / stock.reference_price * 100))
        db.flush()
    return trade

def execute_trade_tx(user_id: int, stock_id: int, quantity: int, side: str, client_order_key: str | None = None, *, max_attempts: int = 3):
    """execute_trade wrapped in the deadlock-retry transaction boundary; this is what routes should call."""
    def _attempt(db: Session):
        return execute_trade(db, user_id, stock_id, quantity, side, client_order_key)
    try:
        return run_in_transaction(_attempt, max_attempts=max_attempts)
    except IntegrityError as exc:
        # Two simultaneous requests with the same client_order_key can both pass the
        # pre-check and race to insert the Order row; exactly one INSERT wins and the
        # other hits the unique index here. is_retryable() is False for IntegrityError
        # (a duplicate key is not a deadlock), so this path is never retried by
        # run_in_transaction -- we resolve it once, in a fresh session, by replaying
        # the same idempotent lookup the sequential-repeat case already uses.
        if not client_order_key or not _is_duplicate_client_order_key(exc):
            raise
        db = SessionLocal()
        try:
            trade = _existing_trade_for_key(db, user_id, stock_id, quantity, side, client_order_key)
        finally:
            db.close()
        if trade is None:
            raise TradingError("Trade could not be completed") from exc
        return trade
