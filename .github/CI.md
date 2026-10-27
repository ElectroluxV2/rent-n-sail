# Stack deployment

## Entry points

`stack.yml` contains exactly three ordered calls: database → backend → frontend. Provider orchestration uses JavaScript executed by `actions/github-script@v9.0.0`. Short, straight-line CLI tasks stay in inline Bash, such as the bare-Git comparison. Provider SDKs are a checked-in bundle; the Vercel CLI is a pnpm project owned by its composite action. Larger provider/deployment modules live alongside their actions. There are no Python controllers; native application build/test/migration commands remain normal tool invocations.

Each reusable workflow calls `.github/actions/component-changes` once, with only `path: database/`, `backend/`, or `frontend/`. Its inline Bash initializes a bare repository in the runner's per-job temporary directory and performs a shallow, blobless fetch of the event's `before`/`after` commits. `git diff --name-only --no-renames -z` compares their complete trees: both sides of renames are included, and filenames remain NUL-delimited until jq encodes them. No checkout action or worktree is used. Git authentication stays in the process environment rather than a URL, argument, or persisted credential config. The runner discards the temporary directory after the job.

Logs show the searched substring, escaped changed paths with forced `jq -C` colors, and the plain boolean match. Matching uses the uncolored JSON. There is no GitHub comparison API or 300-file cap: large diffs use their actual paths rather than forcing unrelated applications to build. Git failures fail the step instead of reporting "unchanged".

Detection runs unconditionally. Pushes and PR `synchronize` events supply their latest `before`/`after` range; when no push range exists, both endpoints default to the current commit, producing an empty diff. Initial PR `opened`/`reopened` events explicitly run full application validation/builds; manual application runs use their existing build checkbox. These build choices remain outside the detector. Shared CI-only or documentation changes do not implicitly rebuild applications. Database change detection is informational: the database job always applies pending migrations.

The frontend is compiled once during validation. The deployment action packages that existing SSR/browser output directly using Vercel's Build Output API. There is no separate frontend build controller or second Vercel frontend build; the explicit `frontend/vercel.json` disables Vercel's build command. The backend uses its Vercel project settings/Python builder without an empty root configuration file.

`database.yml`, `backend.yml`, and `frontend.yml` are manual-only entry points; each calls only its corresponding reusable workflow. Manual application runs default to a build. Backend credentials are read privately from the matching Neon branch; the frontend reads its matching READY backend deployment through Vercel. Missing dependencies fail with an instruction to run the relevant workflow; no reusable workflow invokes another application's CI/CD. The frontend receives no Neon secrets.

Local actions and reusable workflows use `$/` references, so they resolve to their defining repository's running commit without requiring a workspace checkout. Source is checked out only before application validation/builds or database migration tools. Both automatic and manual reuse-only application runs need no checkout, dependency installation, toolchain setup, or Vercel CLI.

Each caller owns one non-cancelling stack queue per Git ref, shared across automatic/manual entry points. Reusable jobs do not add nested queues. GitHub deployment-environment names are unchanged (including production environments); queue identity does not override their settings. Deployment-target selection uses GitHub's documented `case(...)` expression.

## Step names

Every configured workflow/composite step has an explicit emoji-prefixed name. The same purpose uses the same prefix across jobs:

- 📥 fetch/checkout/restore; 📤 upload/cache save.
- ⚙️ tool setup; 📦 dependency installation.
- 🔍 change detection; 🧭 path/reference selection; 🔗 resource resolution; 🌱 branch preparation; 🔐 credentials.
- 🧹 lint; 🎨 formatting; 🧪 tests; 🔨 builds.
- 🚀 publication/migrations; 📝 reports; ❌ failures.

Selection and resource-resolution steps log their decisions: full build/migration versus reuse, preview branch creation/reuse, selected production parent/database reference, and chosen deployment IDs/URLs. Private connection values and tokens are not printed. `.cjs` modules live beside their action definitions; shared provider/command helpers are in `.github/actions/_shared`. Actions expressions reach JavaScript through environment variables, never interpolated into executable code. Module calls do not return credential-bearing values to github-script's automatic result output. Package/build subprocesses do not receive github-script token inputs. Regression tests run locally with Node's built-in test runner, not as an extra workflow step.

Provider callers use high-level helpers such as `getDatabasePreviewFor`, `getApplicationDeploymentFor`, and `getApplicationRuntimeFor`, implemented with the official `@neon/sdk` client and `@vercel/sdk`'s tree-shakable standalone functions. The SDKs own HTTP transport and pagination; the helpers retain exact branch selection, alias ownership, and credential masking. Clients are loaded lazily, so frontend/reuse operations do not require Neon credentials.

The SDKs are not installed at run time. `.github/actions/_shared/vendor` pins them (and esbuild) with a pnpm lockfile, and `pnpm run build` bundles them into the checked-in `vendor/sdk.cjs` (about 270 KB) plus `THIRD_PARTY_NOTICES.txt` with each bundled package's license. The hand-written sources live in `vendor/src/`; the generated `sdk.cjs` and `THIRD_PARTY_NOTICES.txt` stay at the vendor root. Provider steps call `actions/github-script` directly and `require` that bundle, so they need no install, cache, or registry access. After changing SDK versions, run `pnpm install` and `pnpm run build` in that directory and commit both generated files; a local test fails if they differ from a rebuild.

