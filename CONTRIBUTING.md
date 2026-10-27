# Contributing

## Local setup

1. Install pnpm 12: https://pnpm.io/installation
2. Install Node.js using pnpm: `pnpm env use --global 24`. This matches `devEngines.runtime` in `frontend/package.json`.
3. Install frontend dependencies: `cd frontend && pnpm install`
4. uv 0.13.5: https://docs.astral.sh/uv/getting-started/installation/
5. Install backend dependencies: `cd backend && uv sync`. uv selects Python from `backend/pyproject.toml`.

## Local development

Portless is installed with the frontend development dependencies. Start the services from `frontend` in separate terminals; no environment file is required:

```bash
pnpm run start:backend
pnpm start
```

Use `https://frontend.localhost` and `https://backend.localhost`. The first interactive run may ask to trust the local CA and bind port 443. See [frontend/README.md](frontend/README.md#development-server) for configuration overrides.

To exercise the sample inventory, set `DATABASE_URL` in your process environment to a direct Neon development/preview connection, apply the [database migrations](database/README.md), then request `/boats` on the backend origin. The backend serves `/` and `/health` directly too; there is no `/api` prefix. Never commit connection strings.

AuthTuna stores local user and passkey data in `backend/authtuna_dev.db`.

## Formatting

Run the formatter from `frontend` with `pnpm format`.
To check formatting without changing files, run `pnpm format:check`.

Run the formatter from `backend` with `uv run ruff format`.
To check formatting without changing files, run `uv run ruff format --check`
