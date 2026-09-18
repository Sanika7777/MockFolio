from contextlib import asynccontextmanager
from decimal import Decimal
import os
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from .auth import create_access_token, get_user_id, hash_password, verify_password
from .database import Base, SessionLocal, engine, get_db
from .models import Account, Holding, Order, PriceHistory, Stock, Trade, User, Watchlist
from .price_engine import decay_price
from .schemas import LoginRequest, RegisterRequest, TokenResponse, TradeRequest, TradeResponse
from .trading import TradingError, execute_trade

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    provision_developer_account()
    yield

app = FastAPI(title="MockFolio API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")

def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)):
    try:
        user_id = get_user_id(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def require_admin(user: User = Depends(current_user)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

def provision_developer_account():
    username = os.getenv("DEV_USERNAME")
    email = os.getenv("DEV_EMAIL")
    password = os.getenv("DEV_PASSWORD")
    if not username or not email or not password:
        return
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where((User.username == username) | (User.email == email)))
        if not user:
            user = User(username=username, email=email, password_hash=hash_password(password), is_admin=True)
            user.account = Account(cash_balance=Decimal("100000.00"), starting_balance=Decimal("100000.00"))
            db.add(user)
        elif not user.is_admin:
            user.is_admin = True
        db.commit()
    finally:
        db.close()

def trade_json(trade: Trade):
    transaction_value = trade.fill_price * trade.quantity
    total_cost = transaction_value + trade.brokerage if trade.side == "BUY" else transaction_value - trade.brokerage
    return {"order_id": trade.order_id, "trade_id": trade.id, "side": trade.side, "quantity": trade.quantity, "fill_price": trade.fill_price, "total_cost": total_cost, "brokerage": trade.brokerage, "price_before": trade.price_before, "price_after": trade.price_after, "price_impact": trade.price_impact, "deviation_after_trade": trade.deviation_after_trade}

@app.post("/auth/register", response_model=TokenResponse, status_code=201)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    if db.scalar(select(User).where((User.username == data.username) | (User.email == data.email))):
        raise HTTPException(409, "Username or email already exists")
    user = User(username=data.username, email=data.email, password_hash=hash_password(data.password))
    user.account = Account(cash_balance=Decimal("100000.00"), starting_balance=Decimal("100000.00"))
    db.add(user); db.commit(); db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id))

