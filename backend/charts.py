"""Pure helpers behind the chart endpoints: candle resampling, day stats and
portfolio value history. No DB access here so they can be unit-tested."""
from bisect import bisect_right
from datetime import datetime, timedelta
from decimal import Decimal
from math import ceil

INTERVALS = (1, 5, 15, 60)  # minutes
IST = timedelta(hours=5, minutes=30)


def ist_day_start_utc(now_utc: datetime) -> datetime:
    """Start of the current IST calendar day, as a naive UTC datetime (candles are stored in UTC)."""
    local = now_utc + IST
    return local.replace(hour=0, minute=0, second=0, microsecond=0) - IST


def resample(candles: list[dict], minutes: int) -> list[dict]:
    """Merge oldest-first 1-minute candles into `minutes`-wide buckets."""
    if minutes == 1:
        return candles
    out: list[dict] = []
    for c in candles:
        t = c["bucket_start"]
        start = t.replace(minute=t.minute - t.minute % minutes) if minutes < 60 else t.replace(minute=0)
        if out and out[-1]["bucket_start"] == start:
            b = out[-1]
            b["high"] = max(b["high"], c["high"])
            b["low"] = min(b["low"], c["low"])
            b["close"] = c["close"]
            b["volume"] += c["volume"]
        else:
            out.append(dict(c, bucket_start=start))
    return out


def portfolio_history(
    starting_cash: Decimal,
    trades: list[dict],
    closes: dict[int, list[tuple[datetime, Decimal]]],
    now: datetime,
    live_prices: dict[int, Decimal],
    max_points: int = 500,
) -> list[dict]:
    """Replay trades over time and mark holdings to the MockFolio price at each step.

    trades: oldest-first dicts with instrument_id, side, quantity, exec_price, brokerage, executed_at.
    closes: per instrument, oldest-first (bucket_start, adjusted close).
    Cash math mirrors backend/trading.py: BUY debits value + brokerage, SELL credits value - brokerage.
    """
    if not trades:
        return []
    start = trades[0]["executed_at"].replace(second=0, microsecond=0)
    total_min = max(1, int((now - start).total_seconds() // 60))
    step = timedelta(minutes=max(1, ceil(total_min / max_points)))
    times = {i: [t for t, _ in rows] for i, rows in closes.items()}

    cash = Decimal(starting_cash)
    qty: dict[int, int] = {}
    last_fill: dict[int, Decimal] = {}
    points, k, t = [], 0, start
    while t <= now:
        edge = t + step
        while k < len(trades) and trades[k]["executed_at"] < edge:
            tr = trades[k]
            value = Decimal(tr["exec_price"]) * tr["quantity"]
            if tr["side"] == "BUY":
                cash -= value + Decimal(tr["brokerage"])
                qty[tr["instrument_id"]] = qty.get(tr["instrument_id"], 0) + tr["quantity"]
            else:
                cash += value - Decimal(tr["brokerage"])
                qty[tr["instrument_id"]] = qty.get(tr["instrument_id"], 0) - tr["quantity"]
            last_fill[tr["instrument_id"]] = Decimal(tr["exec_price"])
            k += 1
        holdings = Decimal(0)
        for iid, q in qty.items():
            if not q:
                continue
            idx = bisect_right(times.get(iid, []), t) - 1
            price = closes[iid][idx][1] if idx >= 0 else last_fill[iid]
            holdings += price * q
        points.append({"time": t, "value": round(cash + holdings, 2)})
        t = edge
    live = cash + sum((live_prices.get(i, last_fill[i]) * q for i, q in qty.items() if q), Decimal(0))
    points.append({"time": now, "value": round(live, 2)})
    return points

