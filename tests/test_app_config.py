import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _run(code: str, env_overrides: dict):
    env = dict(os.environ)
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True, timeout=30,
    )


def test_missing_jwt_secret_fails_to_start():
    # An empty string, not a popped key: a .env file with a real JWT_SECRET
    # exists in this project, and load_dotenv() only fills in keys that are
    # NOT already present in the environment -- popping the key would just
    # let load_dotenv() silently repopulate it from .env, defeating the test.
    result = _run("import backend.auth", {"JWT_SECRET": ""})
    assert result.returncode != 0
    assert "JWT_SECRET" in result.stderr


def test_placeholder_jwt_secret_fails_to_start():
    result = _run("import backend.auth", {"JWT_SECRET": "change-this-development-secret"})
    assert result.returncode != 0
    assert "JWT_SECRET" in result.stderr

    result = _run("import backend.auth", {"JWT_SECRET": "replace-with-a-long-random-development-secret"})
    assert result.returncode != 0
    assert "JWT_SECRET" in result.stderr


def test_real_jwt_secret_starts_fine():
    result = _run("import backend.auth", {"JWT_SECRET": "a-real-development-secret-value-12345"})
    assert result.returncode == 0, result.stderr


def test_default_cors_origins():
    env = dict(os.environ)
    env.pop("CORS_ORIGINS", None)
    result = subprocess.run(
        [sys.executable, "-c", "import backend.main as m; print(m.CORS_ORIGINS)"],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "['http://127.0.0.1:5500', 'http://localhost:5500']"


def test_custom_cors_origins_from_env():
    result = _run(
        "import backend.main as m; print(m.CORS_ORIGINS)",
        {"CORS_ORIGINS": "https://example.com, https://foo.bar"},
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "['https://example.com', 'https://foo.bar']"