@app.post("/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == data.username))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    return TokenResponse(access_token=create_access_token(user.id))

@app.get("/auth/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    account = db.scalar(select(Account).where(Account.user_id == user.id))
    return {"id": user.id, "username": user.username, "email": user.email, "is_admin": user.is_admin, "created_at": user.created_at, "cash_balance": account.cash_balance}

@app.get("/stocks")
def stocks(db: Session = Depends(get_db)):
    rows = db.scalars(select(Stock).where(Stock.is_active).order_by(Stock.symbol)).all()
    return [{"id": s.id, "symbol": s.symbol, "company_name": s.company_name, "sector": s.sector, "reference_price": s.reference_price, "simulated_price": s.simulated_price, "deviation": s.simulated_price - s.reference_price, "deviation_percentage": (s.simulated_price - s.reference_price) / s.reference_price * 100} for s in rows]

@app.get("/stocks/{stock_id}")
def stock_detail(stock_id: int, db: Session = Depends(get_db)):
    s = db.get(Stock, stock_id)
    if not s: raise HTTPException(404, "Stock not found")
    return {"id": s.id, "symbol": s.symbol, "company_name": s.company_name, "sector": s.sector, "reference_price": s.reference_price, "simulated_price": s.simulated_price, "deviation": s.simulated_price - s.reference_price, "deviation_percentage": (s.simulated_price - s.reference_price) / s.reference_price * 100}

@app.get("/stocks/{stock_id}/history")
def history(stock_id: int, db: Session = Depends(get_db)):
    rows = db.scalars(select(PriceHistory).where(PriceHistory.stock_id == stock_id).order_by(PriceHistory.recorded_at.desc()).limit(100)).all()
    return [{"reference_price": row.reference_price, "simulated_price": row.simulated_price, "deviation": row.deviation, "deviation_percentage": row.deviation_percentage, "recorded_at": row.recorded_at} for row in rows]

@app.post("/trades/{side}", response_model=TradeResponse)
def trade(side: str, data: TradeRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.is_admin:
        raise HTTPException(status_code=403, detail="Developer accounts cannot place trades.")
    try:
        result = execute_trade(db, user.id, data.stock_id, data.quantity, side.upper(), data.client_order_key)
        return trade_json(result)
    except TradingError as exc:
        db.rollback(); raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        db.rollback(); raise HTTPException(500, "Trade could not be completed") from exc

@app.get("/portfolio")
def portfolio(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Holding, Stock).join(Stock, Holding.stock_id == Stock.id).where(Holding.user_id == user.id)).all()
    return [{"symbol": s.symbol, "stock_id": s.id, "quantity": h.quantity, "average_buy_price": h.average_buy_price, "simulated_price": s.simulated_price, "invested_value": h.average_buy_price * h.quantity, "current_value": s.simulated_price * h.quantity, "profit_loss": (s.simulated_price - h.average_buy_price) * h.quantity} for h, s in rows]

@app.get("/portfolio/summary")
def portfolio_summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    account = db.scalar(select(Account).where(Account.user_id == user.id)); items = portfolio(user, db)
    holdings_value = sum((x["current_value"] for x in items), Decimal("0")); invested = sum((x["invested_value"] for x in items), Decimal("0"))
    return {"cash_balance": account.cash_balance, "holdings_value": holdings_value, "total_account_value": account.cash_balance + holdings_value, "total_pnl": holdings_value - invested}

@app.get("/orders")
def orders(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Order, Stock).join(Stock, Order.stock_id == Stock.id).where(Order.user_id == user.id).order_by(Order.created_at.desc())).all()
    return [{"id": order.id, "symbol": stock.symbol, "order_type": order.order_type, "quantity": order.quantity, "requested_price": order.requested_price, "status": order.status, "created_at": order.created_at} for order, stock in rows]

@app.get("/trades")
def trades(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Trade, Stock).join(Stock, Trade.stock_id == Stock.id).where(Trade.user_id == user.id).order_by(Trade.created_at.desc())).all()
    return [{"id": trade.id, "symbol": stock.symbol, "side": trade.side, "quantity": trade.quantity, "fill_price": trade.fill_price, "brokerage": trade.brokerage, "price_impact": trade.price_impact, "created_at": trade.created_at} for trade, stock in rows]

@app.post("/watchlist/{stock_id}")
def add_watch(stock_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.get(Stock, stock_id): raise HTTPException(404, "Stock not found")
    if not db.scalar(select(Watchlist).where(Watchlist.user_id == user.id, Watchlist.stock_id == stock_id)):
        db.add(Watchlist(user_id=user.id, stock_id=stock_id)); db.commit()
    return {"ok": True}

@app.delete("/watchlist/{stock_id}")
def remove_watch(stock_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Watchlist).where(Watchlist.user_id == user.id, Watchlist.stock_id == stock_id))
    if row: db.delete(row); db.commit()
    return {"ok": True}

@app.get("/watchlist")
def watchlist(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Stock).join(Watchlist, Watchlist.stock_id == Stock.id).where(Watchlist.user_id == user.id).order_by(Stock.symbol)).all()
    return [{"id": s.id, "symbol": s.symbol, "company_name": s.company_name, "reference_price": s.reference_price, "simulated_price": s.simulated_price, "deviation": s.simulated_price - s.reference_price, "deviation_percentage": (s.simulated_price - s.reference_price) / s.reference_price * 100} for s in rows]

