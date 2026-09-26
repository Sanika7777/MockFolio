from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.main import app, current_user


def _fake_user(role: str):
    return SimpleNamespace(user_id=1, username="u", email="u@test.local", role=role, is_active=1, is_admin=role == "ADMIN")


def _client_as(role: str):
    app.dependency_overrides[current_user] = lambda: _fake_user(role)
    return TestClient(app)


def test_decay_rejects_non_admin():
    try:
        assert _client_as("USER").post("/simulation/decay").status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_tx_metrics_rejects_non_admin():
    try:
        assert _client_as("USER").get("/admin/tx-metrics").status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_settings_rejects_non_admin():
    try:
        assert _client_as("USER").get("/admin/settings").status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_tx_metrics_returns_counters_for_admin():
    try:
        resp = _client_as("ADMIN").get("/admin/tx-metrics")
        assert resp.status_code == 200
        assert set(resp.json()) == {"attempts", "retries", "deadlocks", "lock_timeouts", "gave_up"}
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_settings_returns_tunables_for_admin():
    try:
        resp = _client_as("ADMIN").get("/admin/settings")
        assert resp.status_code == 200
        assert {"kappa", "tau_seconds", "perm_fraction", "brokerage_pct"} <= set(resp.json())
    finally:
        app.dependency_overrides.pop(current_user, None)
