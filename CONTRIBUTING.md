# Contributing

## Local setup

1. Install pnpm 12: https://pnpm.io/installation
2. Install Node.js 26: `pnpm runtime set --global node 26`
3. Install frontend dependencies: `cd frontend && pnpm install`
4. uv 0.13.5: https://docs.astral.sh/uv/getting-started/installation/
5. python 3.15: `uv python install 3.15`
6. install backend dependencies: `cd backend && uv sync`
7. run backend: `uv run fastapi dev`

## Formatting

Run the formatter from `frontend` with `pnpm format`.
To check formatting without changing files, run `pnpm format:check`.

Run the formatter from `backend` with `uv run ruff format`.
To check formatting without changing files, run `uv run ruff format --check`
