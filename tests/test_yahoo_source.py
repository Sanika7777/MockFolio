from decimal import Decimal

import httpx
import pytest

from backend.market_data import SPARK_BATCH, YahooSource, fetch_quotes


def _spark(symbols, known):
    return {
        "spark": {
            "result": [
                {
                    "symbol": s,
                    "response": [
                        {
                            "meta": {
                                "regularMarketPrice": known[s],
                                "chartPreviousClose": known[s] - 10,
                                "regularMarketDayHigh": known[s] + 5,
                                "regularMarketDayLow": known[s] - 5,
                                "regularMarketVolume": 1000,
                            },
                            "indicators": {"quote": [{"close": [known[s] - 1, None, known[s]]}]},
                        }
                    ],
                }
                for s in symbols
                if s in known
            ],
            "error": None,
        }
    }


def _client(known, calls, fail=False):
    def handler(request):
        symbols = request.url.params["symbols"].split(",")
        calls.append(symbols)
        if fail:
            return httpx.Response(429)
        assert len(symbols) <= SPARK_BATCH
        return httpx.Response(200, json=_spark(symbols, known))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_quotes_batches_and_parses():
    known = {f"S{i}.NS": 100 + i for i in range(45)}
    calls = []
    out = fetch_quotes(list(known) + ["NOPE.NS"], _client(known, calls))
    assert [len(c) for c in calls] == [20, 20, 6]
    assert len(out) == 45 and "NOPE.NS" not in out
    q = out["S0.NS"]
    assert q["price"] == Decimal("100") and q["prev_close"] == Decimal("90") and q["closes"] == [99, 100]


def test_all_batches_failing_raises():
    with pytest.raises(RuntimeError):
        fetch_quotes(["A.NS"], _client({}, [], fail=True))


def test_source_maps_ids_and_throttles():
    src = YahooSource(refresh_s=60)
    src._client = _client({"RELIANCE.NS": 1197.6}, [])
    rows = [
        {"instrument_id": 1, "yf_ticker": "RELIANCE.NS"},
        {"instrument_id": 2, "yf_ticker": "GONE.NS"},
        {"instrument_id": 3, "yf_ticker": None},
    ]
    assert src.quotes(rows) == {1: Decimal("1197.6")}
    assert src.last_meta[1]["prev_close"] == Decimal("1187.6")
    assert src.quotes(rows) == {}  # inside refresh window: hold last prices
