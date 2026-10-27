# Stack deployment

## Entry points

`stack.yml` contains exactly three ordered calls: database → backend → frontend. The three reusable workflows run the same generic flow with the same step names. Only the provider helpers behind it differ: Neon for the database, Vercel for the applications. [COMPONENT-WORKFLOW.md](COMPONENT-WORKFLOW.md) defines the vocabulary (instance, address, version, fork, update, release, settings) and shows the flow. Provider orchestration uses JavaScript executed by `actions/github-script@v9.0.0`. Short, straight-line CLI tasks stay in inline Bash, such as the bare-Git comparison. Provider SDKs are a checked-in bundle; the Vercel CLI is a pnpm project owned by its composite action. Larger provider modules live alongside their actions. There are no Python controllers; native application build/test/migration commands remain normal tool invocations.

Each reusable workflow calls `.github/actions/component-changes` once, with only `path: database/`, `backend/`, or `frontend/`. Its inline Bash initializes a bare repository in the runner's per-job temporary directory and performs a shallow, blobless fetch of the event's `before`/`after` commits. `git diff --name-only --no-renames -z` compares their complete trees: both sides of renames are included, and filenames remain NUL-delimited until jq encodes them. No checkout action or worktree is used. Git authentication stays in the process environment rather than a URL, argument, or persisted credential config. The runner discards the temporary directory after the job.

Logs show the searched substring, escaped changed paths with forced `jq -C` colors, and the plain boolean match. Matching uses the uncolored JSON. There is no GitHub comparison API or 300-file cap: large diffs use their actual paths rather than forcing unrelated components to update. Git failures fail the step instead of reporting "unchanged".

Detection runs unconditionally. Pushes and PR `synchronize` events supply their latest `before`/`after` range. PR `opened`/`reopened` events have neither, so they compare the PR base with the PR merge commit; manual runs compare the current commit with itself, an empty diff. 🧭 Choose strategy exports `BUILD_NEEDED`: true when the component's path changed or a manual run's `update` checkbox is set. Only then does a component update: applications build and publish a new version, and the database migrates. Shared CI-only or documentation changes update nothing. Without an update, a job only runs 🌱 Ensure instance and 📝 Report instance: no checkout, toolchain, dependencies, quality gates, settings, release, or schema-diff comment.

The frontend is compiled once by its quality gates. 🔨 Package version lays that SSR/browser output out for Vercel's Build Output API with `packageFrontendServiceOutput` in `providers.cjs`. The packaging is needed because Vercel's Angular preset deploys only the static browser output, while the runtime `BACKEND_URL` reaches the browser through SSR. There is no separate frontend build controller or second Vercel frontend build; the explicit `frontend/vercel.json` disables Vercel's build command. The backend uses its Vercel project settings/Python builder without an empty root configuration file.

`database.yml`, `backend.yml`, and `frontend.yml` are manual-only entry points; each calls only its corresponding reusable workflow and has an `update` checkbox, checked by default. Unchecked, a run only ensures and reports the instance. The backend's settings read its database instance privately from Neon; the frontend's settings read the branch's READY backend deployment through Vercel. Missing dependencies fail with an instruction to run the relevant workflow; no reusable workflow invokes another component's CI/CD. The frontend receives no Neon secrets.

Local actions and reusable workflows use `$/` references, so they resolve to their defining repository's running commit without requiring a workspace checkout. Source is checked out only for an update. Runs without an update need no checkout, dependency installation, toolchain setup, or Vercel CLI.

Each caller owns one non-cancelling stack queue per Git ref, shared across automatic/manual entry points. Reusable jobs do not add nested queues. GitHub deployment-environment names are unchanged (including production environments); queue identity does not override their settings. Deployment-target selection uses GitHub's documented `case(...)` expression.

## Step names

