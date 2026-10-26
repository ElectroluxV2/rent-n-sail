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

Review generated migrations before committing them. Production migrations should be backward compatible with the previous application version; the deployment pipeline does not automatically downgrade a database when an application deployment fails.

The reusable database workflow prepares an isolated copy-on-write Neon preview, runs migration tests, applies migrations, and uses `neondatabase/schema-diff-action` to comment the schema difference against the production parent on the PR. See [repository setup](../ci/README.md#repository-setup) for the token and project variables.

Local tests use an isolated SQLite database to exercise upgrade, repeatability, seed data, and downgrade without requiring a Neon secret. The real preview workflow executes the same Alembic migration on Postgres; an offline Postgres SQL rendering can be checked with `uv run alembic upgrade head --sql` and a Postgres `DATABASE_URL`.
