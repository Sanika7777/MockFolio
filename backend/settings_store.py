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
    "crowd_noise_pct": "0.0012",
}

# What users see on the Settings page. Bounds keep an admin typo from breaking the market.
META = {
    "kappa": ("Price impact strength", "How far a trade pushes the MockFolio price. Higher means every order moves the price more.", 0, 1000),
    "tau_seconds": ("Recovery time (seconds)", "How quickly the temporary part of a price move fades back toward the real price.", 10, 86400),
    "perm_fraction": ("Permanent share of impact", "Fraction of each trade's price move that never fades (0 to 1).", 0, 1),
    "brokerage_pct": ("Brokerage", "Fee charged on every trade, as a fraction of trade value (0.0003 = 0.03%).", 0, 0.05),
    "starting_cash": ("Starting cash (₹)", "Virtual money credited to each new account.", 1000, 100000000),
    "tick_interval_s": ("Tick interval (seconds)", "How often prices update and pending orders are checked.", 1, 60),
    "max_order_qty": ("Max shares per order", "Largest quantity a single order may request.", 1, 10000000),
    "max_impact_pct": ("Max price move per order", "Cap on how far one order can move the price (0.05 = 5%).", 0, 0.5),
    "crowd_noise_pct": ("Crowd noise", "Random buying/selling pressure from the simulated crowd, scaled by each stock's volatility. Creates the gap from the real price.", 0, 0.02),
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
    low, high = META[key][2], META[key][3]
    try:
        number = Decimal(value)
    except Exception as exc:
        raise ValueError(f"{key} must be a number") from exc
    if not number.is_finite() or not low <= number <= high:
        raise ValueError(f"{key} must be between {low} and {high}")
    if key in ("tau_seconds", "tick_interval_s", "max_order_qty") and number != number.to_integral_value():
        raise ValueError(f"{key} must be a whole number")
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
