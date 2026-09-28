from datetime import datetime
from decimal import Decimal
from sqlalchemy import JSON, BigInteger, Computed, DateTime, Enum, ForeignKey, Integer, Numeric, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

SIDES = ("BUY", "SELL")
ORDER_TYPES = ("MARKET", "LIMIT", "STOPLOSS")
ORDER_STATUSES = ("PENDING", "FILLED", "PARTIAL", "REJECTED", "CANCELLED")
ROLES = ("USER", "ADMIN")


class Setting(Base):
    __tablename__ = "settings"
    setting_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    setting_value: Mapped[str] = mapped_column(String(255))
    value_type: Mapped[str] = mapped_column(Enum("INT", "DECIMAL", "BOOL", "STRING"), default="DECIMAL")
    description: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class User(Base):
    __tablename__ = "users"
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(256), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    email: Mapped[str] = mapped_column(String(256), unique=True)
    role: Mapped[str] = mapped_column(Enum(*ROLES), default="USER")
    is_active: Mapped[int] = mapped_column(SmallInteger, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    account = relationship("Account", back_populates="user", uselist=False)

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"


class Account(Base):
    __tablename__ = "accounts"
    account_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"), unique=True)
    cash_balance: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    starting_cash: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    blocked_margin: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    realised_pl: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user = relationship("User", back_populates="account")


class Instrument(Base):
    __tablename__ = "instruments"
    instrument_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(256))
    exchange: Mapped[str] = mapped_column(Enum("NSE", "BSE"), default="NSE")
    angel_token: Mapped[str | None] = mapped_column(String(256))
    yf_ticker: Mapped[str | None] = mapped_column(String(256))
    company_name: Mapped[str] = mapped_column(String(256))
    sector: Mapped[str | None] = mapped_column(String(256))
    avg_daily_vol: Mapped[int] = mapped_column(BigInteger)
    daily_sigma: Mapped[Decimal] = mapped_column(Numeric(10, 6))
    tick_size: Mapped[Decimal] = mapped_column(Numeric(10, 4))
    lot_size: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[int] = mapped_column(SmallInteger)
    is_core: Mapped[int] = mapped_column(SmallInteger, default=0)
    kappa_override: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    price = relationship("PriceState", back_populates="instrument", uselist=False)


class PriceState(Base):
    __tablename__ = "price_state"
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.instrument_id", ondelete="CASCADE"), primary_key=True)
    raw_price: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    prev_close: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    perm_offset: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    temp_offset: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    adjusted_price: Mapped[Decimal] = mapped_column(
        Numeric(20, 5),
        Computed("GREATEST(raw_price + perm_offset + temp_offset, 0.0500)", persisted=True),
    )
    last_tick_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_decay_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    touched_at: Mapped[datetime | None] = mapped_column(DateTime)
    market_prev_close: Mapped[Decimal | None] = mapped_column(Numeric(20, 5))
    market_day_high: Mapped[Decimal | None] = mapped_column(Numeric(20, 5))
    market_day_low: Mapped[Decimal | None] = mapped_column(Numeric(20, 5))
    market_volume: Mapped[int | None] = mapped_column(BigInteger)
    instrument = relationship("Instrument", back_populates="price")


class Order(Base):
    __tablename__ = "orders"
    order_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    client_order_id: Mapped[str] = mapped_column(String(36), unique=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.account_id"))
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.instrument_id"))
    side: Mapped[str] = mapped_column(Enum(*SIDES))
    order_type: Mapped[str] = mapped_column(Enum(*ORDER_TYPES), default="MARKET")
    quantity: Mapped[int] = mapped_column(Integer)
    limit_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    trigger_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    target_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    parent_order_id: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(Enum(*ORDER_STATUSES), default="PENDING")
    reject_reason: Mapped[str | None] = mapped_column(String(256))
    retry_count: Mapped[int] = mapped_column(SmallInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Trade(Base):
    __tablename__ = "trades"
    trade_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.order_id"), unique=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.account_id"))
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.instrument_id"))
    side: Mapped[str] = mapped_column(Enum(*SIDES))
    pre_trade_price: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    exec_price: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    quantity: Mapped[int] = mapped_column(Integer)
    brokerage: Mapped[Decimal] = mapped_column(Numeric(20, 5))
    realised_pl: Mapped[Decimal | None] = mapped_column(Numeric(20, 5))
    price_impact: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    deviation_after_trade: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    executed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Holding(Base):
    __tablename__ = "holdings"
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.account_id", ondelete="CASCADE"), primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.instrument_id"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer)
    avg_price: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Candle(Base):
    __tablename__ = "candles_1m"
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.instrument_id", ondelete="CASCADE"), primary_key=True)
    is_adjusted: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    bucket_start: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    open_price: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    high_price: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    low_price: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    close_price: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    volume: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    trade_count: Mapped[int] = mapped_column(Integer)


class Watchlist(Base):
    __tablename__ = "watchlist"
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.account_id", ondelete="CASCADE"), primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.instrument_id", ondelete="CASCADE"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(SmallInteger)
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"
    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    table_name: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(Enum("INSERT", "UPDATE", "DELETE"))
    row_key: Mapped[str] = mapped_column(String(64))
    old_value: Mapped[dict | None] = mapped_column(JSON)
    new_value: Mapped[dict | None] = mapped_column(JSON)
    db_user: Mapped[str] = mapped_column(String(96))
    changed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ConcurrencyRun(Base):
    __tablename__ = "concurrency_runs"
    run_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String(64))
    isolation_level: Mapped[str] = mapped_column(String(32))
    lock_ordering: Mapped[int] = mapped_column(SmallInteger)
    use_for_update: Mapped[int] = mapped_column(SmallInteger)
    threads: Mapped[int] = mapped_column(SmallInteger)
    duration_sec: Mapped[int] = mapped_column(SmallInteger)
    orders_attempted: Mapped[int] = mapped_column(Integer)
    orders_filled: Mapped[int] = mapped_column(Integer)
    deadlocks: Mapped[int] = mapped_column(Integer)
    avg_latency_ms: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    p95_latency_ms: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    run_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
