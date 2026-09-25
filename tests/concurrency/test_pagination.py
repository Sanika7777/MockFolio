"""Task 9 item 3: limit/offset pagination with a hard cap on GET /orders."""
import uuid

from fastapi.testclient import TestClient

from backend.main import app

import helpers


def test_orders_pagination_limit_offset_and_hard_cap():
    helpers.reset_db()
    with TestClient(app) as client:
        resp = client.post("/auth/register", json={
            "username": f"page_{uuid.uuid4().hex[:10]}",
            "email": f"page_{uuid.uuid4().hex[:10]}@test.local",
            "password": "password123",
        })
        resp.raise_for_status()
        token = resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        stock_id = client.get("/stocks").json()[0]["id"]
        for _ in range(5):
            r = client.post("/trades/buy", json={"stock_id": stock_id, "quantity": 1, "client_order_key": str(uuid.uuid4())}, headers=headers)
            assert r.status_code == 200, r.text

        all_orders = client.get("/orders", headers=headers).json()
        assert len(all_orders) == 5
        assert isinstance(all_orders, list)  # default response shape stays a plain list

        page = client.get("/orders", params={"limit": 2, "offset": 2}, headers=headers).json()
        assert len(page) == 2
        assert [o["id"] for o in page] == [o["id"] for o in all_orders[2:4]]

        over_cap = client.get("/orders", params={"limit": 500}, headers=headers)
        assert over_cap.status_code == 422, "limit above the 200 hard cap must be rejected, not silently clamped"
