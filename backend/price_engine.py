from decimal import Decimal, ROUND_HALF_UP
from math import exp, sqrt

MIN_PRICE = Decimal("0.05")


def money(value) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def offset(value) -> Decimal:
    return Decimal(value).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def impact_fraction(quantity: int, avg_daily_vol: int, daily_sigma: Decimal, kappa: Decimal, cap: Decimal) -> Decimal:
    if quantity <= 0 or avg_daily_vol <= 0:
        return Decimal("0")
    participation = Decimal(str(sqrt(quantity / avg_daily_vol)))
    raw = kappa * Decimal(daily_sigma) * participation
    return min(raw, cap)


def split_impact(price_move: Decimal, perm_fraction: Decimal) -> tuple[Decimal, Decimal]:
    permanent = offset(price_move * perm_fraction)
    return permanent, offset(price_move - permanent)


def decayed_temp_offset(temp_offset: Decimal, elapsed_seconds: float, tau_seconds: int) -> Decimal:
    if tau_seconds <= 0 or elapsed_seconds <= 0:
        return offset(temp_offset)
    return offset(Decimal(temp_offset) * Decimal(str(exp(-elapsed_seconds / tau_seconds))))


def adjusted(raw_price: Decimal, perm_offset: Decimal, temp_offset: Decimal) -> Decimal:
    total = Decimal(raw_price) + Decimal(perm_offset) + Decimal(temp_offset)
    return max(total.quantize(Decimal("0.00001"), rounding=ROUND_HALF_UP), MIN_PRICE)


def trade_price_move(pre_price: Decimal, quantity: int, avg_daily_vol: int, daily_sigma: Decimal, side: str, kappa: Decimal, cap: Decimal) -> tuple[Decimal, Decimal]:
    fraction = impact_fraction(quantity, avg_daily_vol, daily_sigma, kappa, cap)
    magnitude = Decimal(pre_price) * fraction
    move = magnitude if side == "BUY" else -magnitude
    return offset(move), fraction
