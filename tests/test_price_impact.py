from decimal import Decimal
from backend.price_engine import calculate_impact, decay_price, moved_price

def test_impact_has_cap():
    assert calculate_impact(10_000_000, 1) == Decimal('0.05')

def test_buy_moves_up_and_sell_down():
    up, _ = moved_price(Decimal('100'), 100, 10000, 'BUY')
    down, _ = moved_price(Decimal('100'), 100, 10000, 'SELL')
    assert up > Decimal('100') and down < Decimal('100')

def test_decay_returns_toward_reference():
    assert decay_price(Decimal('110'), Decimal('100')) < Decimal('110')