Every configured workflow/composite step has an explicit emoji-prefixed name, and the reusable workflows name each [stage](COMPONENT-WORKFLOW.md#3-step-names) the same way. The same purpose uses the same prefix across jobs:

- 🔍 change detection; 🧭 strategy; 🌱 instance (find, reuse, fork); 🔐 settings.
- 📥 checkout and pulls; ⚙️ tool setup; 📦 dependencies.
- 🧹 lint; 🎨 formatting; 🧪 tests; 🔨 builds and packaging.
- 🚀 release; 📝 comments and reports; ❌ failures.

🧭 Choose strategy and 🌱 Ensure instance log their decisions: whether to update, and the found, forked, or released instance ID and address. Private connection values and tokens are not printed. `.cjs` modules live beside their action definitions; provider helpers are in `.github/actions/_shared/providers.cjs`. Actions expressions reach JavaScript through environment variables, never interpolated into executable code. Module calls do not return credential-bearing values to github-script's automatic result output.

`.github/actions/component-instance` runs one stage per call: `ensure`, `pull`, `package`, `settings`, `release`, or `report`. Its operations in `instance.cjs` use only generic names (`findInstance`, `forkInstance`, `resolveSettings`, `pullConfig`, `packageVersion`, `releaseUpdate`), which each component maps to provider helpers. Neon helpers say Database (`findDatabaseBranch`, `forkDatabaseBranch`, `getDatabaseSettings`), and Vercel helpers say Service (`findServiceDeployment`, `forkServiceDeployment`, `getBackendServiceSettings`, `publishServiceDeployment`, and so on). They use the official `@neon/sdk` client and `@vercel/sdk`'s tree-shakable standalone functions through `neonRequest` and `vercelRequest`, which create their client on first use, so frontend operations do not require Neon credentials. The SDKs own HTTP transport and pagination; the helpers retain exact branch selection and alias ownership, and fetched database URLs are masked in logs.

Operations share state through the job environment. 🌱 Ensure instance and 🚀 Release update export `INSTANCE_ID`, `INSTANCE_ADDRESS`, and `INSTANCE_RESULT`. 🔐 Resolve settings exports each setting, with database URLs masked, and lists their names in `INSTANCE_SETTINGS`. 📝 Report instance turns that state into the `instance_id`, `address`, and `result` outputs and writes one summary format for every component; a failed operation writes its error in the same format. No credential-bearing value is returned from `github-script` or crosses job outputs.

The SDKs are not installed at run time. `.github/actions/_shared/vendor` pins them (and esbuild) with a pnpm lockfile, and `pnpm run build` calls the esbuild CLI to bundle `sdk.mjs` into the checked-in `vendor/dist/sdk.cjs` (about 270 KB). `vendor/dist/` holds only that generated bundle. Provider steps call `actions/github-script` directly and `require` that bundle, so they need no install, cache, or registry access. After changing SDK versions, run `pnpm install` and `pnpm run build` in that directory and commit the regenerated bundle.

`.github/actions/setup-vercel-cli` contains its own `package.json`, pinned `pnpm-lock.yaml`, and pnpm version. It runs `pnpm/setup` with its action directory as `working-directory` and `require-lockfile: true`, so the CLI comes from the action snapshot rather than `frontend/` or any (possibly sparse) checkout. Hosted runners ship Node.js, so the action installs only pnpm and the CLI, which runs on the `node` already on PATH. Only the frontend's toolchain step installs Node.js, because it must restore the exact version locked by `frontend/package.json`. The CLI is not bundled like the SDKs: it loads deployment builders such as `@vercel/python` from its installed packages at run time. On Linux it runs as JavaScript, so its `pnpm-workspace.yaml` skips optional dependencies (platform binaries, including a 58.6 MB native CLI build) and denies esbuild's install script.

`pnpm/setup` replaces its `dest` on every run, so the CLI uses its own pnpm home under the runner's temporary directory, leaving an application job's pnpm store and runtime intact. Because that setup exports `PNPM_HOME` and puts its `dest` first on `PATH`, ⚙️ Set up Vercel CLI runs after the quality gates, just before packaging. There is no dependency cache: `pnpm/setup` hashes only lockfiles inside `GITHUB_WORKSPACE`, while action snapshots live outside it (without an explicit lockfile path it derives a `../` glob that `@actions/glob` rejects, so the action passes its absolute lockfile path). The trimmed install takes about 2s, so a manual cache would add steps for little gain. Runs without an update never set up the CLI.

All three pnpm projects (`frontend/`, the SDK bundle, and the CLI) set `trustLockfile: true`, as approved for this repository: installs skip pnpm's per-install registry re-verification of `minimumReleaseAge` and `trustPolicy`, so a lockfile resolved under a weaker policy is not rejected at install time.

## Repository setup

Secrets:

- `VERCEL_TOKEN`: access to both Vercel projects and aliases.
- `NEON_API_KEY`: access to the selected Neon project, branches, connection URIs, and schema comparison. Never place this value in a comment or repository variable.

Variables:

- `VERCEL_ORG_ID`, `VERCEL_BACKEND_PROJECT_ID`, `VERCEL_FRONTEND_PROJECT_ID`.
- `NEON_PROJECT_ID` (required; a repository variable or secret is accepted).
- `NEON_PARENT_BRANCH_ID` (optional; project default branch if unset). This must be the production source that copy-on-write previews are forked from.

🌱 Ensure instance looks for `preview/<git-branch>` first and forks a copy-on-write branch from the production source only when absent, inheriting supported compute defaults. Every preview database run ensures this branch, including runs without an update, because the backend's settings only look it up. A preview forked by a run without an update (for example after manual deletion) starts from production's schema; run the manual database workflow to apply the branch's revisions. A database update applies `alembic upgrade head` to its instance: only pending revisions are applied, with no reset or reapplication of completed revisions. There is no database quality gate yet. Connection strings are resolved privately in the consuming job: direct for Alembic, pooled for the backend. The official Neon Schema Diff action then updates the PR comment, comparing the preview with its parent; credentials never cross job outputs.

GitHub Actions owns the database previews, so database-first ordering is possible. The existing Vercel–Neon resource connection may remain, but avoid two competing preview-branching mechanisms. The backend's settings explicitly select the branch's database instance. Branch cleanup is not automatic; delete obsolete previews deliberately in Neon after closing branches.

## Updates, reuse, and forks

🌱 Ensure instance selects an application's latest READY deployment by project, branch, and target with one Vercel query (`limit=1`). Without an update, the job reuses it: no dependency lookup, checkout, CLI setup, validation, build, redeployment, alias change, or settings change. There is no source/config fingerprint override. An update validates, packages, and releases a new version. It needs no existing instance, so a branch's first update publishes directly instead of forking first.

When a branch has no preview of an application and no update is needed, 🌱 Ensure instance forks one. It redeploys the application's latest READY production deployment as the branch's preview with only its settings changed, then points the branch alias at it. There is no build, file download, or upload. Settings live only in deployment environment variables, never in the build output, so the fork gets the branch's database, CORS origin, WebAuthn origin, and backend URL. The public `createDeployment` schema has no `env` field; the fork sends the same undocumented `env` field that `vercel deploy --env` uses, and omits `target` so the redeployment is a preview, as `vercel redeploy --environment preview` does. The fork always sends every setting: a one-off check showed that overridden values replace the source's, while an omitted `DATABASE_URL` broke `/boats` instead of being inherited. Every service must have been deployed from `main` by this pipeline at least once, so production carries no baked settings.

There are no GitHub artifact uploads/downloads, archive extraction, retention/provenance metadata, private state files, or production-output restoration. Reuse keeps the existing deployment ID; only a branch without a preview gets a fork.

🔐 Resolve settings resolves the target-specific `DATABASE_URL`, explicit CORS origins, the backend's WebAuthn origin and relying-party ID, `BACKEND_URL`, and `FRONTEND_URL`, and 🚀 Release update binds them only as deployment environment variables. Vercel's valueless `--env NAME` arguments read process environment values, keeping credentials out of command arguments and job outputs. The native Vercel CLI handles Python `filePathMap` uploads directly; there is no custom file materialization or copying layer.

## URLs and runtime configuration

Each preview uses stable, project-and-branch-specific aliases: its address. A commit SHA alone cannot replace this routing identity: a backend-only push must not change the frontend's existing backend URL, and an unchanged frontend must not need a new deployment or CORS origin. Vercel's immutable deployment URL and recorded Git metadata already identify individual versions. Before the backend's settings grant CORS access, the frontend address is reserved/ownership-checked; on first reservation the alias temporarily points at the existing production frontend until the preview is released or forked. This is a provider hostname reservation, not a call to frontend CI or a frontend build/deployment. Runs without an update do not alter aliases, except that a fork receives its branch alias. Wait for the entire stack run to be green before using it. Existing aliases are never taken from another project.

The backend exposes `/`, `/health`, `/boats`, and the passkey routes (`/register/passkey/*`, `/login/passkey/*`) directly, without an `/api` prefix, and allows exactly the corresponding stable frontend origin, with credentials. The passkey flow is cross-origin: the browser calls the backend with credentials, AuthTuna's cookies (including the session that carries each WebAuthn challenge) are `SameSite=None; Secure`, and `WEBAUTHN_ORIGIN`/`WEBAUTHN_RP_ID` name that frontend origin. Browsers that block third-party cookies, such as Safari by default, cannot complete it. AuthTuna keeps SQLite for now; on Vercel the file lives in each function instance's temporary directory, so registered passkeys do not survive cold starts or span instances. Open that stable URL from the GitHub Environment; an arbitrary deployment hostname is not implicitly trusted. The composable `provideBackendApiUrl` provider transfers the runtime backend URL from SSR to the browser. There is no runtime-config endpoint or preload request. Local development defaults to the explicit Portless backend/frontend origins without an environment file; deployment settings override those defaults.

Backend preview URLs must be accessible to browser API calls. Vercel team-login protection cannot be solved by exposing an automation bypass secret to JavaScript. Configure the backend API's deployment protection deliberately; these workflows do not silently disable project security.

The Vercel CLI waits for READY; 🚀 Release update then points the stable alias at the new version, and 📝 Report instance records the outputs and summary. There are no extra deployment probes or runtime-log debugging. Normal application lint, formatting, tests, and build checks remain in place. Provider/CLI failures still fail the run, and `component-instance` writes the failed operation's error to the job summary in the report's format. Quality gates (lint, formatting, tests, builds) run unless the job was cancelled, so each check reports its own failure, and a failed gate stops the release. Alias ownership checks are retained, without retry frameworks or speculative recovery paths.

Jobs have no skip condition for pull requests from forked repositories. Those PRs still do not receive repository secrets under the normal `pull_request` trigger, so credential-backed operations fail with a missing-configuration error rather than publishing. There is no privileged `pull_request_target` checkout of their code.

## Verification

```bash
uv run --directory backend --locked pytest -q
```

Validate inline Bash with ShellCheck as part of workflow linting.
