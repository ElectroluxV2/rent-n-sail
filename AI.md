# AI usage docs

## 2026-10-26 — pnpm setup in Vercel deployment jobs

- AI assistance: Junie (OpenAI GPT-6 Luna) compared the frontend/backend GitHub Actions setup steps and explained why pnpm setup is currently outside the shared Vercel deployment composite action.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Both projects use Node.js 24. The frontend omits the pnpm version because `frontend/package.json` pins `packageManager` to `pnpm@12.15.0`; the backend has no `package.json`, so its workflow explicitly supplies `version: 12.15.0`. Moving setup into the composite action is possible, but the composite currently owns only Vercel-specific deploy steps while each caller owns runtime and cache setup.

## 2026-10-26 — Job-level Vercel deployment environment

- AI assistance: Junie (OpenAI GPT-6 Luna) updated the GitHub Actions deployment workflows to define Vercel deployment settings in dedicated job-level environments rather than composite-action step environments.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Split deployment into separate jobs gated on successful CI; only those jobs receive the Vercel token and project configuration, keeping credentials unavailable to lint/test steps. The shared composite action now consumes the caller job's environment.

## 2026-10-26 — GitHub Actions Vercel CI/CD

- AI assistance: Junie (OpenAI GPT-6 Luna) inspected the frontend/backend Vercel projects and existing CI workflows, researched Vercel's prebuilt deployment flow, and configured GitHub Actions to build and deploy both projects from Actions rather than Vercel's cloud build service.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Added production deployments on `main` and same-repository PR preview deployments, using a shared composite action to run `vercel pull`, `vercel build`, and `vercel deploy --prebuilt` on GitHub Actions. The CLI is installed with pnpm, whose GitHub Actions cache is enabled; fork PRs never receive the Vercel token.
- Stored the Vercel organization and service project IDs as GitHub repository variables and verified the `VERCEL_TOKEN` secret is configured. Regenerated and verified `.github/workflows/actions.lock`.
- Formatted the existing frontend README and spec that the repository-wide format check flagged, so the CI gate can pass.
- Routed the frontend root through its Angular SSR function and allowlisted Vercel’s runtime, branch, and production hostnames to satisfy Angular’s SSR host validation without a broad wildcard.

## 2026-10-26 — Separate Vercel projects and Neon database

- AI assistance: Junie (OpenAI GPT-6 Luna) reviewed the repository's Vercel services configuration and frontend/backend API setup, researched current Vercel monorepo, rewrite, FastAPI, and Marketplace storage documentation, and advised how to deploy the frontend and backend independently with Neon Postgres.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Recommended two Vercel projects rooted at `frontend` and `backend`, with Neon provisioned as a Marketplace database resource and connected to the backend project; advised configuring the frontend `/api` external rewrite and backend URL environment variable for SSR.
- Follow-up AI assistance: used Vercel CLI to create and configure `rent-n-sail-frontend` and `rent-n-sail-backend`, provisioned the free Neon resource `rent-n-sail-db`, and deployed the backend. The first Angular deployment built successfully but produced no Vercel routes; added an explicit Node function entrypoint for Angular SSR and documented the `/api` backend proxy. The frontend redeployment is pending verification.

## 2026-10-24 — Vercel services deployment

- AI assistance: Junie (OpenAI GPT-6 Luna) inspected the repository and Vercel/Angular documentation, configured Vercel services, aligned FastAPI routes with `/api`, and implemented the Angular SSR connectivity check, transfer-cache mapping, and signal-form retry action.
- Author attribution: `@ElectroluxV2` (verified with `gh repo view --json owner,name,url`).
- The user confirmed a `frontend` → `backend` call. Added the `BACKEND_URL` service binding and wired it to the existing `/api` hello endpoint; browser hydration uses the public `/api` path and the transfer-cache origin map.
- Verification: Angular tests and production build pass; the build prerenders zero static routes. `vercel.json` parses with the expected binding and rewrite order. `vercel dev` could not run because Vercel CLI is unavailable, and standalone backend runtime checks could not run because FastAPI is not installed locally.
- Follow-up AI assistance: explained the distinction between FastAPI `root_path` (proxy mount metadata) and route prefixes, and centralized backend routes under `APIRouter(prefix="/api")` without changing public URLs.

## 2026-10-24 — Backend Ruff configuration

- AI assistance: OpenAI GPT-5.6 Terra Fast inspected the backend's Python version, FastAPI application, dependencies, and existing Ruff settings, then added a Ruff configuration targeting Python 3.15 with import sorting, bugbear, simplification, and modernization lint rules while retaining the requested formatter style. After the branch was rebased onto a Python 3.14 baseline, it aligned Ruff's target version to Python 3.14.
- Author attribution: `@Buzeqq` (verified with `gh api user`).