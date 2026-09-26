import os
from datetime import datetime, timedelta, timezone
import bcrypt
from dotenv import load_dotenv
from jose import JWTError, jwt

load_dotenv()

_PLACEHOLDER_JWT_SECRETS = {"change-this-development-secret", "replace-with-a-long-random-development-secret"}

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY or SECRET_KEY in _PLACEHOLDER_JWT_SECRETS:
    raise RuntimeError("JWT_SECRET must be set in .env to a real secret (not unset or a placeholder value)")
ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())

def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=12)
    return jwt.encode({"sub": str(user_id), "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)

def get_user_id(token: str) -> int:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid token") from exc
