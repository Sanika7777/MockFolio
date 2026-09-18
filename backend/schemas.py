from decimal import Decimal
from pydantic import BaseModel, Field

class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: str
    password: str = Field(min_length=6)

class LoginRequest(BaseModel):
    username: str
    password: str

class TradeRequest(BaseModel):
    stock_id: int
    quantity: int = Field(gt=0)
    client_order_key: str | None = Field(default=None, max_length=80)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TradeResponse(BaseModel):
    order_id: int
    trade_id: int
    side: str
    quantity: int
    fill_price: Decimal
    total_cost: Decimal
    brokerage: Decimal
    price_before: Decimal
    price_after: Decimal
    price_impact: Decimal
    deviation_after_trade: Decimal