`.github/actions/setup-vercel-cli` contains its own `package.json`, pinned `pnpm-lock.yaml`, and pnpm version. It runs `pnpm/setup` with its action directory as `working-directory` and `require-lockfile: true`, so the CLI comes from the action snapshot rather than `frontend/` or any (possibly sparse) checkout, and the action receives no provider/database credentials. Hosted runners ship Node.js, so the action installs only pnpm and the CLI, which runs on the `node` already on PATH. Only the frontend build installs Node.js, because it must restore the exact version locked by `frontend/package.json`. The CLI is not bundled like the SDKs: it loads deployment builders such as `@vercel/python` from its installed packages at run time. On Linux it runs as JavaScript, so its `pnpm-workspace.yaml` skips optional dependencies (platform binaries, including a 58.6 MB native CLI build) and denies esbuild's install script.

`pnpm/setup` replaces its `dest` on every run, so the CLI uses its own pnpm home under the runner's temporary directory, leaving an application job's pnpm store and runtime intact. There is no dependency cache: `pnpm/setup` hashes only lockfiles inside `GITHUB_WORKSPACE`, while action snapshots live outside it (without an explicit lockfile path it derives a `../` glob that `@actions/glob` rejects, so the action passes its absolute lockfile path). The trimmed install takes about 2s, so a manual cache would add steps for little gain. Reuse-only runs never set up the CLI.

All three pnpm projects (`frontend/`, the SDK bundle, and the CLI) set `trustLockfile: true`, as approved for this repository: installs skip pnpm's per-install registry re-verification of `minimumReleaseAge` and `trustPolicy`, so a lockfile resolved under a weaker policy is not rejected at install time.

The Neon composite dispatches its three operations through an inline object of async handlers. It exposes branch IDs as outputs and exports the masked migration URI only to the consuming job environment; no credential-bearing handler value is returned from `github-script`.

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

## Selective builds and deployment reuse

For an unchanged application, one Vercel query selects its latest READY deployment by project, branch, and target (`limit=1`). The action reports that deployment ID/URL and stops: no dependency lookup, checkout, CLI setup, validation, build, redeployment, alias change, or credential rebind. There is no source/config fingerprint override. Changed applications run their own validation/build/publication path.

PR opening/reopening builds both applications, establishing the previews for later no-op runs. If a READY deployment is missing (for example after manual deletion), run that application's manual workflow once with `build=true`. The no-change path never falls back to another branch or production database bindings, and never silently rebuilds.

There are no GitHub artifact uploads/downloads, archive extraction, retention/provenance metadata, private state files, or production-output restoration. Reuse means keeping the existing deployment ID, not calling Vercel's redeploy endpoint (which creates a new deployment/build).

Compilation does not load the private environment downloaded by `vercel pull`. Publication resolves target-specific `DATABASE_URL`, explicit CORS origins, the backend's WebAuthn origin and relying-party ID, `BACKEND_URL`, and `FRONTEND_URL` and binds them to function metadata and deployment scope. Vercel's valueless `--env NAME` arguments read process environment values, keeping credentials out of command arguments and job outputs. The native Vercel CLI handles Python `filePathMap` uploads directly; there is no custom file materialization or copying layer.

## URLs and runtime configuration

Each preview uses stable, project-and-branch-specific aliases. A commit SHA alone cannot replace this routing identity: a backend-only push must not change the frontend's existing backend URL, and an unchanged frontend must not need a new deployment or CORS origin. Vercel's immutable deployment URL and recorded Git metadata already identify individual builds. Before granting CORS access for a new backend publication, the frontend origin is reserved/ownership-checked; on first reservation the alias temporarily points at the existing production frontend until the preview is published. This is a provider hostname reservation, not a call to frontend CI or a frontend build/deployment. Reuse-only runs do not alter aliases. Wait for the entire stack run to be green before using it. Existing aliases are never taken from another project.

The backend exposes `/`, `/health`, `/boats`, and the passkey routes (`/register/passkey/*`, `/login/passkey/*`) directly, without an `/api` prefix, and allows exactly the corresponding stable frontend origin, with credentials. The passkey flow is cross-origin: the browser calls the backend with credentials, AuthTuna's cookies (including the session that carries each WebAuthn challenge) are `SameSite=None; Secure`, and `WEBAUTHN_ORIGIN`/`WEBAUTHN_RP_ID` name that frontend origin. Browsers that block third-party cookies, such as Safari by default, cannot complete it. AuthTuna keeps SQLite for now; on Vercel the file lives in each function instance's temporary directory, so registered passkeys do not survive cold starts or span instances. Open that stable URL from the GitHub Environment; an arbitrary deployment hostname is not implicitly trusted. The composable `provideBackendApiUrl` provider transfers the runtime backend URL from SSR to the browser. There is no runtime-config endpoint or preload request. Local development defaults to the explicit Portless backend/frontend origins without an environment file; deployment runtime bindings override those defaults.

Backend preview URLs must be accessible to browser API calls. Vercel team-login protection cannot be solved by exposing an automation bypass secret to JavaScript. Configure the backend API's deployment protection deliberately; these workflows do not silently disable project security.

The Vercel CLI waits for READY; publication then assigns the stable URL and records outputs/summaries. There are no extra deployment probes or runtime-log debugging. Normal application lint, formatting, tests, and build checks remain in place. Provider/CLI failures still fail the run; credential redaction and alias ownership checks are retained, without retry frameworks or speculative recovery paths.

Jobs have no fork-PR skip condition. Fork PRs still do not receive repository secrets under the normal `pull_request` trigger, so credential-backed operations fail with a missing-configuration error rather than publishing. There is no privileged `pull_request_target` checkout of fork code.

## Verification

```bash
pnpm --dir .github/actions/_shared/vendor install --frozen-lockfile
node --test .github/tests/*.test.cjs
uv run --directory backend --locked pytest -q
```

The local tests execute the actual inline YAML scripts. Validate inline Bash with ShellCheck as part of workflow linting.
