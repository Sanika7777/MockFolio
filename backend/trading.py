import uuid
from decimal import Decimal
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from . import settings_store
from . import database
import logging
from .locks import lock_account, lock_holding, lock_order, lock_price_state
from .models import Holding, Instrument, Order, PriceState, Trade
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


logger = logging.getLogger("mockfolio.orders")


def execute_trade(
    db: Session,
    account_id: int,
    instrument_id: int,
    quantity: int,
    side: str,
    client_order_id: str,
    config: dict,
    *,
    pending_order_id: int | None = None,
    stop_loss: Decimal | None = None,
    target_price: Decimal | None = None,
):
    """Fill a MARKET order now, or fill an already-placed PENDING order (pending_order_id) whose price was hit."""
    if side not in ("BUY", "SELL"):
        raise TradingError("Side must be BUY or SELL", "BAD_SIDE")
    if quantity <= 0:
        raise TradingError("Quantity must be greater than zero", "BAD_QUANTITY")
    if quantity > config["max_order_qty"]:
        raise TradingError(f"Quantity exceeds the per-order cap of {config['max_order_qty']}", "QTY_CAP")

    if pending_order_id is None:
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

    if pending_order_id is not None:
        order = lock_order(db, pending_order_id)
        if not order or order.status != "PENDING":
            raise TradingError("Order is no longer pending", "NOT_PENDING")
        # A limit order never fills worse than its limit, impact included; it waits for the next tick instead.
        if order.order_type == "LIMIT" and (
            (side == "BUY" and exec_price > order.limit_price) or (side == "SELL" and exec_price < order.limit_price)
        ):
            raise TradingError("Limit price not reachable yet", "LIMIT_NOT_MET")
    else:
        order = Order(
            client_order_id=client_order_id,
            account_id=account_id,
            instrument_id=instrument_id,
            side=side,
            order_type="MARKET",
            quantity=quantity,
            stop_loss=stop_loss,
            target_price=target_price,
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
        if side == "BUY" and (order.stop_loss or order.target_price):
            _place_exits(db, order)
        if order.parent_order_id:
            # One-cancels-other: the stop-loss or target filled, so the other exit is no longer needed.
            db.execute(
                text(
                    "UPDATE orders SET status = 'CANCELLED', reject_reason = 'Other exit order filled' "
                    "WHERE parent_order_id = :p AND status = 'PENDING' AND order_id <> :o"
                ),
                {"p": order.parent_order_id, "o": order.order_id},
            )
    return trade


def _place_exits(db: Session, parent: Order):
    """After a BUY fills, park its stop-loss and target as pending SELL orders for the same quantity."""
    base = {
        "account_id": parent.account_id,
        "instrument_id": parent.instrument_id,
        "side": "SELL",
        "quantity": parent.quantity,
        "parent_order_id": parent.order_id,
        "status": "PENDING",
    }
    if parent.stop_loss:
        db.add(Order(client_order_id=str(uuid.uuid4()), order_type="STOPLOSS", trigger_price=parent.stop_loss, **base))
    if parent.target_price:
        db.add(Order(client_order_id=str(uuid.uuid4()), order_type="LIMIT", limit_price=parent.target_price, **base))
    db.flush()


def trade_config() -> dict:
    return {
        "kappa": settings_store.get_decimal("kappa"),
        "tau_seconds": settings_store.get_int("tau_seconds"),
        "perm_fraction": settings_store.get_decimal("perm_fraction"),
        "brokerage_pct": settings_store.get_decimal("brokerage_pct"),
        "max_order_qty": settings_store.get_int("max_order_qty"),
        "max_impact_pct": settings_store.get_decimal("max_impact_pct"),
    }


def validate_bracket(entry: Decimal, stop_loss: Decimal | None, target_price: Decimal | None):
    if stop_loss is not None and not 0 < stop_loss < entry:
        raise TradingError(f"Stop-loss must be below the entry price ({money(entry)})", "BAD_STOPLOSS")
    if target_price is not None and target_price <= entry:
        raise TradingError(f"Target must be above the entry price ({money(entry)})", "BAD_TARGET")


def execute_trade_tx(
    account_id: int,
    instrument_id: int,
    quantity: int,
    side: str,
    client_order_id: str | None = None,
    *,
    stop_loss: Decimal | None = None,
    target_price: Decimal | None = None,
    max_attempts: int = 3,
):
    key = client_order_id or str(uuid.uuid4())
    config = trade_config()
    if (stop_loss is not None or target_price is not None) and side != "BUY":
        raise TradingError("Stop-loss and target can only be attached to a BUY", "BAD_BRACKET")

    def _attempt(db: Session):
        if stop_loss is not None or target_price is not None:
            state = db.get(PriceState, instrument_id)
            if state:
                validate_bracket(state.adjusted_price, stop_loss, target_price)
        return execute_trade(
            db, account_id, instrument_id, quantity, side, key, config, stop_loss=stop_loss, target_price=target_price
        )

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


def place_order_tx(
    account_id: int,
    instrument_id: int,
    side: str,
    quantity: int,
    order_type: str,
    *,
    limit_price: Decimal | None = None,
    trigger_price: Decimal | None = None,
    stop_loss: Decimal | None = None,
    target_price: Decimal | None = None,
    client_order_id: str | None = None,
) -> Order:
    """Park a LIMIT or STOPLOSS order; the tick worker fills it once the price is hit."""
    config = trade_config()
    if side not in ("BUY", "SELL"):
        raise TradingError("Side must be BUY or SELL", "BAD_SIDE")
    if order_type not in ("LIMIT", "STOPLOSS"):
        raise TradingError("Order type must be LIMIT or STOPLOSS", "BAD_ORDER_TYPE")
    if not 0 < quantity <= config["max_order_qty"]:
        raise TradingError(f"Quantity must be between 1 and {config['max_order_qty']}", "BAD_QUANTITY")
    level = limit_price if order_type == "LIMIT" else trigger_price
    if level is None or level <= 0:
        raise TradingError("Limit orders need a limit price; stop orders need a trigger price", "BAD_PRICE")
    if (stop_loss is not None or target_price is not None) and side != "BUY":
        raise TradingError("Stop-loss and target can only be attached to a BUY", "BAD_BRACKET")
    validate_bracket(level, stop_loss, target_price)

    def _attempt(db: Session):
        if not db.get(PriceState, instrument_id):
            raise TradingError("Unknown instrument", "UNKNOWN_INSTRUMENT")
        if side == "BUY":
            cash = db.scalar(text("SELECT cash_balance FROM accounts WHERE account_id = :a"), {"a": account_id})
            if cash is None or cash < level * quantity * (1 + config["brokerage_pct"]):
                raise TradingError("Insufficient cash for this order", "INSUFFICIENT_CASH")
        else:
            held = db.scalar(
                select(Holding.quantity).where(Holding.account_id == account_id, Holding.instrument_id == instrument_id)
            )
            if not held or held < quantity:
                raise TradingError("Insufficient shares", "INSUFFICIENT_SHARES")
        order = Order(
            client_order_id=client_order_id or str(uuid.uuid4()),
            account_id=account_id,
            instrument_id=instrument_id,
            side=side,
            order_type=order_type,
            quantity=quantity,
            limit_price=limit_price if order_type == "LIMIT" else None,
            trigger_price=trigger_price if order_type == "STOPLOSS" else None,
            stop_loss=stop_loss,
            target_price=target_price,
            status="PENDING",
        )
        db.add(order)
        db.flush()
        db.refresh(order)
        return order

    return run_in_transaction(_attempt)


def cancel_order_tx(account_id: int, order_id: int) -> None:
    def _attempt(db: Session):
        order = lock_order(db, order_id)
        if not order or order.account_id != account_id:
            raise TradingError("Order not found", "NOT_FOUND")
        if order.status != "PENDING":
            raise TradingError(f"Only pending orders can be cancelled (this one is {order.status.lower()})", "NOT_PENDING")
        order.status = "CANCELLED"
        order.reject_reason = "Cancelled by you"

    run_in_transaction(_attempt)


def is_triggered(side: str, order_type: str, price: Decimal, limit_price, trigger_price) -> bool:
    if order_type == "LIMIT":
        return price <= limit_price if side == "BUY" else price >= limit_price
    if order_type == "STOPLOSS":
        return price >= trigger_price if side == "BUY" else price <= trigger_price
    return False


def process_pending_orders() -> int:
    """Called by the tick worker: fill every pending order whose price has been hit. Returns fills."""
    db = database.SessionLocal()
    try:
        rows = db.execute(
            select(Order, PriceState.adjusted_price)
            .join(PriceState, PriceState.instrument_id == Order.instrument_id)
            .where(Order.status == "PENDING")
            .order_by(Order.order_id)
        ).all()
        due = [o for o, price in rows if is_triggered(o.side, o.order_type, price, o.limit_price, o.trigger_price)]
        todo = [(o.order_id, o.account_id, o.instrument_id, o.quantity, o.side, o.client_order_id) for o in due]
    finally:
        db.close()

    config = trade_config()
    filled = 0
    for order_id, account_id, instrument_id, quantity, side, key in todo:
        try:
            run_in_transaction(
                lambda db, a=(account_id, instrument_id, quantity, side, key, order_id): execute_trade(
                    db, a[0], a[1], a[2], a[3], a[4], config, pending_order_id=a[5]
                )
            )
            filled += 1
        except TradingError as exc:
            if exc.code in ("LIMIT_NOT_MET", "NOT_PENDING"):
                continue
            _reject(order_id, str(exc))
        except Exception as exc:
            logger.warning("pending order %s failed: %s", order_id, exc)
    return filled


def _reject(order_id: int, reason: str) -> None:
    def _attempt(db: Session):
        order = lock_order(db, order_id)
        if order and order.status == "PENDING":
            order.status = "REJECTED"
            order.reject_reason = reason[:250]

    run_in_transaction(_attempt)
