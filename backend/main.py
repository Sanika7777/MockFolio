import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from . import settings_store
from .auth import create_access_token, get_user_id, hash_password, verify_password
from . import database
from .database import get_db
from .models import Account, Candle, Instrument, Order, PriceState, Trade, User, Watchlist
from .schemas import LoginRequest, RegisterRequest, SettingUpdate, TokenResponse, TradeRequest, TradeResponse
from .simulation import run_decay_tx, start_worker, stop_worker
from .trading import IdempotencyConflict, TradingError, execute_trade_tx
from .transactions import get_metrics

logger = logging.getLogger("mockfolio.api")

REJECTION_CODES = {
    "INSUFFICIENT_CASH": 422,
    "INSUFFICIENT_SHARES": 422,
    "BAD_QUANTITY": 422,
    "BAD_SIDE": 422,
    "QTY_CAP": 422,
    "UNKNOWN_INSTRUMENT": 404,
    "INACTIVE_INSTRUMENT": 409,
    "NO_ACCOUNT": 404,
    "RETRY_EXHAUSTED": 503,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("checking database connection")
    try:
        database.check_connection()
        database.initialize_database()
    except RuntimeError:
        logger.exception("database startup check failed")
        raise
    settings_store.refresh()
    provision_developer_account()
    if os.getenv("ENABLE_TICK_WORKER", "1").strip().lower() not in ("0", "off", "false"):
        start_worker()
    logger.info("MockFolio API started")
    yield
    stop_worker()
    database.engine.dispose()
    logger.info("MockFolio API stopped")


app = FastAPI(title="MockFolio API", lifespan=lifespan)
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("unhandled error request_id=%s path=%s", request_id, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error", "code": "INTERNAL", "request_id": request_id})
    response.headers["X-Request-ID"] = request_id
    return response


def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    try:
        user_id = get_user_id(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def current_account(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Account:
    account = db.scalar(select(Account).where(Account.user_id == user.user_id))
    if not account:
        raise HTTPException(status_code=404, detail="Trading account not found")
    return account


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def provision_developer_account():
    username = os.getenv("DEV_USERNAME")
    email = os.getenv("DEV_EMAIL")
    password = os.getenv("DEV_PASSWORD")
    if not username or not email or not password:
        return
    db = database.SessionLocal()
    try:
        user = db.scalar(select(User).where((User.username == username) | (User.email == email)))
        if not user:
            db.add(User(username=username, email=email, password_hash=hash_password(password), role="ADMIN"))
        elif user.role != "ADMIN":
            user.role = "ADMIN"
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("developer account provisioning skipped: %s", exc)
    finally:
        db.close()


def trade_json(trade: Trade) -> dict:
    value = trade.exec_price * trade.quantity
    return {
        "order_id": trade.order_id,
        "trade_id": trade.trade_id,
        "side": trade.side,
        "quantity": trade.quantity,
        "exec_price": trade.exec_price,
        "pre_trade_price": trade.pre_trade_price,
        "price_impact": trade.price_impact,
        "deviation_after_trade": trade.deviation_after_trade,
        "brokerage": trade.brokerage,
        "realised_pl": trade.realised_pl,
        "total_value": value + trade.brokerage if trade.side == "BUY" else value - trade.brokerage,
    }


def instrument_json(i: Instrument, p: PriceState) -> dict:
    return {
        "instrument_id": i.instrument_id,
        "symbol": i.symbol,
        "company_name": i.company_name,
        "sector": i.sector,
        "exchange": i.exchange,
        "raw_price": p.raw_price,
        "adjusted_price": p.adjusted_price,
        "prev_close": p.prev_close,
        "perm_offset": p.perm_offset,
        "temp_offset": p.temp_offset,
        "deviation": p.adjusted_price - p.raw_price,
        "deviation_percentage": (p.adjusted_price - p.raw_price) / p.raw_price * 100 if p.raw_price else 0,
        "avg_daily_vol": i.avg_daily_vol,
    }


@app.post("/auth/register", response_model=TokenResponse, status_code=201)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    user = User(username=data.username, email=data.email, password_hash=hash_password(data.password), role="USER")
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username or email already exists") from exc
    return TokenResponse(access_token=create_access_token(user.user_id))


@app.post("/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == data.username))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    return TokenResponse(access_token=create_access_token(user.user_id))


@app.get("/auth/me")
def me(user: User = Depends(current_user), account: Account = Depends(current_account)):
    return {
        "user_id": user.user_id,
        "username": user.username,
        "email": user.email,
        "is_admin": user.is_admin,
        "created_at": user.created_at,
        "account_id": account.account_id,
        "cash_balance": account.cash_balance,
        "realised_pl": account.realised_pl,
        "starting_cash": account.starting_cash,
    }


@app.get("/instruments")
def instruments(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Instrument, PriceState)
        .join(PriceState, PriceState.instrument_id == Instrument.instrument_id)
        .where(Instrument.is_active == 1)
        .order_by(Instrument.symbol)
    ).all()
    return [instrument_json(i, p) for i, p in rows]


@app.get("/instruments/{instrument_id}")
def instrument_detail(instrument_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        select(Instrument, PriceState)
        .join(PriceState, PriceState.instrument_id == Instrument.instrument_id)
        .where(Instrument.instrument_id == instrument_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Instrument not found")
    i, p = row
    return dict(instrument_json(i, p), daily_sigma=i.daily_sigma)


@app.get("/instruments/{instrument_id}/candles")
def candles(
    instrument_id: int,
    is_adjusted: int = Query(1, ge=0, le=1),
    db: Session = Depends(get_db),
    limit: int = Query(200, ge=1, le=1000),
):
    rows = db.scalars(
        select(Candle)
        .where(Candle.instrument_id == instrument_id, Candle.is_adjusted == is_adjusted)
        .order_by(Candle.bucket_start.desc())
        .limit(limit)
    ).all()
    return [
        {
            "bucket_start": c.bucket_start,
            "open": c.open_price,
            "high": c.high_price,
            "low": c.low_price,
            "close": c.close_price,
            "volume": c.volume,
        }
        for c in reversed(rows)
    ]


@app.post("/trades/{side}", response_model=TradeResponse)
def place_trade(side: str, data: TradeRequest, account: Account = Depends(current_account)):
    try:
        trade = execute_trade_tx(account.account_id, data.instrument_id, data.quantity, side.upper(), data.client_order_id)
    except IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TradingError as exc:
        raise HTTPException(status_code=REJECTION_CODES.get(exc.code, 422), detail=str(exc)) from exc
    return trade_json(trade)


@app.get("/portfolio")
def portfolio(account: Account = Depends(current_account), db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT * FROM v_portfolio_summary WHERE account_id = :a ORDER BY symbol"),
        {"a": account.account_id},
    ).mappings().all()
    return [dict(r) for r in rows]


@app.get("/portfolio/summary")
def portfolio_summary(account: Account = Depends(current_account), db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT * FROM v_account_value WHERE account_id = :a"),
        {"a": account.account_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return dict(row)


@app.get("/orders")
def orders(
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    stmt = (
        select(Order, Instrument.symbol)
        .join(Instrument, Instrument.instrument_id == Order.instrument_id)
        .where(Order.account_id == account.account_id)
    )
    if status:
        stmt = stmt.where(Order.status == status.upper())
    rows = db.execute(stmt.order_by(Order.created_at.desc()).limit(limit).offset(offset)).all()
    return [
        {
            "order_id": o.order_id,
            "symbol": symbol,
            "side": o.side,
            "order_type": o.order_type,
            "quantity": o.quantity,
            "limit_price": o.limit_price,
            "status": o.status,
            "reject_reason": o.reject_reason,
            "created_at": o.created_at,
        }
        for o, symbol in rows
    ]


@app.get("/trades")
def trades(
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    rows = db.execute(
        select(Trade, Instrument.symbol)
        .join(Instrument, Instrument.instrument_id == Trade.instrument_id)
        .where(Trade.account_id == account.account_id)
        .order_by(Trade.executed_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [dict(trade_json(t), symbol=symbol, executed_at=t.executed_at) for t, symbol in rows]


@app.get("/watchlist")
def watchlist(account: Account = Depends(current_account), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Instrument, PriceState, Watchlist.sort_order)
        .join(Watchlist, Watchlist.instrument_id == Instrument.instrument_id)
        .join(PriceState, PriceState.instrument_id == Instrument.instrument_id)
        .where(Watchlist.account_id == account.account_id)
        .order_by(Watchlist.sort_order)
    ).all()
    return [dict(instrument_json(i, p), sort_order=sort_order) for i, p, sort_order in rows]


@app.post("/watchlist/{instrument_id}", status_code=201)
def watchlist_add(instrument_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)):
    if not db.get(Instrument, instrument_id):
        raise HTTPException(status_code=404, detail="Instrument not found")
    db.execute(
        text(
            "INSERT INTO watchlist (account_id, instrument_id, sort_order) VALUES (:a, :i, :i) "
            "ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)"
        ),
        {"a": account.account_id, "i": instrument_id},
    )
    db.commit()
    return {"ok": True}


@app.delete("/watchlist/{instrument_id}", status_code=204)
def watchlist_remove(instrument_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)):
    db.execute(
        text("DELETE FROM watchlist WHERE account_id = :a AND instrument_id = :i"),
        {"a": account.account_id, "i": instrument_id},
    )
    db.commit()


@app.get("/admin/settings")
def admin_settings(user: User = Depends(require_admin)):
    return settings_store.all_settings()


@app.put("/admin/settings/{key}")
def admin_settings_update(key: str, data: SettingUpdate, user: User = Depends(require_admin)):
    try:
        settings_store.update(key, data.value)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown setting {key}") from exc
    return settings_store.all_settings()


@app.get("/admin/users")
def admin_users(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    rows = db.execute(
        text("SELECT * FROM v_account_value ORDER BY username LIMIT :l OFFSET :o"),
        {"l": limit, "o": offset},
    ).mappings().all()
    return [dict(r) for r in rows]


@app.get("/admin/summary")
def admin_summary(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    row = db.execute(
        text(
            "SELECT (SELECT COUNT(*) FROM users) AS users, "
            "(SELECT COUNT(*) FROM orders) AS orders, "
            "(SELECT COUNT(*) FROM trades) AS trades, "
            "(SELECT COALESCE(SUM(cash_balance), 0) FROM accounts) AS total_cash, "
            "(SELECT COALESCE(SUM(realised_pl), 0) FROM accounts) AS total_realised_pl, "
            "(SELECT COUNT(*) FROM instruments WHERE is_active = 1) AS instruments"
        )
    ).mappings().first()
    return dict(row)


@app.get("/admin/users/{account_id}")
def admin_user_detail(account_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT * FROM v_account_value WHERE account_id = :a"), {"a": account_id}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    holdings = db.execute(
        text("SELECT * FROM v_portfolio_summary WHERE account_id = :a ORDER BY symbol"), {"a": account_id}
    ).mappings().all()
    return dict(row, holdings=[dict(h) for h in holdings])


@app.get("/admin/users/{account_id}/trades")
def admin_user_trades(
    account_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    rows = db.execute(
        select(Trade, Instrument.symbol)
        .join(Instrument, Instrument.instrument_id == Trade.instrument_id)
        .where(Trade.account_id == account_id)
        .order_by(Trade.executed_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [dict(trade_json(t), symbol=symbol, executed_at=t.executed_at) for t, symbol in rows]


@app.get("/admin/users/{account_id}/orders")
def admin_user_orders(
    account_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    rows = db.execute(
        select(Order, Instrument.symbol)
        .join(Instrument, Instrument.instrument_id == Order.instrument_id)
        .where(Order.account_id == account_id)
        .order_by(Order.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [
        {
            "order_id": o.order_id,
            "symbol": symbol,
            "side": o.side,
            "order_type": o.order_type,
            "quantity": o.quantity,
            "limit_price": o.limit_price,
            "status": o.status,
            "reject_reason": o.reject_reason,
            "created_at": o.created_at,
        }
        for o, symbol in rows
    ]


@app.get("/admin/tx-metrics")
def admin_tx_metrics(user: User = Depends(require_admin)):
    return get_metrics()


@app.post("/admin/reset-market")
def admin_reset_market(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.execute(text("CALL sp_reset_market()"))
    db.commit()
    return {"ok": True}


@app.post("/admin/reset-account/{account_id}")
def admin_reset_account(account_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if not db.get(Account, account_id):
        raise HTTPException(status_code=404, detail="Account not found")
    db.execute(text("CALL sp_reset_account(:a)"), {"a": account_id})
    db.commit()
    return {"ok": True}


@app.post("/simulation/decay")
def simulation_decay(user: User = Depends(require_admin)):
    return {"instruments": run_decay_tx()}


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "frontend", html=True), name="frontend")
