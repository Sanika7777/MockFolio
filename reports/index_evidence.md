# Index evidence (Task 9, item 4)

Measured against real MySQL 8 (`mockfolio_test`), same schema as production.

## Order-history query (`GET /orders`: `user_id` filter + `ORDER BY created_at DESC`)

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 1 ORDER BY created_at DESC LIMIT 50;
```

**Before** (only `ix_orders_user (user_id)` existed):

| id | select_type | table | type | key | key_len | ref | rows | Extra |
|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | orders | ref | ix_orders_user | 4 | const | 1 | **Using filesort** |

**After** adding `ix_orders_user_created (user_id, created_at)`:

| id | select_type | table | type | key | key_len | ref | rows | Extra |
|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | orders | ref | ix_orders_user_created | 4 | const | 1 | **Backward index scan** |

The composite index lets MySQL walk the index in `created_at` order directly (backward, since the query wants DESC) instead of pulling matching rows out and sorting them afterward.

## Trades listing query (`GET /trades`: same shape)

```sql
EXPLAIN SELECT * FROM trades WHERE user_id = 1 ORDER BY created_at DESC LIMIT 50;
```

**Before** (only `ix_trades_user (user_id)` existed):

| id | select_type | table | type | key | key_len | ref | rows | Extra |
|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | trades | ref | ix_trades_user | 4 | const | 1 | **Using filesort** |

**After** adding `ix_trades_user_created (user_id, created_at)`:

| id | select_type | table | type | key | key_len | ref | rows | Extra |
|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | trades | ref | ix_trades_user_created | 4 | const | 1 | **Backward index scan** |

## Chart query (`GET /stocks/{id}/history`: `stock_id` filter + `ORDER BY recorded_at DESC`)

```sql
EXPLAIN SELECT * FROM price_history WHERE stock_id = 1 ORDER BY recorded_at DESC LIMIT 50;
```

| id | select_type | table | type | key | key_len | ref | rows | Extra |
|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | price_history | ref | ix_history_stock_time | 4 | const | 1 | Backward index scan |

No change needed here: `sql/schema.sql` already defines `price_history` with a composite index (`ix_history_stock_time (stock_id, recorded_at)`), so this query was already filesort-free before this task.

## Changes made

- Added `ix_orders_user_created (user_id, created_at)` to `orders` and `ix_trades_user_created (user_id, created_at)` to `trades`, in `sql/schema.sql` (for fresh installs), `backend/models.py` (`__table_args__`, so `Base.metadata.create_all` stays in sync), and applied directly via `ALTER TABLE ... ADD INDEX` to both the real `mockfolio` and `mockfolio_test` databases used in this project so far.
- `ix_orders_user` and `ix_trades_user` (the original single-column indexes) were left in place rather than removed, since other queries (e.g. admin per-user summaries that don't order by `created_at`) still benefit from them and dropping them wasn't asked for.
