from decimal import Decimal

import pytest

from backend.trading import TradingError, is_triggered, validate_bracket

D = Decimal


@pytest.mark.parametrize(
    "side, order_type, price, limit, trigger, expected",
    [
        ("BUY", "LIMIT", D("99"), D("100"), None, True),
        ("BUY", "LIMIT", D("101"), D("100"), None, False),
        ("SELL", "LIMIT", D("111"), D("110"), None, True),  # target hit
        ("SELL", "LIMIT", D("109"), D("110"), None, False),
        ("SELL", "STOPLOSS", D("94"), None, D("95"), True),  # stop-loss hit
        ("SELL", "STOPLOSS", D("96"), None, D("95"), False),
        ("BUY", "STOPLOSS", D("106"), None, D("105"), True),
        ("BUY", "MARKET", D("100"), None, None, False),
    ],
)
def test_is_triggered(side, order_type, price, limit, trigger, expected):
    assert is_triggered(side, order_type, price, limit, trigger) is expected


def test_bracket_must_straddle_entry():
    validate_bracket(D("100"), D("95"), D("110"))
    validate_bracket(D("100"), None, None)
    with pytest.raises(TradingError):
        validate_bracket(D("100"), D("101"), None)
    with pytest.raises(TradingError):
        validate_bracket(D("100"), None, D("100"))
