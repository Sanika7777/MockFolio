import os

os.environ.setdefault("JWT_SECRET", "test-secret-not-a-placeholder-value")
os.environ.setdefault("ENABLE_TICK_WORKER", "0")
