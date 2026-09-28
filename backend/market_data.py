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


class YahooSource:
    """Unofficial Yahoo Finance chart endpoint. yf_ticker: .NS = NSE, .BO = BSE."""

    name = "yahoo"

    def __init__(self, refresh_s: float | None = None):
        self.refresh_s = float(refresh_s if refresh_s is not None else os.getenv("YAHOO_REFRESH_S", "60"))
        self._last_fetch = float("-inf")
        self._client = httpx.Client(timeout=TIMEOUT_SECONDS, headers={"User-Agent": "Mozilla/5.0"})

    def _price(self, ticker: str) -> Decimal:
        response = self._client.get(
            f"{YAHOO_BASE}/v8/finance/chart/{ticker}", params={"interval": "1m", "range": "1d"}
        )
        response.raise_for_status()
        price = response.json()["chart"]["result"][0]["meta"]["regularMarketPrice"]
        return Decimal(str(price)).quantize(Decimal("0.00001"))

    def quotes(self, instruments: list[dict]) -> dict[int, Decimal]:
        # Between refreshes return nothing: the tick worker holds the last price.
        now = time.monotonic()
        if now - self._last_fetch < self.refresh_s:
            return {}
        self._last_fetch = now
        out, errors = {}, []
        # ponytail: 30 sequential requests per refresh; batch/parallelize if instruments grow a lot
        for row in instruments:
            ticker = row.get("yf_ticker")
            if not ticker:
                continue
            try:
                out[row["instrument_id"]] = self._price(ticker)
            except Exception as exc:
                errors.append(f"{ticker}: {exc}")
        if errors and not out:
            raise RuntimeError(f"Yahoo quotes failed for all tickers, e.g. {errors[0]}")
        return out


def build_source() -> MarketDataSource:
    name = os.getenv("MARKET_DATA_SOURCE", "simulated").strip().lower()
    if name == "angelone":
        return AngelOneSource()
    if name == "yahoo":
        return YahooSource()
    return SimulatedSource()