@app.post("/admin/reset-market")
def reset_market(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.execute(text("CALL reset_market()")); db.commit(); return {"ok": True}

@app.post("/admin/reset-user/{user_id}")
def reset_user(user_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.execute(text("CALL reset_user_account(:user_id)"), {"user_id": user_id}); db.commit(); return {"ok": True}

def admin_user_summary(db: Session, user: User):
    account = db.scalar(select(Account).where(Account.user_id == user.id))
    holdings = db.execute(select(Holding, Stock).join(Stock, Holding.stock_id == Stock.id).where(Holding.user_id == user.id)).all()
    holdings_value = sum((stock.simulated_price * holding.quantity for holding, stock in holdings), Decimal("0"))
    invested = sum((holding.average_buy_price * holding.quantity for holding, _ in holdings), Decimal("0"))
    trade_count = db.scalar(select(func.count(Trade.id)).where(Trade.user_id == user.id)) or 0
    return {"cash_balance": account.cash_balance if account else Decimal("0"), "portfolio_value": holdings_value, "total_account_value": (account.cash_balance if account else Decimal("0")) + holdings_value, "total_pnl": holdings_value - invested, "trade_count": trade_count}

def admin_holding_json(holding: Holding, stock: Stock):
    return {"stock_id": stock.id, "symbol": stock.symbol, "company_name": stock.company_name, "quantity": holding.quantity, "average_buy_price": holding.average_buy_price, "simulated_price": stock.simulated_price, "profit_loss": (stock.simulated_price - holding.average_buy_price) * holding.quantity}

def admin_trade_json(trade: Trade, stock: Stock):
    return {"id": trade.id, "symbol": stock.symbol, "side": trade.side, "quantity": trade.quantity, "fill_price": trade.fill_price, "brokerage": trade.brokerage, "price_impact": trade.price_impact, "price_before": trade.price_before, "price_after": trade.price_after, "created_at": trade.created_at}

@app.get("/admin/users")
def admin_users(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.scalars(select(User).order_by(User.created_at.desc())).all()
    return [{"id": item.id, "username": item.username, "email": item.email, "is_admin": item.is_admin, "created_at": item.created_at, **admin_user_summary(db, item)} for item in users]

@app.get("/admin/summary")
def admin_summary(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return {"total_users": db.scalar(select(func.count(User.id))) or 0, "total_trades": db.scalar(select(func.count(Trade.id))) or 0, "total_orders": db.scalar(select(func.count(Order.id))) or 0, "active_stocks": db.scalar(select(func.count(Stock.id)).where(Stock.is_active)) or 0}

@app.get("/admin/users/{user_id}")
def admin_user(user_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    account = db.scalar(select(Account).where(Account.user_id == target.id))
    holdings = db.execute(select(Holding, Stock).join(Stock, Holding.stock_id == Stock.id).where(Holding.user_id == target.id).order_by(Stock.symbol)).all()
    return {"user": {"id": target.id, "username": target.username, "email": target.email, "is_admin": target.is_admin, "created_at": target.created_at}, "account": admin_user_summary(db, target), "holdings": [admin_holding_json(holding, stock) for holding, stock in holdings]}

@app.get("/admin/users/{user_id}/trades")
def admin_user_trades(user_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    rows = db.execute(select(Trade, Stock).join(Stock, Trade.stock_id == Stock.id).where(Trade.user_id == user_id).order_by(Trade.created_at.desc())).all()
    return [admin_trade_json(trade, stock) for trade, stock in rows]

@app.get("/admin/users/{user_id}/orders")
def admin_user_orders(user_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    rows = db.execute(select(Order, Stock).join(Stock, Order.stock_id == Stock.id).where(Order.user_id == user_id).order_by(Order.created_at.desc())).all()
    return [{"id": order.id, "symbol": stock.symbol, "order_type": order.order_type, "quantity": order.quantity, "requested_price": order.requested_price, "status": order.status, "created_at": order.created_at} for order, stock in rows]

@app.post("/simulation/decay")
def decay(user: User = Depends(current_user), db: Session = Depends(get_db)):
    for stock in db.scalars(select(Stock).with_for_update()).all():
        stock.previous_simulated_price = stock.simulated_price; stock.simulated_price = decay_price(stock.simulated_price, stock.reference_price)
        db.add(PriceHistory(stock_id=stock.id, reference_price=stock.reference_price, simulated_price=stock.simulated_price, deviation=stock.simulated_price-stock.reference_price, deviation_percentage=(stock.simulated_price-stock.reference_price)/stock.reference_price*100))
    db.commit(); return {"ok": True}

@app.get("/")
def frontend():
    return FileResponse(Path(__file__).parent.parent / "frontend" / "index.html")
