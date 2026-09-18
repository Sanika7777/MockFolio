from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Account, Holding, Order, PriceHistory, Stock, Trade
from .price_engine import BROKERAGE_RATE, money, moved_price

class TradingError(Exception):
    pass

def execute_trade(db: Session, user_id: int, stock_id: int, quantity: int, side: str, client_order_key: str | None = None):
    if quantity <= 0 or side not in {"BUY", "SELL"}:
        raise TradingError("Quantity must be positive and side must be BUY or SELL")
    if client_order_key:
        existing = db.scalar(select(Order).where(Order.client_order_key == client_order_key))
        if existing:
            return db.scalar(select(Trade).where(Trade.order_id == existing.id))
    stock = db.scalar(select(Stock).where(Stock.id == stock_id).with_for_update())
    account = db.scalar(select(Account).where(Account.user_id == user_id).with_for_update())
    if not stock or not stock.is_active:
        raise TradingError("Stock is invalid or inactive")
    if not account:
        raise TradingError("Trading account not found")
    holding = db.scalar(select(Holding).where(Holding.user_id == user_id, Holding.stock_id == stock_id).with_for_update())
    before = Decimal(stock.simulated_price)
    after, impact = moved_price(before, quantity, stock.average_daily_volume, side)
    fill = after
    value = money(fill * quantity)
    brokerage = money(value * BROKERAGE_RATE)
    total = value + brokerage
    if side == "BUY":
        if account.cash_balance < total:
            raise TradingError("Insufficient cash")
        account.cash_balance = money(account.cash_balance - total)
        if holding:
            old_qty = holding.quantity
            holding.average_buy_price = money(((holding.average_buy_price * old_qty) + (fill * quantity)) / (old_qty + quantity))
            holding.quantity += quantity
        else:
            holding = Holding(user_id=user_id, stock_id=stock_id, quantity=quantity, average_buy_price=fill)
            db.add(holding)
    else:
        if not holding or holding.quantity < quantity:
            raise TradingError("Insufficient shares")
        account.cash_balance = money(account.cash_balance + value - brokerage)
        holding.quantity -= quantity
        if holding.quantity == 0:
            db.delete(holding)
    stock.previous_simulated_price = before
    stock.simulated_price = after
    order = Order(user_id=user_id, stock_id=stock_id, order_type=side, quantity=quantity, requested_price=before, status="FILLED", client_order_key=client_order_key)
    db.add(order)
    db.flush()
    trade = Trade(order_id=order.id, user_id=user_id, stock_id=stock_id, side=side, quantity=quantity, fill_price=fill, brokerage=brokerage, price_before=before, price_after=after, price_impact=after - before, deviation_after_trade=after - stock.reference_price)
    db.add(trade)
    db.add(PriceHistory(stock_id=stock_id, reference_price=stock.reference_price, simulated_price=after, deviation=after - stock.reference_price, deviation_percentage=(after - stock.reference_price) / stock.reference_price * 100))
    db.commit()
    db.refresh(trade)
    return trade
