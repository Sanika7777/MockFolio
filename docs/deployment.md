# Deploying MockFolio to Railway

Two Railway services in one project:

| service | what it is | reachable from |
|---|---|---|
| **MySQL** | the database | the web service only, over private networking |
| **web** | FastAPI backend **and** the static frontend | the internet, over HTTPS |

The frontend is not a separate service. `backend/main.py` mounts `frontend/`
at `/`, so the browser loads the page and calls the API on the same origin.
That is why `CORS_ORIGINS` is empty and why `frontend/js/api.js` uses
`API_BASE = ""`.

Run **one** web replica. Several replicas each run their own tick worker and
each hold their own set of browser connections, so half your users would stop
receiving updates.

---

## 1. Create the MySQL service

1. New Project → **Deploy MySQL**.
2. Open the service → **Variables**. Note `MYSQLDATABASE` (usually `railway`),
   `MYSQLUSER`, `MYSQLPASSWORD`, and both `MYSQL_URL` (private) and
   `MYSQL_PUBLIC_URL` (external).

The private hostname is `<service-name>.railway.internal` and resolves **only
inside Railway**. Your laptop cannot reach it, which is why step 2 uses the
public URL.

### Server settings

Creating triggers needs `log_bin_trust_function_creators` when binary logging
is on and the user lacks `SUPER`. Railway's MySQL user is normally `root`, so
this usually just works. If step 2 fails with:

```
ERROR 1419 (HY000): You do not have the SUPER privilege and binary logging is enabled
```

run this once against the Railway database and retry:

```sql
SET PERSIST log_bin_trust_function_creators = 1;
```

Also set, to match `docs/TRANSACTION_CONTROL.md` and doc 0.4:

```sql
SET PERSIST innodb_lock_wait_timeout = 5;
SET PERSIST innodb_print_all_deadlocks = ON;
SET PERSIST transaction_isolation = 'REPEATABLE-READ';
SET PERSIST time_zone = '+00:00';
```

---

## 2. Load the schema

From your laptop, using `MYSQL_PUBLIC_URL`'s host/port/password. The SQL files
carry no `USE` statement, so the database name goes on the command line — run
them **in this order**:

```bash
H=<public host>; P=<public port>; U=root; PW=<password>; DB=railway

for f in schema triggers views procedures seed; do
  echo "applying $f"
  mysql -h "$H" -P "$P" -u "$U" -p"$PW" "$DB" < "sql/$f.sql"
done
```

Confirm it landed:

```bash
mysql -h "$H" -P "$P" -u "$U" -p"$PW" "$DB" -e "
SELECT (SELECT COUNT(*) FROM users) users,
       (SELECT COUNT(*) FROM accounts) accounts,
       (SELECT COUNT(*) FROM instruments) instruments,
       (SELECT COUNT(*) FROM settings) settings;
SELECT COUNT(*) AS triggers_present FROM information_schema.triggers WHERE trigger_schema='$DB';
SELECT COUNT(*) AS non_innodb FROM information_schema.tables
WHERE table_schema='$DB' AND table_type='BASE TABLE' AND engine <> 'InnoDB';"
```

Expect `10 / 10 / 30 / 8`, `triggers_present = 4`, `non_innodb = 0`.

`accounts = 10` with no accounts in `seed.sql` is the point: the
`trg_users_ai_account` trigger creates them. If accounts is 0, the trigger did
not load — go back to the `ERROR 1419` fix above.

**Delete the demo users before the app is publicly reachable.** Their password
is in `test_creds.md` and is the same for all ten.

`CREATE TABLE IF NOT EXISTS` never alters an existing table, so if you change
the schema later you must drop and reload, not re-run these files.

---

## 3. Create the web service

1. Same project → **New** → **GitHub Repo** → `Sanika7777/MockFolio`.
2. Railway reads `Procfile`:

```
web: uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1
```

3. **Settings → Networking → Generate Domain.** HTTPS is automatic and
   required: browsers block insecure WebSocket connections from a secure page,
   so without it the phase-4 live layer will not work.
4. **Settings → Health Check Path:** `/health`. It runs `SELECT 1`, so it
   fails if the database is unreachable rather than reporting a false green.

---

## 4. Environment variables

On the **web** service. Use reference variables so nothing is copy-pasted:

| variable | value |
|---|---|
| `DATABASE_URL` | `mysql+pymysql://${{MySQL.MYSQLUSER}}:${{MySQL.MYSQLPASSWORD}}@${{MySQL.RAILWAY_PRIVATE_DOMAIN}}:3306/${{MySQL.MYSQLDATABASE}}` |
| `JWT_SECRET` | a long random string — `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `TX_ISOLATION` | `REPEATABLE READ` |
| `LOCK_WAIT_TIMEOUT` | `5` |
| `LOG_LEVEL` | `INFO` |
| `MARKET_DATA_SOURCE` | `simulated` (switch to `angelone` in phase 7.1) |
| `ENABLE_TICK_WORKER` | `1` |
| `TZ` | `Asia/Kolkata` |
| `CORS_ORIGINS` | leave **unset** — frontend and API are same-origin |

`MYSQL_URL` starts with `mysql://`, which SQLAlchemy does not accept. The
scheme must be `mysql+pymysql://`, which is why `DATABASE_URL` is assembled
from the individual variables above rather than referencing `MYSQL_URL`.

