import importlib.util
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from backend.main import with_day_stats

spec = importlib.util.spec_from_file_location("importer", Path(__file__).resolve().parent.parent / "scripts" / "import_nifty500.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)

D = Decimal


def test_sigma_and_adv_defaults():
    assert importer.daily_sigma([100, 101]) == importer.DEFAULT_SIGMA  # too little history
    steady = [100 * (1.01 if k % 2 else 0.99) for k in range(40)]
    assert D("0.015") < importer.daily_sigma(steady) < D("0.025")
    assert importer.avg_daily_volume(None) == importer.MIN_ADV
    assert importer.avg_daily_volume(5_000_000) == 5_000_000


def test_reads_only_eq_series():
    text = "Company Name,Industry,Symbol,Series,ISIN Code\nA Ltd.,Power,AAA,EQ,X\nB Ltd.,Power,BBB,BE,Y\n"
    assert importer.read_nifty500(text) == [{"symbol": "AAA", "company_name": "A Ltd.", "sector": "Power"}]


def _price(**kw):
    base = dict(market_prev_close=None, market_day_high=None, market_day_low=None, market_volume=None)
    return SimpleNamespace(**{**base, **kw})


def test_day_stats_prefer_real_market_previous_close():
    item = with_day_stats(
        {"adjusted_price": D("110")},
        {"day_open": D("104"), "day_high": D("111"), "day_low": D("103"), "day_volume": D("7")},
        _price(market_prev_close=D("100"), market_day_high=D("112"), market_day_low=D("99"), market_volume=5000),
    )
    assert item["day_change_percentage"] == D("10")
    assert (item["day_high"], item["day_low"]) == (D("112"), D("99"))
    assert (item["day_volume"], item["paper_volume"]) == (5000, 7)


def test_day_stats_fall_back_to_candles_in_simulated_mode():
    item = with_day_stats({"adjusted_price": D("105")}, {"day_open": D("100"), "day_high": D("106"), "day_low": D("99"), "day_volume": D("0")}, _price())
    assert item["day_change_percentage"] == D("5")
    assert item["day_volume"] == 0
