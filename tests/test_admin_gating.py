from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.main import app, current_user


def _fake_user(is_admin: bool):
    return SimpleNamespace(id=1, username="u", email="u@test.local", is_admin=is_admin)


def test_decay_rejects_non_admin():
    app.dependency_overrides[current_user] = lambda: _fake_user(is_admin=False)
    try:
        client = TestClient(app)
        resp = client.post("/simulation/decay")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_tx_metrics_rejects_non_admin():
    app.dependency_overrides[current_user] = lambda: _fake_user(is_admin=False)
    try:
        client = TestClient(app)
        resp = client.get("/admin/tx-metrics")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_tx_metrics_returns_counters_for_admin():
    app.dependency_overrides[current_user] = lambda: _fake_user(is_admin=True)
    try:
        client = TestClient(app)
        resp = client.get("/admin/tx-metrics")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {"attempts", "retries", "deadlocks", "lock_timeouts", "gave_up"}
    finally:
        app.dependency_overrides.pop(current_user, None)
