# AI usage docs

## 2026-10-26 — PR #14 review feedback

- AI assistance: OpenCode (GPT-6.1 Sol) assessed the 13 review threads on [PR #14](https://github.com/Renters-Sailors/rent-n-sail/pull/14), implemented the requested workflow simplifications, and prepared replies explaining the changes and deployment architecture.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Extracted cached CLI setup into its own composite action, moved non-secret Vercel settings to workflow-level environments, removed token arguments and duplicate command branches, and required explicit existing config files. Preview branch selection uses GitHub's built-in `GITHUB_HEAD_REF` directly.
- Consolidated each workflow into one job, shared path filters and deployment conditions with YAML anchors, removed pnpm setup from backend validation, and made Angular builds unconditional after successful checks. pnpm and Node.js versions now come from `frontend/package.json`; the shared CLI setup skips frontend dependency installation and reuses an initialized toolchain. Deployment credentials remain scoped to the guarded deployment step, and merging backend jobs preserves uv for the Vercel Python build.
- Documented why the Angular SSR function adapter and same-origin API rewrites are needed, explained the separate frontend/backend/Neon roles and local-only scope of Portless, and linked Vercel's system-variable documentation beside the allowed-host variables.
- Verification: frontend ESLint, formatting, Angular unit tests and production build passed; backend Ruff lint and formatting passed. The extracted setup installed Vercel 65.2.0. Exercised preview/production command arguments, missing configs, and pull/build failures using a mock CLI, and rendered backend fixture data through the real compiled SSR adapter under a Vercel preview hostname. Actionlint passed with its existing narrow exception for `$/` action syntax; ShellCheck and the online action-lock verification passed.

## 2026-10-26 — Personal commit signing for this clone

- AI assistance: OpenCode (GPT-6.1 Sol) configured this clone to sign commits with the author's personal GitHub identity and SSH signing key.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Set repository-local personal identity and SSH signing using `electroluxv2@gmail.com` and `~/.ssh/github-personal.pub`, with commit signing enabled and a clone-local allowed-signers file. Global Git configuration is unchanged.
- Verification: confirmed the personal key is registered with GitHub for signing and the personal email was used by an earlier Verified commit. Created an unreferenced signed test commit and verified its signature, key fingerprint, author email, and committer email without changing branch history.
- Follow-up AI assistance: prepared the two recent commits for re-signing with personal author and committer attribution and a force-with-lease push, as requested.

## 2026-10-26 — YAML language injection comments

- AI assistance: OpenCode (GPT-6.1 Sol) checked all YAML files for embedded shell scripts and added the existing `# language=bash` injection comment to the three unannotated `run` blocks in the shared Vercel deployment action. Workflow scripts already had the comments; executable content is unchanged.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Follow-up AI assistance: prepared the language injection comments for commit and push to `cd` at the author's request, using the personal SSH remote.

## 2026-10-26 — Installed Vercel CLI caching

- AI assistance: OpenCode (GPT-6.1 Sol) implemented caching of the installed Vercel CLI in the shared deployment action so exact cache hits skip installation.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- The cache key includes the runner OS and architecture, Node.js version, pnpm version, and Vercel CLI version. Cold runs install into a dedicated tool-cache directory with project-local package links and allow the required `esbuild` build script. The cache is saved immediately after installation so subsequent deployment failures do not prevent reuse.
- Disabled the backend pnpm store cache that required a nonexistent pnpm lockfile. Regenerated `actions.lock` with `gh actions-lock`, including migration of shared-action references to the pinned `$/` syntax. Removed trailing whitespace from the backend lint/format failure condition that made it unconditional.
- Verification: using pnpm 12.15.0, Node.js 24.22.1, and Vercel 65.2.0, executed the action's installation scripts, archived the CLI, deleted its installation and package store, and restored the archive. The restored CLI passed `--version` and `build --help` without reinstalling. ShellCheck and `gh actions-lock --verify` passed. Actionlint passed with a narrow exception for the supported `$/` syntax that actionlint 1.7.12 does not yet recognize.
- Follow-up AI assistance: prepared the validated changes for commit and push to `cd` at the author's request, using the personal SSH remote.

## 2026-10-26 — Backend CI cache failure diagnosis

- AI assistance: OpenCode (GPT-6.1 Sol) cloned the repository using the personal SSH alias `ghp`, checked out `cd`, selected the personal GitHub CLI account, and investigated [Backend CI run 40340937710](https://github.com/Renters-Sailors/rent-n-sail/actions/runs/40340937710).
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Root cause: both backend `pnpm/setup@v3.1.1` steps enable caching, which requires a pnpm lockfile. The Python backend has `uv.lock` but no `pnpm-lock.yaml`, so cache restoration fails with `Some specified paths were not resolved, unable to cache dependencies.`
- Verification: reproduced the exact failure using the pinned upstream action (`a0881977cd8ea73b1ed212236c99ca10dcc80cf4`) against a temporary snapshot of the failing commit. Changing only `cache` to `false` completed pnpm and Node.js setup successfully. Recommended setting `cache: false` in both backend pnpm setup steps.

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
