from decimal import Decimal

from backend.price_engine import (
    MIN_PRICE,
    adjusted,
    decayed_temp_offset,
    impact_fraction,
    split_impact,
    trade_price_move,
)

KAPPA = Decimal("120")
ADV = 9_000_000
SIGMA = Decimal("0.014")
CAP = Decimal("0.05")


def test_impact_is_capped():
    assert impact_fraction(10_000_000, 1, SIGMA, KAPPA, CAP) == CAP


def test_zero_quantity_has_no_impact():
    assert impact_fraction(0, ADV, SIGMA, KAPPA, CAP) == Decimal("0")


def test_doubling_quantity_less_than_doubles_impact():
    small = impact_fraction(100, ADV, SIGMA, KAPPA, CAP)
    large = impact_fraction(200, ADV, SIGMA, KAPPA, CAP)
    assert small < large < small * 2


def test_buy_moves_up_and_sell_moves_down():
    up, _ = trade_price_move(Decimal("1000"), 100, ADV, SIGMA, "BUY", KAPPA, CAP)
    down, _ = trade_price_move(Decimal("1000"), 100, ADV, SIGMA, "SELL", KAPPA, CAP)
    assert up > 0 > down
    assert up == -down


def test_impact_splits_into_permanent_and_temporary():
    permanent, temporary = split_impact(Decimal("10"), Decimal("0.30"))
    assert permanent + temporary == Decimal("10")
    assert permanent == Decimal("3.000000")


def test_temporary_offset_decays_toward_zero_and_permanent_does_not():
    start = Decimal("7.000000")
    after_one_tau = decayed_temp_offset(start, 300, 300)
    after_ten_tau = decayed_temp_offset(start, 3000, 300)
    assert after_ten_tau < after_one_tau < start
    assert after_ten_tau >= 0


def test_no_elapsed_time_means_no_decay():
    assert decayed_temp_offset(Decimal("5.000000"), 0, 300) == Decimal("5.000000")


def test_adjusted_price_never_falls_below_floor():
    assert adjusted(Decimal("10"), Decimal("-500"), Decimal("-500")) == MIN_PRICE


def test_adjusted_price_is_raw_plus_offsets():
    assert adjusted(Decimal("1000"), Decimal("3"), Decimal("7")) == Decimal("1010.00000")