Do **not** set `TEST_DATABASE_URL` here. It belongs only on a developer laptop
and must point at a disposable database, because the concurrency suite
truncates `users` and `accounts`.

For AngelOne later (phase 7.1), add `ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`,
`ANGEL_PIN`, `ANGEL_TOTP_SECRET`. The TOTP secret is as sensitive as a
password — Railway variables only, never the repository.

---

## 5. Verify the deployment

```bash
APP=https://<your-app>.up.railway.app

curl -s $APP/health                      # {"status":"ok"}
curl -s $APP/instruments | head -c 200   # 30 instruments with prices
curl -sI $APP/ | head -1                 # 200, the login page
curl -sI $APP/css/style.css | head -1    # 200, static assets served
```

Then in a browser: register, buy, and check that the price moves and the
"New deviation" figure appears on the result.

In **Deploy Logs** you should see one line every few seconds:

```
INFO mockfolio.tick tick source=simulated instruments=30 elapsed_ms=608.5
```

If those lines are missing, the tick worker is not running and prices will
never move on their own.

---

## 6. Backup and restore (doc 8.3)

A dump without routines and triggers restores into a database that looks fine
and is subtly broken — `sp_reset_account` and the audit trail would be gone.

```bash
mysqldump -h "$H" -P "$P" -u "$U" -p"$PW" \
  --routines --triggers --events --single-transaction \
  "$DB" > backup_$(date +%F).sql
```

Prove it restores before you rely on it — into a scratch database, never over
the live one. The restoring user needs privileges on that scratch name; on
Railway `root` has them, but a locally scoped user like `mf_migrate` will get
`ERROR 1044` unless you grant it first:

```bash
mysql -h "$H" -P "$P" -u "$U" -p"$PW" -e "CREATE DATABASE restore_check;"
mysql -h "$H" -P "$P" -u "$U" -p"$PW" restore_check < backup_$(date +%F).sql
mysql -h "$H" -P "$P" -u "$U" -p"$PW" restore_check -e "
SELECT COUNT(*) AS triggers_present FROM information_schema.triggers WHERE trigger_schema='restore_check';
SELECT COUNT(*) AS routines_present FROM information_schema.routines WHERE routine_schema='restore_check';"
mysql -h "$H" -P "$P" -u "$U" -p"$PW" -e "DROP DATABASE restore_check;"
```

Expect 4 triggers and 2 routines. Verified against this codebase: restoring a
40 KB dump into an empty database gives back 13 tables, 4 triggers, 2
routines, 2 views, 30 instruments and 8 settings — and the restored
`trg_users_ai_account` still fires, creating an account at the configured
starting cash. That last check is the one that matters: a dump taken without
`--routines --triggers` restores into a database that looks complete and
silently stops crediting new users.

Take a snapshot before the demo and keep it somewhere other than the server.

---

## 7. Capacity and cost

Measured locally against this codebase, one worker, MySQL 8.0.46. Ten
simulated users with 0.2s think time — harder than ten real people clicking:

| | 10 users | 25 users |
|---|---|---|
| requests | 3344 over 30s (110 req/s) | 2931 over 25s (115 req/s) |
| `POST /trades/buy` p50 / p95 | 124ms / 211ms | 376ms / 544ms |
| read endpoints p95 | 39–95ms | 164–235ms |
| errors | **0** | **0** |
| peak MySQL connections | 17 | 17 |

Throughput plateaus near 115 req/s — that is the single-worker ceiling, and
it is about 5× the load ten real users generate. Peak connections stay at 17
because the pool caps them (`pool_size=12 + max_overflow=4` in
`backend/database.py`), well under MySQL's default 151.

App memory was 87 MB. Railway Hobby allows up to 8 GB RAM and 8 vCPU per
replica, so there is roughly 90× RAM and 8× CPU headroom. **Ten concurrent
users needs nothing beyond Hobby.**

Billing is per minute: RAM $10/GB/month, CPU $20/vCPU/month, with the $5/month
Hobby fee acting as credit. Expect roughly $5–10/month.

One cost note: with `tick_interval_s = 3` and 30 instruments the worker issues
about 90 statements every three seconds, so nothing ever idles and you are
billed around the clock. Raising `tick_interval_s` or deactivating instruments
you are not demoing cuts this, and both are live-editable through
`/admin/settings` with no redeploy.

---

## 8. Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `ERROR 1419 ... SUPER privilege` when loading `triggers.sql` | binary logging on, user lacks `SUPER` | `SET PERSIST log_bin_trust_function_creators = 1;` |
| `Can't connect to MySQL server on '*.railway.internal'` from your laptop | the private domain resolves only inside Railway | use `MYSQL_PUBLIC_URL` for laptop-side work |
| `Can't load plugin: sqlalchemy.dialects:mysql.mysql` | `DATABASE_URL` starts with `mysql://` | use `mysql+pymysql://` |
| accounts table empty after seeding | `trg_users_ai_account` never created | reload `sql/triggers.sql` after the 1419 fix |
| prices never move | tick worker off | set `ENABLE_TICK_WORKER=1`; check logs for `mockfolio.tick` |
| `CREATE command denied` at startup | an old build still calling `create_all()` | schema comes from `sql/*.sql` only; redeploy current `main` |
| frontend loads, every API call fails CORS | `CORS_ORIGINS` set to a stale value | unset it; the app is same-origin |
| requests slow, then 500s under load | more than one replica | scale to exactly one |
