from decimal import Decimal

import pytest

from backend.market_data import YahooSource


def _source(prices: dict[str, object]) -> YahooSource:
    src = YahooSource(refresh_s=60)

    def fake_price(ticker):
        value = prices[ticker]
        if isinstance(value, Exception):
            raise value
        return Decimal(value)

    src._price = fake_price
    return src


def test_maps_prices_skips_failures_and_throttles():
    src = _source({"RELIANCE.NS": "1197.6", "TCS.NS": RuntimeError("429")})
    rows = [
        {"instrument_id": 1, "yf_ticker": "RELIANCE.NS"},
        {"instrument_id": 2, "yf_ticker": "TCS.NS"},
        {"instrument_id": 3, "yf_ticker": None},
    ]
    assert src.quotes(rows) == {1: Decimal("1197.6")}
    assert src.quotes(rows) == {}  # inside refresh window: hold last prices


def test_all_failures_raise():
    src = _source({"TCS.NS": RuntimeError("429")})
    with pytest.raises(RuntimeError):
        src.quotes([{"instrument_id": 2, "yf_ticker": "TCS.NS"}])
