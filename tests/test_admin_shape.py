from decimal import Decimal

from backend.main import admin_account_json


def test_admin_account_row_has_every_field_the_dashboard_reads():
    row = {
        "account_id": 7, "user_id": 3, "username": "a", "email": "a@x", "role": "USER", "created_at": "2026-01-01",
        "cash_balance": Decimal("1"), "starting_cash": Decimal("500000"), "holdings_value": Decimal("2"),
        "total_account_value": Decimal("3"), "unrealised_pnl": Decimal("4"), "realised_pl": Decimal("5"),
        "trade_count": 6, "order_count": 8,
    }
    out = admin_account_json(row)
    # developer.html links to developer-user.html?id=<id>, which calls /admin/users/{account_id}
    assert out["id"] == out["account_id"] == 7
    for key in ("username", "email", "created_at", "cash_balance", "portfolio_value", "unrealised_pnl", "trade_count", "is_admin"):
        assert key in out
    assert out["portfolio_value"] == Decimal("2") and out["is_admin"] is False
