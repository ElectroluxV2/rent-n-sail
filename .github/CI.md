# Stack deployment

## Entry points

`stack.yml` contains exactly three ordered calls: database → backend → frontend. CI/CD orchestration is JavaScript executed by `actions/github-script@v9.0.0`; there are no Bash/Python controllers. JavaScript modules live beside their composite definitions and use the injected GitHub client, workflow context, Actions core, and exec toolkit. Native application build/test/migration commands remain normal tool invocations.

Each reusable workflow calls `.github/actions/component-changes` once, with only `path: database/`, `backend/`, or `frontend/`. The action reads `before`/`after` from the injected event context, fetches GitHub comparison metadata with its pre-authenticated client, and performs substring matching in JavaScript. No Git command or checkout runs in the detector. The event supplies SHAs, not file lists; GitHub's API supplies the changed filenames, including previous names for renames. Logs show the searched substring, JSON-escaped changed paths with forced `jq -C` colors, and match result. jq is used only to display colored JSON, not to orchestrate the workflow. Data used for matching/output remains uncolored. At GitHub's 300-file cap, the action logs the limit and returns `changed=true` for any requested path, since further matching files may have been truncated. Below the cap, actual paths decide the result. Missing SHAs, API errors, and non-forward comparisons still fail rather than silently meaning "unchanged".

Callers invoke detection for pushes and PR `synchronize` events. Initial PR `opened`/`reopened` events explicitly run full application validation/builds; manual application runs use their existing build checkbox. These choices are outside the detector. Application build decisions use only the latest push, not the cumulative PR diff. Shared CI-only or documentation changes do not implicitly rebuild applications. Database change detection is informational: the database job always applies pending migrations.

The frontend is compiled once during validation. The deployment action packages that existing SSR/browser output directly using Vercel's Build Output API. There is no separate frontend build controller or second Vercel frontend build; `frontend/vercel.json` disables Vercel's build command. Backend output still uses Vercel's Python builder.

`database.yml`, `backend.yml`, and `frontend.yml` are manual-only entry points; each calls only its corresponding reusable workflow. Manual application runs default to a build. Backend credentials are read privately from the matching Neon branch; the frontend reads its matching READY backend deployment through Vercel. Missing dependencies fail with an instruction to run the relevant workflow; no reusable workflow invokes another application's CI/CD. The frontend receives no Neon secrets.

Local actions and reusable workflows use `$/` references, so they resolve to their defining repository's running commit without requiring a workspace checkout. Source is fetched only before application validation/builds or database migration tools; provider discovery runs from downloaded action snapshots. Both automatic and manual reuse-only application runs need no checkout. Production-output restoration checks out deployment configuration only after selecting that path, and an existing validated frontend build is never erased by a redundant checkout.

Every target is serialized across automatic/manual runs with a non-cancelling queue. Each application/database also has a shared per-target concurrency group and a GitHub Environment.

## Step names

Every configured workflow/composite step has an explicit emoji-prefixed name. The same purpose uses the same prefix across jobs:

- 📥 fetch/checkout/restore; 📤 upload/cache save.
- ⚙️ tool setup; 📦 dependency installation; 🗜️ artifact packaging.
- 🔍 change detection; 🧭 path/reference selection; 🔗 resource resolution; 🌱 branch preparation; 🔐 credentials.
- 🧹 lint; 🎨 formatting; 🧪 tests; 🔨 builds.
- 🚀 publication/migrations; 📝 reports; ❌ failures.

Selection and resource-resolution steps log their decisions: full build/migration versus reuse, preview branch creation/reuse, selected production parent/database reference, and chosen deployment IDs/URLs. Private connection values and tokens are not printed. `.cjs` modules live beside their action definitions; shared provider/command helpers are in `.github/actions/_shared`. Actions expressions reach JavaScript through environment variables, never interpolated into executable code. Module calls do not return credential-bearing values to github-script's automatic result output. Package/build subprocesses do not receive github-script token inputs. Regression tests run locally with Node's built-in test runner, not as an extra workflow step.

## Repository setup

Secrets:

- `VERCEL_TOKEN`: access to both Vercel projects and aliases.
- `NEON_API_KEY`: access to the selected Neon project, branches, connection URIs, and schema comparison. Never place this value in a comment or repository variable.

Variables:

- `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID`, `VERCEL_FRONTEND_PROJECT_ID`.
- `NEON_PROJECT_ID` (required; a repository variable or secret is accepted).
- `NEON_PARENT_BRANCH_ID` (optional; project default branch if unset). This must be the production parent intended for copy-on-write previews.
- `NEON_DATABASE_NAME` / `NEON_ROLE_NAME` (optional; `neondb` / `neondb_owner`).

