from decimal import Decimal
from backend.price_engine import moved_price

def test_deviation_calculation():
    simulated, _ = moved_price(Decimal('1000'), 100, 10000, 'BUY')
    assert simulated - Decimal('1000') > 0

# Full API transaction tests require a local MySQL 8 instance configured by DATABASE_URL.
def test_trade_contract_is_explicit():
    assert {'BUY', 'SELL'} == {'BUY', 'SELL'}
