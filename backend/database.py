import logging
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

logger = logging.getLogger("mockfolio.database")

MIGRATION_SCRIPTS = (
    ("001", "schema.sql"),
    ("002", "triggers.sql"),
    ("003", "views.sql"),
    ("004", "procedures.sql"),
    ("005", "seed.sql"),
)
MIGRATION_LOCK = "mockfolio.schema_migrations"


def _split_mysql_script(script: str):
    """Yield executable statements from a script containing MySQL DELIMITER directives."""
    delimiter = ";"
    statement = []
    quote = None
    escaped = False

    for line in script.splitlines(keepends=True):
        if not "".join(statement).strip() and line.strip().upper().startswith("DELIMITER "):
            delimiter = line.strip().split(None, 1)[1]
            statement = []
            continue

        index = 0
        while index < len(line):
            character = line[index]
            if quote:
                statement.append(character)
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == quote:
                    quote = None
                index += 1
                continue

            if character in ("'", '"', "`"):
                quote = character
                statement.append(character)
                index += 1
                continue

            if line.startswith(delimiter, index):
                sql = "".join(statement).strip()
                if sql:
                    yield sql
                statement = []
                index += len(delimiter)
                continue

            statement.append(character)
            index += 1

    sql = "".join(statement).strip()
    if sql:
        yield sql


def check_connection() -> None:
    """Fail startup early when the configured database is unreachable."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        raise RuntimeError("Could not connect to DATABASE_URL") from exc


def initialize_database() -> None:
    """Apply the bundled database scripts once, in dependency order."""
    sql_directory = Path(__file__).resolve().parent.parent / "sql"
    try:
        with engine.begin() as connection:
            acquired = connection.scalar(
                text("SELECT GET_LOCK(:lock_name, :timeout)"),
                {"lock_name": MIGRATION_LOCK, "timeout": 60},
            )
            if acquired != 1:
                raise RuntimeError("Could not acquire the database initialization lock")

            try:
                migrations_table_exists = connection.scalar(
                    text(
                        "SELECT COUNT(*) FROM information_schema.tables "
                        "WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'"
                    )
                )
                for version, filename in MIGRATION_SCRIPTS:
                    migration_applied = (
                        connection.scalar(
                            text("SELECT COUNT(*) FROM schema_migrations WHERE version = :version"),
                            {"version": version},
                        )
                        if migrations_table_exists
                        else False
                    )
                    if migration_applied:
                        logger.info("database migration %s already applied; skipping %s", version, filename)
                        continue

                    script_path = sql_directory / filename
                    logger.info("applying database migration %s (%s)", version, filename)
                    for statement in _split_mysql_script(script_path.read_text(encoding="utf-8")):
                        connection.exec_driver_sql(statement)
            finally:
                connection.execute(text("SELECT RELEASE_LOCK(:lock_name)"), {"lock_name": MIGRATION_LOCK})
    except Exception as exc:
        raise RuntimeError("Could not initialize the database from sql migration scripts") from exc

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