The Neon REST resolver checks for `preview/<git-branch>` first and creates a copy-on-write branch from production only when absent, inheriting supported compute defaults. The database job always runs `alembic upgrade head` on the selected branch: only pending revisions are applied, with no reset or reapplication of completed revisions. There is no migration-test step. Connection strings are resolved privately in the consuming job: direct for Alembic, pooled for the backend. The official Neon Schema Diff action updates the PR comment after migrations; credentials never cross job outputs.

GitHub Actions now owns explicit preview branch preparation so database-first ordering is possible. The existing Vercel–Neon resource connection may remain, but avoid two competing preview-branching mechanisms. Workflow runtime bindings explicitly select the prepared branch. Branch cleanup is not automatic; delete obsolete previews deliberately in Neon after closing branches.

## Selective builds and portable output

For an unchanged application, the resolver checks for an existing READY deployment for the current branch first. If present, it reports the existing URL and stops: no other application's dependency lookup, CLI setup, application validation, clone, rebuild, redeployment, alias change, or credential rebind—even when source/configuration has changed since an earlier unsuccessful run. This is the requested per-push policy; there is no source/config fingerprint override. Only when that preview is absent does it restore production's retained compiled output and bind it to the preview environment. Changed applications run their own full validation/build path.

Vercel's [documented create-deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment) describes `deploymentId` as a new build. Promotion changes production traffic, not preview runtime configuration. Until a supported zero-build clone endpoint is available, a small GitHub artifact containing compiled Build Output is the portable fallback; no OCI registry is used.

The archive is retained for 90 days. Deployment metadata identifies its immutable artifact ID, run, and name. Restoration validates those references and repository provenance. It contains only the public Build Output v3 contract (`config.json`, functions, static files), not target-bound CLI `builds.json`, diagnostics, or caches. Python `filePathMap` entries are materialized into each function, including application code and vendored dependencies. Tar extraction rejects traversal. Checkout-local build symlinks are materialized; external symlinks are rejected. The versioned artifact contract rejects earlier incomplete formats.

Compilation intentionally does not load the private environment downloaded by `vercel pull`; target-specific bindings belong at runtime. Artifacts exclude `.env*` files and runtime credentials. Only an allowlist of transport-neutral runtime hints is retained in function metadata. Known credential bytes in other output files cause upload to fail. Target-specific `DATABASE_URL`, explicit CORS origins, `BACKEND_URL`, and `FRONTEND_URL` are applied only **after** the portable artifact has been uploaded, both to function metadata and explicitly to deployment scope. Vercel's valueless `--env NAME` arguments read values from the process environment, so credentials do not appear in command arguments. Raw database credentials never cross job outputs.

An existing production deployment created before this artifact contract has no reusable artifact. Bootstrap each application once with its manual workflow and `build=true` (after the workflow files reach the default branch), or let the first changed production build create one. Missing/expired artifacts fail with an actionable message rather than triggering a hidden rebuild.

## URLs and runtime configuration

Each preview uses stable, project-and-branch-specific aliases. Before granting CORS access for a new backend publication, the frontend origin is reserved/ownership-checked; on first reservation the alias temporarily points at the existing production frontend until the preview is published. This is a provider hostname reservation, not a call to frontend CI or a frontend build/deployment. Reuse-only runs do not alter aliases. Wait for the entire stack run to be green before using it. Existing aliases are never taken from another project.

The backend exposes `/`, `/health`, and `/boats` directly, without an `/api` prefix, and allows exactly the corresponding stable frontend origin. Open that stable URL from the GitHub Environment; an arbitrary deployment hostname is not implicitly trusted. The composable `provideBackendApiUrl` provider transfers the runtime backend URL from SSR to the browser. There is no runtime-config endpoint or preload request. Local development defaults to the explicit Portless backend/frontend origins without an environment file; deployment runtime bindings override those defaults.

Backend preview URLs must be accessible to browser API calls. Vercel team-login protection cannot be solved by exposing an automation bypass secret to JavaScript. Configure the backend API's deployment protection deliberately; these workflows do not silently disable project security.

Publication waits for Vercel's READY status, assigns the stable URL, and records deployment outputs/summaries. Post-deployment HTTP/CORS/SSR probes and runtime-log debugging have been removed; deployment success does not claim an end-to-end browser validation. Normal lint, formatting, application tests, build checks, artifact provenance checks, and credential-safety checks remain in place. Existing READY previews are reused without CLI setup, as required by the no-op reuse policy.

Jobs have no fork-PR skip condition. Fork PRs still do not receive repository secrets under the normal `pull_request` trigger, so credential-backed operations fail with a missing-configuration error rather than publishing. There is no privileged `pull_request_target` checkout of fork code.

## Verification

```bash
node --test .github/tests/cicd.test.cjs
uv run --directory backend --locked pytest -q
```
