import uuid
from decimal import Decimal
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from . import settings_store
from . import database
from .locks import lock_account, lock_holding, lock_price_state
from .models import Instrument, Order, Trade
from .price_engine import adjusted, decayed_temp_offset, money, offset, split_impact, trade_price_move
from .transactions import run_in_transaction, savepoint


class TradingError(Exception):
    def __init__(self, message: str, code: str = "REJECTED"):
        super().__init__(message)
        self.code = code


class IdempotencyConflict(Exception):
    pass


def _is_duplicate_client_order_id(exc: IntegrityError) -> bool:
    orig = getattr(exc, "orig", None)
    args = getattr(orig, "args", None)
    if not args:
        return False
    message = str(args[1]) if len(args) > 1 else str(args[0])
    return "client_order_id" in message or "uq_orders_client_id" in message


def _existing_trade(db: Session, account_id: int, instrument_id: int, quantity: int, side: str, client_order_id: str):
    order = db.scalar(select(Order).where(Order.client_order_id == client_order_id))
    if not order:
        return None
    if order.account_id != account_id or order.instrument_id != instrument_id or order.side != side or order.quantity != quantity:
        raise IdempotencyConflict("Idempotency key reused with a different request")
    return db.scalar(select(Trade).where(Trade.order_id == order.order_id))


def _upsert_holding(db: Session, account_id: int, instrument_id: int, quantity: int, price: Decimal):
    db.execute(
        text(
            "INSERT INTO holdings (account_id, instrument_id, quantity, avg_price) "
            "VALUES (:account_id, :instrument_id, :quantity, :price) "
            "ON DUPLICATE KEY UPDATE "
            "avg_price = ROUND(((avg_price * quantity) + (:price * :quantity)) / (quantity + :quantity), 4), "
            "quantity = quantity + :quantity"
        ),
        {"account_id": account_id, "instrument_id": instrument_id, "quantity": quantity, "price": price},
    )


def execute_trade(db: Session, account_id: int, instrument_id: int, quantity: int, side: str, client_order_id: str, config: dict):
    if side not in ("BUY", "SELL"):
        raise TradingError("Side must be BUY or SELL", "BAD_SIDE")
    if quantity <= 0:
        raise TradingError("Quantity must be greater than zero", "BAD_QUANTITY")
    if quantity > config["max_order_qty"]:
        raise TradingError(f"Quantity exceeds the per-order cap of {config['max_order_qty']}", "QTY_CAP")

    existing = _existing_trade(db, account_id, instrument_id, quantity, side, client_order_id)
    if existing:
        return existing

    now = db.scalar(text("SELECT UTC_TIMESTAMP(3)"))

    price_state = lock_price_state(db, instrument_id)
    if not price_state:
        raise TradingError("Unknown instrument", "UNKNOWN_INSTRUMENT")
    instrument = db.get(Instrument, instrument_id)
    if not instrument or not instrument.is_active:
        raise TradingError("Instrument is inactive", "INACTIVE_INSTRUMENT")

    elapsed = (now - price_state.last_decay_at).total_seconds()
    temp_after_decay = decayed_temp_offset(price_state.temp_offset, elapsed, config["tau_seconds"])
    pre_price = adjusted(price_state.raw_price, price_state.perm_offset, temp_after_decay)

    kappa = instrument.kappa_override if instrument.kappa_override is not None else config["kappa"]
    move, fraction = trade_price_move(
        pre_price, quantity, instrument.avg_daily_vol, instrument.daily_sigma, side, kappa, config["max_impact_pct"]
    )
    perm_part, temp_part = split_impact(move, config["perm_fraction"])
    new_perm = offset(price_state.perm_offset + perm_part)
    new_temp = offset(temp_after_decay + temp_part)
    exec_price = adjusted(price_state.raw_price, new_perm, new_temp)

    value = money(exec_price * quantity)
    brokerage = money(value * config["brokerage_pct"])

    account = lock_account(db, account_id)
    if not account:
        raise TradingError("Trading account not found", "NO_ACCOUNT")

    holding = None
    realised = None
    if side == "BUY":
        if account.cash_balance < value + brokerage:
            raise TradingError("Insufficient cash", "INSUFFICIENT_CASH")
    else:
        holding = lock_holding(db, account_id, instrument_id)
        if not holding or holding.quantity < quantity:
            raise TradingError("Insufficient shares", "INSUFFICIENT_SHARES")
        realised = money((exec_price - holding.avg_price) * quantity - brokerage)

    order = Order(
        client_order_id=client_order_id,
        account_id=account_id,
        instrument_id=instrument_id,
        side=side,
        order_type="MARKET",
        quantity=quantity,
        status="PENDING",
    )
    db.add(order)
    db.flush()

    with savepoint(db):
        price_state.perm_offset = new_perm
        price_state.temp_offset = new_temp
        price_state.last_decay_at = now
        if side == "BUY":
            account.cash_balance = money(account.cash_balance - value - brokerage)
            _upsert_holding(db, account_id, instrument_id, quantity, exec_price)
        else:
            account.cash_balance = money(account.cash_balance + value - brokerage)
            account.realised_pl = money(account.realised_pl + realised)
            holding.quantity -= quantity
        trade = Trade(
            order_id=order.order_id,
            account_id=account_id,
            instrument_id=instrument_id,
            side=side,
            pre_trade_price=pre_price,
            exec_price=exec_price,
            quantity=quantity,
            brokerage=brokerage,
            realised_pl=realised,
            price_impact=fraction,
            deviation_after_trade=offset(new_perm + new_temp),
        )
        db.add(trade)
        order.status = "FILLED"
        db.flush()
    return trade


def execute_trade_tx(account_id: int, instrument_id: int, quantity: int, side: str, client_order_id: str | None = None, *, max_attempts: int = 3):
    key = client_order_id or str(uuid.uuid4())
    config = {
        "kappa": settings_store.get_decimal("kappa"),
        "tau_seconds": settings_store.get_int("tau_seconds"),
        "perm_fraction": settings_store.get_decimal("perm_fraction"),
        "brokerage_pct": settings_store.get_decimal("brokerage_pct"),
        "max_order_qty": settings_store.get_int("max_order_qty"),
        "max_impact_pct": settings_store.get_decimal("max_impact_pct"),
    }

    def _attempt(db: Session):
        return execute_trade(db, account_id, instrument_id, quantity, side, key, config)

    try:
        return run_in_transaction(_attempt, max_attempts=max_attempts)
    except IntegrityError as exc:
        if not _is_duplicate_client_order_id(exc):
            raise
        db = database.SessionLocal()
        try:
            trade = _existing_trade(db, account_id, instrument_id, quantity, side, key)
        finally:
            db.close()
        if trade is None:
            raise TradingError("Trade could not be completed", "RETRY_EXHAUSTED") from exc
        return trade
