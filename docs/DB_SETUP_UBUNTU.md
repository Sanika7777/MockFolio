# Mockfolio Database Setup

Run these in order. Everything below is Ubuntu/WSL terminal commands unless
it says "inside mysql shell."

---

## 1. Install MySQL on Ubuntu

```bash
sudo apt update
sudo apt install -y mysql-server
sudo service mysql start
```

## 2. Clone the repo

```bash
cd ~
git clone <REPO_URL> mockfolio
cd mockfolio
```

## 3. Server config - vvv imp

```bash
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
```

Paste this under `[mysqld]`, save (`Ctrl+O`, `Enter`, `Ctrl+X`):

```ini
default_storage_engine     = InnoDB
character_set_server       = utf8mb4
collation_server            = utf8mb4_0900_ai_ci
default_time_zone          = '+00:00'
innodb_lock_wait_timeout   = 5
innodb_print_all_deadlocks = ON
innodb_deadlock_detect     = ON
max_connections            = 200
```

```bash
sudo service mysql restart
```

## 4. Create the database users

```bash
sudo mysql
```

Inside mysql shell — pick your own passwords:

```sql
CREATE USER 'mf_migrate'@'%' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON mockfolio.* TO 'mf_migrate'@'%';

CREATE USER 'mf_app'@'%' IDENTIFIED BY 'your_password';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON mockfolio.* TO 'mf_app'@'%';

CREATE USER 'mf_ro'@'%' IDENTIFIED BY 'your_password';
GRANT SELECT, SHOW VIEW ON mockfolio.* TO 'mf_ro'@'%';

FLUSH PRIVILEGES;
exit
```

`%` means the account accepts connections from any host, so one account per
user is enough. Code is modular this way.

## 5. Set up your `.env`

```bash
cp .env.example .env
nano .env
```

Fill in the passwords you just set in step 4. Save and exit.

## 6. Build the database

```bash
mysql -h 127.0.0.1 -u mf_migrate -p < sql/schemas.sql
mysql -h 127.0.0.1 -u mf_migrate -p mockfolio < sql/triggers.sql
mysql -h 127.0.0.1 -u mf_migrate -p mockfolio < sql/seed.sql
```

**Always keep `-h 127.0.0.1` in every command.** Without it, the client can
connect through a different path that checks a different host match than the
`%` account you created, and you'll get an access-denied error even with the
right password. Every command in this file already has it — don't drop it.

Check it worked:

```bash
mysql -h 127.0.0.1 -u mf_migrate -p mockfolio -e "SHOW TABLES; SELECT COUNT(*) FROM users;"
```

## 7. Python

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## Resetting the database

Every time you add or delete something in the database files, you need to
drop the old database and rerun the whole thing from your mysql shell for it
to actually flush the changes you made. Use these commands from the
project's root directory (NOT inside mysql shell):

**To drop database:**
```bash
mysql -h 127.0.0.1 -u mf_migrate -p -e "DROP DATABASE IF EXISTS mockfolio;"
```

**To execute all files:**
```bash
mysql -h 127.0.0.1 -u mf_migrate -p < ~/mockfolio/sql/schemas.sql && \
mysql -h 127.0.0.1 -u mf_migrate -p mockfolio < ~/mockfolio/sql/triggers.sql && \
mysql -h 127.0.0.1 -u mf_migrate -p mockfolio < ~/mockfolio/sql/seed.sql
```

You'll be asked for the `mf_migrate` password three times, once per file.

---

## Common errors

**`Access denied for user 'x'@'localhost'`** — you're missing `-h 127.0.0.1`
on the command. Add it back.

**`Unknown database 'mockfolio'`** — the schema file never ran successfully,
or it was dropped. Run the rebuild commands above.

**`Table 'x' already exists`** — you ran a file twice without dropping first.
Drop the database, then rerun.

**Anything else** — copy the full error text (not just the last line), and
check it against the file and line number it names.
