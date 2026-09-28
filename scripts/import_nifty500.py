#!/usr/bin/env python
"""Add the NIFTY 500 to MockFolio's tradable universe.

Downloads NSE's official NIFTY 500 list (symbol + industry), prices every stock
from Yahoo in batches of 20, and inserts the ones MockFolio doesn't have yet.
Existing stocks keep their prices and history; only their sector is updated to
NSE's industry so the screener's filter chips use one taxonomy. Safe to re-run.

    DATABASE_URL=mysql+pymysql://root:PASS@HOST:PORT/railway python scripts/import_nifty500.py
    python scripts/import_nifty500.py --dry-run
"""
import argparse
import csv
import io
import math
import statistics
import sys
from decimal import Decimal
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

NIFTY500_CSV = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
DEFAULT_SIGMA = Decimal("0.02")
MIN_ADV = 10_000


def daily_sigma(closes: list[float]) -> Decimal:
    """Standard deviation of daily log returns; a middle-of-the-road default when history is short."""
    closes = [c for c in closes if c and c > 0]
    if len(closes) < 20:
        return DEFAULT_SIGMA
    returns = [math.log(b / a) for a, b in zip(closes, closes[1:])]
    return Decimal(str(round(min(max(statistics.stdev(returns), 0.003), 0.08), 6)))


def avg_daily_volume(volume) -> int:
    # ponytail: today's volume stands in for average daily volume; fetch a volume history if impact looks off
    return max(int(volume or 0), MIN_ADV)


def read_nifty500(text: str) -> list[dict]:
    rows = csv.DictReader(io.StringIO(text))
    return [
        {"symbol": r["Symbol"].strip(), "company_name": r["Company Name"].strip(), "sector": r["Industry"].strip()}
        for r in rows
        if r.get("Series", "EQ").strip() == "EQ"
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="download and price, but write nothing")
    args = parser.parse_args()

    from sqlalchemy import text

    from backend.database import engine
    from backend.market_data import fetch_quotes

    csv_text = httpx.get(NIFTY500_CSV, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text
    listed = read_nifty500(csv_text)
    print(f"NIFTY 500 list: {len(listed)} stocks")

    with engine.connect() as conn:
        existing = {r.yf_ticker: r.instrument_id for r in conn.execute(text("SELECT instrument_id, yf_ticker FROM instruments"))}
    new = [s for s in listed if f"{s['symbol']}.NS" not in existing]
    print(f"already in MockFolio: {len(listed) - len(new)} · new: {len(new)}")

    try:
        quotes = fetch_quotes([f"{s['symbol']}.NS" for s in new], range_="3mo") if new else {}
    except RuntimeError as exc:  # every batch failed: e.g. only unlisted placeholders are left on a re-run
        print(f"Yahoo returned nothing for the new stocks ({exc})")
        quotes = {}
    priced = [s for s in new if f"{s['symbol']}.NS" in quotes]
    missing = [s["symbol"] for s in new if f"{s['symbol']}.NS" not in quotes]
    print(f"priced by Yahoo: {len(priced)} · no quote (skipped): {len(missing)} {missing[:10]}")
    if args.dry_run:
        return 0

    with engine.begin() as conn:
        for s in listed:  # one sector taxonomy for every stock, old and new
            conn.execute(text("UPDATE instruments SET sector = :sec WHERE yf_ticker = :t"), {"sec": s["sector"], "t": f"{s['symbol']}.NS"})
        for s in priced:
            q = quotes[f"{s['symbol']}.NS"]
            result = conn.execute(
                text(
                    "INSERT INTO instruments (symbol, exchange, yf_ticker, company_name, sector, avg_daily_vol, daily_sigma, is_core) "
                    "VALUES (:sym, 'NSE', :t, :name, :sec, :adv, :sigma, 0)"
                ),
                {
                    "sym": s["symbol"],
                    "t": f"{s['symbol']}.NS",
                    "name": s["company_name"],
                    "sec": s["sector"],
                    "adv": avg_daily_volume(q["volume"]),
                    "sigma": daily_sigma(q["closes"]),
                },
            )
            conn.execute(
                text(
                    "INSERT INTO price_state (instrument_id, raw_price, prev_close, last_tick_at, last_decay_at, "
                    "market_prev_close, market_day_high, market_day_low, market_volume) "
                    "VALUES (:i, :p, :p, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), :pc, :hi, :lo, :vol)"
                ),
                {"i": result.lastrowid, "p": q["price"], "pc": q["prev_close"], "hi": q["day_high"], "lo": q["day_low"], "vol": q["volume"]},
            )
        total = conn.execute(text("SELECT COUNT(*) FROM instruments WHERE is_active = 1")).scalar()
    print(f"inserted {len(priced)} · MockFolio now lists {total} stocks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
