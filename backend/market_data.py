import os
import random
import time
from decimal import Decimal
from typing import Protocol

import httpx

TIMEOUT_SECONDS = 5.0
ANGEL_BASE = "https://apiconnect.angelone.in"
YAHOO_BASE = "https://query1.finance.yahoo.com"


class Quote:
    __slots__ = ("symbol", "price")

    def __init__(self, symbol: str, price: Decimal):
        self.symbol = symbol
        self.price = Decimal(price)


class MarketDataSource(Protocol):
    name: str

    def quotes(self, instruments: list[dict]) -> dict[int, Decimal]:
        ...


class SimulatedSource:
    name = "simulated"

    def __init__(self, seed: int | None = None):
        self._random = random.Random(seed)

    def quotes(self, instruments: list[dict]) -> dict[int, Decimal]:
        out = {}
        for row in instruments:
            sigma = float(row.get("daily_sigma") or 0.015)
            last = Decimal(row["raw_price"])
            step = Decimal(str(self._random.gauss(0.0, sigma / 8)))
            price = last * (Decimal("1") + step)
            out[row["instrument_id"]] = max(price, Decimal("0.05")).quantize(Decimal("0.00001"))
        return out


class AngelOneSource:
    name = "angelone"

    def __init__(self):
        self.api_key = os.getenv("ANGEL_API_KEY")
        self.client_code = os.getenv("ANGEL_CLIENT_CODE")
        self.password = os.getenv("ANGEL_PIN")
        self.totp_secret = os.getenv("ANGEL_TOTP_SECRET")
        if not all([self.api_key, self.client_code, self.password, self.totp_secret]):
            raise RuntimeError("AngelOne source needs ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_PIN and ANGEL_TOTP_SECRET")
        self._jwt = None

    def _headers(self, with_auth: bool = True) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-PrivateKey": self.api_key,
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
        }
        if with_auth and self._jwt:
            headers["Authorization"] = f"Bearer {self._jwt}"
        return headers

    def login(self) -> None:
        import pyotp

        payload = {
            "clientcode": self.client_code,
            "password": self.password,
            "totp": pyotp.TOTP(self.totp_secret).now(),
        }
        response = httpx.post(
            f"{ANGEL_BASE}/rest/auth/angelbroking/user/v1/loginByPassword",
            json=payload,
            headers=self._headers(with_auth=False),
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        body = response.json()
        if not body.get("status"):
            raise RuntimeError(f"AngelOne login failed: {body.get('message')}")
        self._jwt = body["data"]["jwtToken"]

    def quotes(self, instruments: list[dict]) -> dict[int, Decimal]:
        tokens = {str(row["angel_token"]): row["instrument_id"] for row in instruments if row.get("angel_token")}
        if not tokens:
            return {}
        if not self._jwt:
            self.login()
        payload = {"mode": "LTP", "exchangeTokens": {"NSE": list(tokens.keys())}}
        response = httpx.post(
            f"{ANGEL_BASE}/rest/secure/angelbroking/market/v1/quote/",
            json=payload,
            headers=self._headers(),
            timeout=TIMEOUT_SECONDS,
        )
        if response.status_code in (401, 403):
            self.login()
            response = httpx.post(
                f"{ANGEL_BASE}/rest/secure/angelbroking/market/v1/quote/",
                json=payload,
                headers=self._headers(),
                timeout=TIMEOUT_SECONDS,
            )
        response.raise_for_status()
        body = response.json()
        if not body.get("status"):
            raise RuntimeError(f"AngelOne quote failed: {body.get('message')}")
        out = {}
        for row in body["data"]["fetched"]:
            instrument_id = tokens.get(str(row["symbolToken"]))
            if instrument_id is not None:
                out[instrument_id] = Decimal(str(row["ltp"])).quantize(Decimal("0.00001"))
        return out


SPARK_BATCH = 20  # Yahoo rejects more than 20 symbols per spark request


def _num(value):
    return Decimal(str(value)).quantize(Decimal("0.00001")) if value is not None else None


def fetch_quotes(tickers: list[str], client: httpx.Client | None = None, range_: str = "1d") -> dict[str, dict]:
    """Batch real-market quotes from Yahoo's spark endpoint, 20 tickers per request.

    Returns {ticker: {price, prev_close, day_high, day_low, volume, closes}}; tickers Yahoo doesn't know are omitted.
    """
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT_SECONDS, headers={"User-Agent": "Mozilla/5.0"})
    out, errors = {}, []
    try:
        for start in range(0, len(tickers), SPARK_BATCH):
            chunk = tickers[start : start + SPARK_BATCH]
            try:
                response = client.get(
                    f"{YAHOO_BASE}/v7/finance/spark",
                    params={"symbols": ",".join(chunk), "range": range_, "interval": "1d"},
                )
                response.raise_for_status()
                results = response.json()["spark"]["result"] or []
            except Exception as exc:
                errors.append(f"{chunk[0]}..: {exc}")
                continue
            for row in results:
                try:
                    data = row["response"][0]
                    meta = data["meta"]
                    closes = (data.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
                except (KeyError, IndexError, TypeError):
                    continue
                if meta.get("regularMarketPrice") is None:
                    continue
                closes = [c for c in closes if c]
                # chartPreviousClose is the close *before the requested range*: yesterday only when range is 1d.
                prev = meta.get("chartPreviousClose") if range_ == "1d" else (closes[-2] if len(closes) >= 2 else None)
                out[row["symbol"]] = {
                    "price": _num(meta["regularMarketPrice"]),
                    "prev_close": _num(prev or meta.get("previousClose")),
                    "day_high": _num(meta.get("regularMarketDayHigh")),
                    "day_low": _num(meta.get("regularMarketDayLow")),
                    "volume": meta.get("regularMarketVolume"),
                    "closes": closes,
                }
    finally:
        if own:
            client.close()
    if errors and not out:
        raise RuntimeError(f"Yahoo quotes failed for every batch, e.g. {errors[0]}")
    return out


class YahooSource:
    """Unofficial Yahoo Finance spark endpoint. yf_ticker: .NS = NSE, .BO = BSE."""

    name = "yahoo"

    def __init__(self, refresh_s: float | None = None):
        self.refresh_s = float(refresh_s if refresh_s is not None else os.getenv("YAHOO_REFRESH_S", "60"))
        self._last_fetch = float("-inf")
        self._client = httpx.Client(timeout=TIMEOUT_SECONDS, headers={"User-Agent": "Mozilla/5.0"})
        self.last_meta: dict[int, dict] = {}  # real-market day stats from the latest fetch, by instrument_id

    def fetch(self, rows: list[dict]) -> dict[int, dict]:
        """Unthrottled quotes for these instruments, keyed by instrument_id."""
        ids = {row["yf_ticker"]: row["instrument_id"] for row in rows if row.get("yf_ticker")}
        return {ids[t]: q for t, q in fetch_quotes(list(ids), self._client).items() if t in ids}

    def quotes(self, instruments: list[dict]) -> dict[int, Decimal]:
        # Between refreshes return nothing: the tick worker holds the last price.
        now = time.monotonic()
        if now - self._last_fetch < self.refresh_s:
            self.last_meta = {}
            return {}
        self._last_fetch = now
        self.last_meta = self.fetch(instruments)
        return {i: q["price"] for i, q in self.last_meta.items()}


def build_source() -> MarketDataSource:
    name = os.getenv("MARKET_DATA_SOURCE", "simulated").strip().lower()
    if name == "angelone":
        return AngelOneSource()
    if name == "yahoo":
        return YahooSource()
    return SimulatedSource()
