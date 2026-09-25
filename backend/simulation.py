from sqlalchemy.orm import Session
from .locks import lock_stocks
from .models import PriceHistory
from .price_engine import decay_price
from .transactions import run_in_transaction

def _decay_all_stocks(db: Session) -> int:
    """Decay every active stock toward its reference price in one short transaction.

    Stocks are locked in ascending id order (fixed, matching the canonical
    multi-row lock order) so this can never deadlock against another decay
    call, and it uses the same run_in_transaction retry path as trades so it
    can't deadlock against a concurrent BUY/SELL either.
    """
    stocks = lock_stocks(db)
    for stock in stocks:
        before = stock.simulated_price
        after = decay_price(before, stock.reference_price)
        stock.previous_simulated_price = before
        stock.simulated_price = after
        db.add(PriceHistory(
            stock_id=stock.id,
            reference_price=stock.reference_price,
            simulated_price=after,
            deviation=after - stock.reference_price,
            deviation_percentage=(after - stock.reference_price) / stock.reference_price * 100,
        ))
    return len(stocks)

def run_decay_tx(*, max_attempts: int = 3) -> int:
    return run_in_transaction(_decay_all_stocks, max_attempts=max_attempts)
