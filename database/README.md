# Database migrations

This project follows [Neon's FastAPI/SQLAlchemy migration guide](https://neon.com/docs/guides/sqlalchemy-migrations): SQLAlchemy models plus Alembic, using a **direct, non-pooled** Neon connection for migrations. The application uses a pooled connection separately.

The initial migration creates `boats` with a unique name, non-negative daily rate, and a `Demo sailboat` sample record. Repeating `alembic upgrade head` does not insert duplicate sample rows. `/boats` on the backend origin reads this inventory.

Set `DATABASE_URL` to your development/preview branch's direct connection string, then run from this directory:

```bash
uv sync --locked
uv run alembic upgrade head
```

Models live in `backend/models.py`. To generate a subsequent migration against your development database:

```bash
uv run alembic revision --autogenerate -m "describe schema change"
uv run alembic upgrade head
```

Review generated migrations before committing them. Production migrations should be backward compatible with the previous application version.

An offline Postgres SQL rendering can be checked with `uv run alembic upgrade head --sql` and a Postgres `DATABASE_URL`.
