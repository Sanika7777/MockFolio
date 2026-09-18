from decimal import Decimal, ROUND_HALF_UP
from math import sqrt

IMPACT_STRENGTH = Decimal("0.08")
MAX_TRADE_MOVE = Decimal("0.05")
BROKERAGE_RATE = Decimal("0.001")
DECAY_FACTOR = Decimal("0.03")


def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def calculate_impact(quantity: int, average_daily_volume: int) -> Decimal:
    raw = IMPACT_STRENGTH * Decimal(str(sqrt(quantity / max(average_daily_volume, 1))))
    return min(raw, MAX_TRADE_MOVE)

def moved_price(current: Decimal, quantity: int, volume: int, side: str) -> tuple[Decimal, Decimal]:
    impact = calculate_impact(quantity, volume)
    factor = Decimal("1") + impact if side == "BUY" else Decimal("1") - impact
    return money(current * factor), impact

def decay_price(current: Decimal, reference: Decimal) -> Decimal:
    return money(current + (reference - current) * DECAY_FACTOR)
