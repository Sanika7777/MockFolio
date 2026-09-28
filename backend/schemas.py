from decimal import Decimal
from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    username: str
    password: str


class TradeRequest(BaseModel):
    instrument_id: int
    quantity: int = Field(gt=0)
    client_order_id: str | None = Field(default=None, max_length=36)
    stop_loss: Decimal | None = Field(default=None, gt=0)
    target_price: Decimal | None = Field(default=None, gt=0)


class OrderRequest(BaseModel):
    instrument_id: int
    side: str = Field(pattern="^(BUY|SELL)$")
    order_type: str = Field(pattern="^(LIMIT|STOPLOSS)$")
    quantity: int = Field(gt=0)
    limit_price: Decimal | None = Field(default=None, gt=0)
    trigger_price: Decimal | None = Field(default=None, gt=0)
    stop_loss: Decimal | None = Field(default=None, gt=0)
    target_price: Decimal | None = Field(default=None, gt=0)
    client_order_id: str | None = Field(default=None, max_length=36)


class SettingUpdate(BaseModel):
    value: str = Field(min_length=1, max_length=255)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TradeResponse(BaseModel):
    order_id: int
    trade_id: int
    side: str
    quantity: int
    exec_price: Decimal
    pre_trade_price: Decimal
    price_impact: Decimal
    deviation_after_trade: Decimal
    brokerage: Decimal
    realised_pl: Decimal | None
    total_value: Decimal
