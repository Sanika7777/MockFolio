import logging
import threading
import time
from decimal import Decimal
from sqlalchemy import select, text
from . import database
from .models import Setting

logger = logging.getLogger("mockfolio.settings")

DEFAULTS = {
    "kappa": "120",
    "tau_seconds": "300",
    "perm_fraction": "0.30",
    "brokerage_pct": "0.0003",
    "starting_cash": "500000",
    "tick_interval_s": "3",
    "max_order_qty": "100000",
    "max_impact_pct": "0.05",
}

CACHE_TTL_SECONDS = 15

_lock = threading.Lock()
_cache: dict[str, str] = {}
_loaded_at = 0.0


def _load() -> dict[str, str]:
    db = database.SessionLocal()
    try:
        rows = db.scalars(select(Setting)).all()
        return {row.setting_key: row.setting_value for row in rows}
    finally:
        db.close()


def refresh() -> dict[str, str]:
    global _cache, _loaded_at
    values = dict(DEFAULTS)
    try:
        values.update(_load())
    except Exception as exc:
        logger.warning("settings table unreadable, using defaults: %s", exc)
    with _lock:
        _cache = values
        _loaded_at = time.monotonic()
    return values


def all_settings() -> dict[str, str]:
    with _lock:
        fresh = _cache and (time.monotonic() - _loaded_at) < CACHE_TTL_SECONDS
        snapshot = dict(_cache)
    return snapshot if fresh else refresh()


def get_decimal(key: str) -> Decimal:
    return Decimal(all_settings().get(key, DEFAULTS[key]))


def get_int(key: str) -> int:
    return int(Decimal(all_settings().get(key, DEFAULTS[key])))


def update(key: str, value: str) -> None:
    if key not in DEFAULTS:
        raise KeyError(key)
    db = database.SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO settings (setting_key, setting_value) VALUES (:k, :v) "
                "ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)"
            ),
            {"k": key, "v": value},
        )
        db.commit()
    finally:
        db.close()
    refresh()
