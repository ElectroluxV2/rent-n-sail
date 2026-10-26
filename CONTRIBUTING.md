# Contributing

## Local setup

1. Install pnpm 12: https://pnpm.io/installation
2. Install Node.js 26: `pnpm runtime set --global node 26`
3. Install frontend dependencies: `cd frontend && pnpm install`
4. uv 0.13.5: https://docs.astral.sh/uv/getting-started/installation/
5. python 3.15: `uv python install 3.15`
6. install backend dependencies: `cd backend && uv sync`
7. Run the backend from `backend`: `uv run fastapi dev main.py --port 5000`. AuthTuna stores local user and passkey data in `backend/authtuna_dev.db`.
8. In another terminal, run the frontend from `frontend`: `pnpm start`. It listens on `http://localhost:4200` and its development proxy forwards `/api` requests to `http://127.0.0.1:5000`.

## Formatting

Run the formatter from `frontend` with `pnpm format`.
To check formatting without changing files, run `pnpm format:check`.

Run the formatter from `backend` with `uv run ruff format`.
To check formatting without changing files, run `uv run ruff format --check`
