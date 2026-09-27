import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set to a MySQL connection URL")
if DATABASE_URL.startswith("mysql://"):
    DATABASE_URL = "mysql+pymysql://" + DATABASE_URL[len("mysql://"):]

try:
    LOCK_WAIT_TIMEOUT = int(os.getenv("LOCK_WAIT_TIMEOUT", "5"))
except ValueError as exc:
    raise RuntimeError(f"LOCK_WAIT_TIMEOUT must be an integer, got {os.getenv('LOCK_WAIT_TIMEOUT')!r}") from exc

ALLOWED_ISOLATION_LEVELS = {"READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"}
TX_ISOLATION = os.getenv("TX_ISOLATION", "REPEATABLE READ").strip().upper()
if TX_ISOLATION not in ALLOWED_ISOLATION_LEVELS:
    raise RuntimeError(f"Invalid TX_ISOLATION={TX_ISOLATION!r}; must be one of {sorted(ALLOWED_ISOLATION_LEVELS)}")

engine = create_engine(
    DATABASE_URL,
    isolation_level=TX_ISOLATION,
    pool_pre_ping=True,
    pool_size=12,
    max_overflow=4,
    pool_recycle=1800,
    future=True,
)

@event.listens_for(engine, "connect")
def _set_session_settings(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("SET SESSION innodb_lock_wait_timeout = %s", (LOCK_WAIT_TIMEOUT,))
    cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
Base = declarative_base()


def check_connection() -> None:
    """Fail startup early when the configured database is unreachable."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        raise RuntimeError("Could not connect to DATABASE_URL") from exc

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
