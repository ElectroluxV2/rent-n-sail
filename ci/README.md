# Stack deployment

## Entry points

`automatic.yml` contains exactly three ordered calls: database → backend → frontend. All CI/CD orchestration uses Bash, jq, Git, curl, and the provider CLIs; there is no Python controller.

Each reusable workflow calls `.github/actions/component-changes` once, with only `path: database/`, `backend/`, or `frontend/`. The action reads `before`/`after` from `$GITHUB_EVENT_PATH`, runs a NUL-delimited Git diff, and uses jq's `contains` to output `changed=true/false`. It includes additions, deletions, both sides of renames, and every commit in the push. It does not handle event types, resolve branches, accept build overrides, check deployment fingerprints, or implement fallbacks. Missing SHAs/history fail instead of silently meaning "unchanged". Checkouts use `fetch-depth: 0`.

Callers invoke detection for pushes and PR `synchronize` events. Initial PR `opened`/`reopened` events explicitly run full validation/builds; manual runs use their existing build checkbox. These choices are outside the detector. Subsequent decisions use only the latest push, not the cumulative PR diff. Shared CI-only or documentation changes do not implicitly rebuild applications.

The selected frontend production build is compiled once during validation. Vercel packaging reuses that validated output in the same job; standalone `build:vercel` still runs Angular's build first.

`database.yml`, `backend.yml`, and `frontend.yml` are manual-only entry points; each calls only its corresponding reusable workflow. Manual application runs default to a build. Backend credentials are read privately from the matching Neon branch; the frontend reads its matching READY backend deployment through Vercel. Missing dependencies fail with an instruction to run the relevant workflow; no reusable workflow invokes another application's CI/CD. The frontend receives no Neon secrets.

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

The Neon REST resolver checks for `preview/<git-branch>` first and creates a copy-on-write branch from production only when absent, inheriting supported compute defaults. Database changes select the migration/test path; unchanged databases keep their existing preview without rerunning migrations or schema-comment updates. Connection strings are resolved privately in the consuming job: direct for Alembic, pooled for the backend. The official Neon Schema Diff action updates the PR comment after the selected migration path; credentials never cross job outputs.

GitHub Actions now owns explicit preview branch preparation so database-first ordering is possible. The existing Vercel–Neon resource connection may remain, but avoid two competing preview-branching mechanisms. Workflow runtime bindings explicitly select the prepared branch. Branch cleanup is not automatic; delete obsolete previews deliberately in Neon after closing branches.

## Selective builds and portable output

For an unchanged application, the resolver checks for an existing READY deployment for the current branch first. If present, it reports the existing URL and stops: no other application's dependency lookup, CLI setup, validation/smoke tests, clone, rebuild, redeployment, alias change, or credential rebind—even when source/configuration has changed since an earlier unsuccessful run. This is the requested per-push policy; there is no source/config fingerprint override. Only when that preview is absent does it restore production's retained compiled output and bind it to the preview environment. Changed applications run their own full validation/build path.

Vercel's [documented create-deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment) describes `deploymentId` as a new build. Promotion changes production traffic, not preview runtime configuration. Until a supported zero-build clone endpoint is available, a small GitHub artifact containing compiled Build Output is the portable fallback; no OCI registry is used.

The archive is retained for 90 days. Deployment metadata identifies its immutable artifact ID, run, and name. Restoration validates those references and repository provenance. It contains only the public Build Output v3 contract (`config.json`, functions, static files), not target-bound CLI `builds.json`, diagnostics, or caches. Python `filePathMap` entries are materialized into each function, including application code and vendored dependencies. Tar extraction rejects traversal. Checkout-local build symlinks are materialized; external symlinks are rejected. The versioned artifact contract rejects earlier incomplete formats.

Compilation intentionally does not load the private environment downloaded by `vercel pull`; target-specific bindings belong at runtime. Artifacts exclude `.env*` files and runtime credentials. Only an allowlist of transport-neutral runtime hints is retained in function metadata. Known credential bytes in other output files cause upload to fail. Target-specific `DATABASE_URL`, explicit CORS origins, `BACKEND_URL`, and `FRONTEND_URL` are applied only **after** the portable artifact has been uploaded, both to function metadata and explicitly to deployment scope. Vercel's valueless `--env NAME` arguments read values from the process environment, so credentials do not appear in command arguments. Raw database credentials never cross job outputs.

An existing production deployment created before this artifact contract has no reusable artifact. Bootstrap each application once with its manual workflow and `build=true` (after the workflow files reach the default branch), or let the first changed production build create one. Missing/expired artifacts fail with an actionable message rather than triggering a hidden rebuild.

## URLs and runtime configuration

Each preview uses stable, project-and-branch-specific aliases. Before granting CORS access for a new backend publication, the frontend origin is reserved/ownership-checked; on first reservation the alias temporarily points at the existing production frontend until the preview is published. This is a provider hostname reservation, not a call to frontend CI or a frontend build/deployment. Reuse-only runs do not alter aliases. Wait for the entire stack run to be green before using it. Existing aliases are never taken from another project.

The backend exposes `/`, `/health`, and `/boats` directly, without an `/api` prefix, and allows exactly the corresponding stable frontend origin. Open that stable URL from the GitHub Environment; an arbitrary deployment hostname is not implicitly trusted. The frontend receives the resolved backend URL as runtime configuration, not a compiled constant. SSR transfers its root URL to Angular; a client-rendered entry loads `/runtime-config.json` before bootstrap, fixing the missing-URL failure without a frontend rebuild when backend bindings change.

Backend preview URLs must be accessible to browser API calls. Vercel team-login protection cannot be solved by exposing an automation bypass secret to JavaScript. Configure the backend API's deployment protection deliberately; these workflows do not silently disable project security.

For newly published deployments (build or production-output restore), CI verifies the inventory/explicit CORS header and frontend runtime-config URL using authenticated `vercel curl`, which keeps protection bypass handling inside the trusted CLI. After frontend publication it also checks anonymous backend root GET/preflight requests with the exact frontend origin, without cookies or bypass credentials, then retrieves the frontend SSR page and verifies that Angular serialized a successful backend HttpClient response—not merely its URL. A sign-in redirect fails with an actionable Deployment Protection error. These checks do not change access policy or expose a bypass token to the client. Existing READY previews are reused without these checks or CLI setup, as required by the no-op reuse policy; a successful reuse run does not claim a fresh SSR validation.

Fork PRs do not receive repository secrets under the normal `pull_request` trigger and cannot deploy a credential-backed stack. There is no privileged `pull_request_target` checkout of fork code.

## Verification

```bash
bash ci/test.sh
shellcheck ci/*.sh .github/actions/component-changes/detect.sh
uv run --directory backend --locked pytest -q
uv run --directory database --locked pytest -q
```
