from datetime import datetime, timedelta
from decimal import Decimal

from backend.charts import ist_day_start_utc, portfolio_history, resample


def test_resample_day_start_and_portfolio_replay():
    t0 = datetime(2026, 9, 28, 4, 0)
    ones = [
        {"bucket_start": t0 + timedelta(minutes=m), "open": 10 + m, "high": 20 + m, "low": 5 + m, "close": 11 + m, "volume": 1}
        for m in range(10)
    ]
    five = resample([dict(c) for c in ones], 5)
    assert [c["bucket_start"].minute for c in five] == [0, 5]
    assert five[0]["open"] == 10 and five[0]["close"] == 15 and five[0]["high"] == 24 and five[0]["low"] == 5 and five[0]["volume"] == 5

    assert ist_day_start_utc(datetime(2026, 9, 28, 20, 0)) == datetime(2026, 9, 28, 18, 30)
    assert ist_day_start_utc(datetime(2026, 9, 28, 10, 0)) == datetime(2026, 9, 27, 18, 30)

    trades = [
        {"instrument_id": 1, "side": "BUY", "quantity": 10, "exec_price": Decimal("100"), "brokerage": Decimal("1"), "executed_at": t0},
        {"instrument_id": 1, "side": "SELL", "quantity": 4, "exec_price": Decimal("110"), "brokerage": Decimal("1"), "executed_at": t0 + timedelta(minutes=3)},
    ]
    closes = {1: [(t0 + timedelta(minutes=m), Decimal(100 + 2 * m)) for m in range(6)]}
    h = portfolio_history(Decimal("1000"), trades, closes, t0 + timedelta(minutes=5), {1: Decimal("120")})
    assert h[0]["value"] == Decimal("999")  # 1000 - 1000 - 1 + 10*100
    assert h[3]["value"] == Decimal("1000") - 1001 + 439 + 6 * 106  # after the sell at minute 3
    assert h[-1]["value"] == Decimal("1000") - 1001 + 439 + 6 * 120  # live mark
