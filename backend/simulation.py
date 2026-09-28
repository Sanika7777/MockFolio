import logging
import random
import threading
import time
from decimal import Decimal
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from . import settings_store
from . import database
from .locks import lock_price_state
from .market_data import build_source
from .models import Instrument, PriceState
from .price_engine import adjusted, decayed_temp_offset, offset
from .trading import process_pending_orders
from .transactions import run_in_transaction

logger = logging.getLogger("mockfolio.tick")

_crowd = random.Random()
JUMP_REANCHOR = Decimal("0.25")  # a >25% one-tick move means the price source changed, not the market
_worker_started = threading.Lock()
_stop = threading.Event()


def _snapshot() -> list[dict]:
    db = database.SessionLocal()
    try:
        rows = db.execute(
            select(
                Instrument.instrument_id,
                Instrument.angel_token,
                Instrument.yf_ticker,
                Instrument.daily_sigma,
                PriceState.raw_price,
            )
            .join(PriceState, PriceState.instrument_id == Instrument.instrument_id)
            .where(Instrument.is_active == 1)
            .order_by(Instrument.instrument_id)
        ).all()
        return [
            {
                "instrument_id": r.instrument_id,
                "angel_token": r.angel_token,
                "yf_ticker": r.yf_ticker,
                "daily_sigma": r.daily_sigma,
                "raw_price": r.raw_price,
            }
            for r in rows
        ]
    finally:
        db.close()


def _upsert_candle(db: Session, instrument_id: int, is_adjusted: int, bucket, price: Decimal):
    db.execute(
        text(
            "INSERT INTO candles_1m (instrument_id, is_adjusted, bucket_start, open_price, high_price, low_price, close_price) "
            "VALUES (:i, :a, :b, :p, :p, :p, :p) "
            "ON DUPLICATE KEY UPDATE "
            "high_price = GREATEST(high_price, :p), "
            "low_price = LEAST(low_price, :p), "
            "close_price = :p"
        ),
        {"i": instrument_id, "a": is_adjusted, "b": bucket, "p": price},
    )


def _update_one(db: Session, instrument_id: int, new_raw: Decimal | None, tau_seconds: int, crowd: Decimal = Decimal(0)) -> bool:
    now = db.scalar(text("SELECT UTC_TIMESTAMP(3)"))
    state = lock_price_state(db, instrument_id)
    if not state:
        return False
    elapsed = (now - state.last_decay_at).total_seconds()
    # Crowd pressure is a random nudge that the decay keeps pulling back, so the gap to the real price wanders but stays small.
    state.temp_offset = offset(decayed_temp_offset(state.temp_offset, elapsed, tau_seconds) + state.raw_price * crowd)
    state.last_decay_at = now
    if new_raw is not None and state.raw_price and abs(new_raw / state.raw_price - 1) > JUMP_REANCHOR:
        # Old candles were drawn at a different price level; keeping them paints a meaningless cliff.
        db.execute(text("DELETE FROM candles_1m WHERE instrument_id = :i"), {"i": instrument_id})
        state.perm_offset = offset(state.perm_offset * new_raw / state.raw_price)
        state.temp_offset = offset(state.temp_offset * new_raw / state.raw_price)
        logger.warning("re-anchored instrument %s from %s to %s; cleared its candle history", instrument_id, state.raw_price, new_raw)
    if new_raw is not None:
        state.prev_close = state.raw_price
        state.raw_price = new_raw
        state.last_tick_at = now
    bucket = now.replace(second=0, microsecond=0)
    _upsert_candle(db, instrument_id, 0, bucket, state.raw_price)
    _upsert_candle(db, instrument_id, 1, bucket, adjusted(state.raw_price, state.perm_offset, state.temp_offset))
    return True


def _apply(quotes: dict[int, Decimal], instrument_ids: list[int], tau_seconds: int, crowd: dict[int, Decimal] | None = None) -> int:
    updated = 0
    crowd = crowd or {}
    for instrument_id in sorted(instrument_ids):
        try:
            if run_in_transaction(
                lambda db, i=instrument_id: _update_one(db, i, quotes.get(i), tau_seconds, crowd.get(i, Decimal(0)))
            ):
                updated += 1
        except Exception as exc:
            logger.warning("tick failed for instrument %s: %s", instrument_id, exc)
    return updated


def run_decay_tx(*, max_attempts: int = 3) -> int:
    tau = settings_store.get_int("tau_seconds")
    ids = [row["instrument_id"] for row in _snapshot()]
    return _apply({}, ids, tau)


def run_tick_once(source) -> int:
    instruments = _snapshot()
    if not instruments:
        return 0
    try:
        quotes = source.quotes(instruments)
    except Exception as exc:
        logger.warning("market data fetch failed, holding last known prices: %s", exc)
        quotes = {}
    tau = settings_store.get_int("tau_seconds")
    noise = float(settings_store.get_decimal("crowd_noise_pct"))
    # Scaled by each stock's volatility, so jumpy stocks drift further from the real price than steady ones.
    crowd = {
        row["instrument_id"]: Decimal(str(round(_crowd.gauss(0.0, noise * float(row["daily_sigma"] or 0.015) / 0.015), 8)))
        for row in instruments
    }
    updated = _apply(quotes, [row["instrument_id"] for row in instruments], tau, crowd)
    try:
        filled = process_pending_orders()
        if filled:
            logger.info("filled %d pending order(s)", filled)
    except Exception as exc:
        logger.warning("pending order sweep failed: %s", exc)
    return updated


def _loop():
    source = build_source()
    logger.info("tick worker started with source=%s", source.name)
    while not _stop.is_set():
        started = time.monotonic()
        try:
            count = run_tick_once(source)
            logger.info("tick source=%s instruments=%d elapsed_ms=%.1f", source.name, count, (time.monotonic() - started) * 1000)
        except Exception as exc:
            logger.exception("tick cycle failed: %s", exc)
        _stop.wait(max(settings_store.get_int("tick_interval_s"), 1))


def start_worker() -> bool:
    if not _worker_started.acquire(blocking=False):
        return False
    _stop.clear()
    threading.Thread(target=_loop, name="mockfolio-tick", daemon=True).start()
    return True


def stop_worker() -> None:
    _stop.set()
