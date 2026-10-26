# Stack deployment

## Entry points

`automatic.yml` always resolves the stack on PRs and pushes to `main`. Its native GitHub file-list/git-diff planner selects application builds without a third-party changed-files action. Database-only or documentation-only changes do not compile applications.

The selected frontend production build is compiled once during validation. Vercel packaging reuses that validated output in the same job; standalone `build:vercel` still runs Angular's build first.

The order is database → backend → frontend. `database.yml`, `backend.yml`, and `frontend.yml` are manual-only entry points; each calls its corresponding `reusable-*.yml` workflow. Manual application runs default to a build. A standalone backend resolves its database first; a standalone frontend resolves its backend and database first.

Every target is serialized across automatic/manual runs with a non-cancelling queue. Each application/database also has a shared per-target concurrency group and a GitHub Environment.

## Repository setup

Secrets:

- `VERCEL_TOKEN`: access to both Vercel projects and aliases.
- `NEON_API_KEY`: access to the selected Neon project, branches, connection URIs, and schema comparison. Never place this value in a comment or repository variable.

Variables:

- `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID`, `VERCEL_FRONTEND_PROJECT_ID`.
- `NEON_PROJECT_ID` (required; a repository variable or secret is accepted).
- `NEON_PARENT_BRANCH_ID` (optional; project default branch if unset). This must be the production parent intended for copy-on-write previews.
- `NEON_DATABASE_NAME` / `NEON_ROLE_NAME` (optional; `neondb` / `neondb_owner`).

The official Neon Create Branch action creates/reuses `preview/<git-branch>` and returns a non-secret branch ID. Connection strings are resolved privately in the consuming job: direct for Alembic, pooled for the backend. The official Neon Schema Diff action updates a PR comment after the migration.

GitHub Actions now owns explicit preview branch preparation so database-first ordering is possible. The existing Vercel–Neon resource connection may remain, but avoid two competing preview-branching mechanisms. Workflow runtime bindings explicitly select the prepared branch. Branch cleanup is not automatic; delete obsolete previews deliberately in Neon after closing branches.

## Selective builds and portable output

The resolver first reuses a READY deployment for the current branch if its runtime bindings match. Otherwise, it restores that branch's retained output, or production's retained output when bootstrapping a new branch. It never silently rebuilds unchanged source or falls back from a branch's code to older production code when only bindings changed.

Vercel's [documented create-deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment) describes `deploymentId` as a new build. Promotion changes production traffic, not preview runtime configuration. Until a supported zero-build clone endpoint is available, a small GitHub artifact containing compiled Build Output is the portable fallback; no OCI registry is used.

The archive is retained for 90 days. Deployment metadata identifies its immutable artifact ID, run, and name. Restoration validates those references and repository provenance. It contains only the public Build Output v3 contract (`config.json`, functions, static files), not target-bound CLI `builds.json`, diagnostics, or caches. Tar extraction rejects traversal. Checkout-local build symlinks are materialized; external symlinks are rejected.

Compilation intentionally does not load the private environment downloaded by `vercel pull`; target-specific bindings belong at runtime. Artifacts exclude `.env*` files and runtime credentials. Only an allowlist of transport-neutral runtime hints is retained in function metadata. Known credential bytes in other output files cause upload to fail. Target-specific `DATABASE_URL`, explicit CORS origins, `BACKEND_URL`, and `FRONTEND_URL` are applied only **after** the portable artifact has been uploaded. Raw database credentials never cross job outputs.

An existing production deployment created before this artifact contract has no reusable artifact. Bootstrap each application once with its manual workflow and `build=true` (after the workflow files reach the default branch), or let the first changed production build create one. Missing/expired artifacts fail with an actionable message rather than triggering a hidden rebuild.

## URLs and runtime configuration

Each preview uses stable, project-and-branch-specific aliases. The frontend origin is reserved/ownership-checked before being granted CORS access; on first reservation the alias temporarily points at the existing stable frontend until the preview is published. Wait for the entire stack run to be green before using it. Existing aliases are never taken from another project.

The backend allows exactly the corresponding frontend origin. The frontend receives the resolved backend URL as runtime configuration, not a compiled constant. SSR transfers it to Angular; a client-rendered entry loads `/runtime-config.json` before bootstrap, fixing the missing-URL failure without a frontend rebuild when backend bindings change.

Backend preview URLs must be accessible to browser API calls. Vercel team-login protection cannot be solved by exposing an automation bypass secret to JavaScript. Configure the backend API's deployment protection deliberately; these workflows do not silently disable project security.

Fork PRs do not receive repository secrets under the normal `pull_request` trigger and cannot deploy a credential-backed stack. There is no privileged `pull_request_target` checkout of fork code.

## Verification

```bash
python3 -m unittest discover -s ci -v
uv run --directory backend --locked pytest -q
uv run --directory database --locked pytest -q
```
