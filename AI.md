# AI usage docs

## 2026-10-27 — Stack timing after merging main; `/boats` fix

- AI assistance: OpenCode (Claude Opus 5.5) ran `stack.yml` through PR #14 after merging main. Run `40520812604` passed in 4m18s: database 22s, backend 180s, and frontend 46s, with about 3s between jobs. The backend's publish took 150s because Vercel installed the new AuthTuna dependencies from scratch. A follow-up backend build (`40521689277`) published in 23.7s, and its job took 52s. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- The deployed `/boats` returned 500 after the merge. A local Postgres container reproduced it: with its default SQLite database, AuthTuna registers its `PRAGMA foreign_keys=ON` listener on every SQLAlchemy engine, so psycopg connections failed. `backend/main.py` now moves that listener to AuthTuna's own engine. Locally, `/boats` then returned 200, and Ruff and the 9 backend tests pass.
- Validation: signed, GitHub-Verified commit `d095fdc` passed stack run `40522452774` in 1m15s: database 21s, backend build 37s (publish 18.0s with Vercel's dependency cache warm), and frontend reuse 8s. The preview's `/boats` returned data again with the exact-origin CORS header, and SSR rendered the backend response.

## 2026-10-27 — Merged main's passkey flow and unit tests into the CI/CD branch

- AI assistance: OpenCode (Claude Opus 5.5) merged `main` (`d6f0219` passkey flow, `5ef8492` unit-test steps) into `cd` with the user's approval, so PR #14 can run `stack.yml`. This branch's manual entry-point workflows are kept, and their reusable workflows already run pytest and the Angular tests. The root `vercel.json` stays deleted, and the frontend keeps its runtime backend URL provider. `backend/main.py` combines this branch's app factory, CORS allowlist, and `/`, `/health`, and `/boats` routes with main's AuthTuna settings, session middleware, Scalar reference, and passkey routers, mounted without `/api`. `scalar-fastapi` moved to runtime dependencies because Vercel's Python builder runs `uv sync --no-dev`. The re-locked `uv.lock` keeps every version pinned by either side. The connectivity check stays on `/` (`Hello`), and the passkey component resolves endpoints against the backend URL without a double slash. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Known gap: main's passkey flow relied on same-origin `/api` routing and session cookies. With separate frontend and backend projects, it needs either a frontend `/api` proxy route or credentialed CORS, plus deployment values for AuthTuna's database, `FERNET_KEYS`, and WebAuthn origin. This is left for a follow-up decision.
- Validation: the backend's locked sync, Ruff lint and format, and 9 pytest tests pass. The frontend's ESLint, oxfmt, 5 Angular tests, and production build pass, as do the 33 CI tooling tests.

## 2026-10-27 — Trimmed pnpm Vercel CLI without a cache

- AI assistance: OpenCode (Claude Opus 5.5) measured the user's simpler alternative to the cached npm setup. `setup-vercel-cli` uses pnpm again, without a dependency cache. It has no `devEngines.runtime` (the CLI runs on the runner's Node.js) and sets `optional: false`, `allowBuilds: esbuild: false`, and `trustLockfile: true`. The regenerated lockfile has no Node runtime entry. A local frozen install added 270 packages, none of them optional platform binaries; it ran no install scripts and skipped lockfile verification, and `vercel --version` reported 65.2.0. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Validation: signed, GitHub-Verified commit `67e191d` passed backend build `40516691912`, frontend build `40516709022`, and backend build `40516727360`. CLI setup took 1.94–2.29s on every run (0.83–1.01s to download pnpm, 0.88–1.2s to install). That compares with 1.36–1.82s for cached npm hits, 8.0s plus a 2.6s save for npm misses, and 4.1–6.4s before trimming. It met the user's ~2s threshold, so the simpler pnpm setup without cache steps is kept. The backend CLI ran on the runner's Node.js 24.21.0 and the frontend CLI on the frontend's locked 24.22.1. Live SSR, exact-origin CORS, and database-backed `/boats` checks passed.

## 2026-10-27 — Cached npm Vercel CLI on the runner's Node.js; trusted pnpm lockfiles

- AI assistance: OpenCode (Claude Opus 5.5) implemented the user's approved changes. `setup-vercel-cli` no longer uses pnpm. It pins `vercel@65.2.0` in an npm `package-lock.json`, generated against the public registry with `--before` set one day back to match pnpm's default release-age delay. It runs on the runner's preinstalled Node.js and npm, installs with `npm ci --omit=optional --ignore-scripts`, and caches the installed CLI with `actions/cache` under a key hashed from the action and its lockfile. The frontend keeps pnpm and still installs the exact Node.js version locked by `frontend/package.json`. `frontend/` and the SDK bundle set `trustLockfile: true`. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Verified locally that omitting optional dependencies is safe for our commands. The CLI loads its keyring binding and esbuild lazily, and the Node builders' bindings (`rolldown`, `oxc-*`) are not loaded for Python. With a bogus token, `vercel pull` and `vercel deploy --prebuilt` reached Vercel's API, and a backend `vercel build` produced `functions/fastapi.func` (Python 3.14, x86_64). The install is 279 packages (159 MB, or 20.4 MB as a zstd archive). Frozen pnpm installs pass without the supply-chain verification pass. All 33 tests, actionlint, ShellCheck, and action-lock verification pass.
- Validation: signed, GitHub-Verified commit `2253091` passed backend build `40514974240` (cache miss), frontend build `40514992711`, and backend build `40515011715` (both cache hits). CLI setup took 8.0s on the miss (7.6s of `npm ci`, plus about 2.6s after the job to save the 30 MB cache) and 1.36–1.82s on hits, versus 4.1–6.4s with pnpm. The cache stays because uncached npm is far slower than a hit. The backend CLI ran on the runner's Node.js 24.21.0 and the frontend CLI on the frontend's locked 24.22.1. With `trustLockfile`, the frontend's pnpm install took 0.45s instead of 1.8s. Live SSR, exact-origin CORS, and database-backed `/boats` checks passed.

## 2026-10-27 — Hand-written vendored SDK sources moved to `src/`

- AI assistance: OpenCode (Claude Opus 5.5) delegated the user's request to a subagent, which moved the hand-written `build.mjs` and `sdk.mjs` into `.github/actions/_shared/vendor/src/`. The generated `sdk.cjs` and `THIRD_PARTY_NOTICES.txt` stay at the vendor root next to the pnpm project files, so `providers.cjs` still loads `./vendor/sdk.cjs` and `.gitattributes` is unchanged. The build script path, drift test, a code comment, and `.github/CI.md` were updated. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Validation: OpenCode reviewed the diff and re-ran the checks. `sdk.mjs` and `THIRD_PARTY_NOTICES.txt` are byte-identical, the rebuilt `sdk.cjs` differs only in its banner line, and all 33 local tests pass.

## 2026-10-27 — Fastest Vercel CLI installation on hosted runners

- AI assistance: OpenCode (Claude Opus 5.5) broke down the Vercel CLI setup step in backend build `40506480402` and frontend build `40506509172`. It takes 4.1–6.4s: 0.75–1.0s to download pnpm, 1.1–2.4s to download Node 24 (58 MB) for `devEngines.runtime`, and 2.1–2.8s to install the CLI, including the 58.6 MB `@vercel/vc-native-linux-x64` binary. A 1.5s lockfile verification runs alongside the downloads. No code was changed. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- The ubuntu-26.04 image (20261012.163) has Node.js 24.21.0 but no Vercel CLI. Every CLI command ran as `Vercel CLI 65.2.0 (Node.js 24.22.1)`: the Linux native binary is used only after an opt-in, and automatic enrollment (`isVercelianFromLoadedTeams`) applies only to Vercel employees.
- Recommended removing `devEngines.runtime` and adding `ignoredOptionalDependencies: ["@vercel/vc-native-*"]` (estimated 2.5–3s). A local trial regenerated the lockfile with only the eight native packages and the Node runtime removed (377 → 368 entries), installed it frozen, and ran the CLI on Node. The trimmed install measured 186 MB, or 32.6 MB as a zstd archive.
- The fastest option is restoring that trimmed install from `actions/cache` and skipping pnpm on hits (estimated ~1s), at the cost of reintroducing cache steps. Rejected `trustLockfile` (pnpm advises against it when outside contributors can edit the lockfile), npm (it cannot skip only the native binary and lacks pnpm's supply-chain checks), downloading the native binary directly (Linux opt-in; builders would install outside the lockfile), and custom images (paid larger runners only).

## 2026-10-27 — Vercel CLI versus SDK-only deployment

- AI assistance: OpenCode (Claude Opus 5.5) assessed whether `@vercel/sdk` could replace the Vercel CLI and recommended keeping the CLI in build jobs. Reuse runs, deployment lookup, alias assignment, and Neon operations already use only the SDKs. The CLI remains for `vercel build` (backend) and `vercel deploy --prebuilt` (both applications), with `vercel pull` feeding them. No code was changed. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Backend build: a retained `vercel build` output contained `functions/fastapi.func` with the application source, a 99 MB `_vendor` (3,170 files, including CPython 3.14 x86_64 extension modules) with `vercel_runtime` 0.24.1, and a generated 43-line `vc__handler__python.py`. That handler configures `vercel_runtime` through private `__VC_HANDLER_*` environment variables, so replacing the builder means maintaining a copy of a private builder/runtime contract.
- Publishing: Vercel CLI 65.2.0 creates prebuilt deployments with a `?prebuilt=1` query parameter. Vercel's public OpenAPI does not define it, and the generated SDK's `createDeployment` accepts only the `forceNew`, `skipAutoDetectionConfirmation`, `teamId`, and `slug` query parameters. SDK-only publishing would need raw HTTP for that flag, our own file hashing and retrying uploads, and READY polling.
- The only documented SDK-only route is uploading source for a remote Vercel build. It moves the backend build from CI to Vercel, and per-deployment secrets would move into project environment variables because the public deployment API has no per-deployment environment. Each alternative adds more code than the CLI install saves (4–6.5s, build jobs only).

## 2026-10-27 — Vercel CLI caching status

- AI assistance: OpenCode (GPT-6.1 Sol) answered that the Vercel CLI is no longer cached: build jobs install it through `pnpm/setup` from the action-owned lockfile, while reuse runs skip it. Compared logged step durations: 4.1–6.5s uncached versus 4.7s for the former `actions/cache` path, because pnpm and Node are downloaded either way. No code was changed. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).

## 2026-10-27 — Checked-in provider SDK bundle; Vercel CLI stays installed

- AI assistance: OpenCode (GPT-6.1 Sol) implemented the user's proposal to bundle provider dependencies with esbuild. Added `.github/actions/_shared/vendor`, which pins `@neon/sdk@7.5.0`, `@vercel/sdk@1.28.51`, and `esbuild@0.28.2` with a pnpm lockfile. Its `build.mjs` writes the checked-in `sdk.cjs` (274 KB, 60 KB gzipped) and `THIRD_PARTY_NOTICES.txt`, because this public repository redistributes the bundled Apache-2.0/MIT code. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Used Vercel's tree-shakable standalone functions through a small adapter; a bundle of the full Vercel client measured 2.4 MB. Removed the provider-script wrapper and its pnpm install: provider steps call `actions/github-script` directly and need no install, cache, or registry access.
- Assessed bundling the Vercel CLI and kept it installed through pnpm/setup in build jobs only. Its published `dist` is already an esbuild bundle (317 chunks, 14 MB). It resolves builders such as `@vercel/python` by package name and `require`s them from disk, installing missing builders with npm at run time, and it ships platform binaries (a 162 MB native CLI binary on macOS; esbuild's 10 MB binary). Its installed graph is about 530 MB.
- Added tests for rebuild drift, license coverage, loading the copied bundle from a directory without `node_modules`, and install-free provider steps. Marked the generated files in `.gitattributes`.
- Validation: all 33 local tests, actionlint, and action-lock verification pass; the database workflow no longer needs `pnpm/setup`. Signed/GitHub-Verified commit `166e26b` passed backend build `40506480402`, frontend reuse `40506484709`, and frontend build `40506509172`. The provider step in the reuse run took 0.57s with no installation (the whole job took 6s). Only the Vercel CLI setup still installs with pnpm (4–6.5s, build jobs only). Live SSR, exact-origin CORS, and database-backed `/boats` checks passed.

## 2026-10-27 — Why pnpm/setup cannot cache action-owned lockfiles

- AI assistance: OpenCode (GPT-6.1 Sol) explained from pnpm/setup v3.1.1 source and its bundled `@actions/glob` code that the store cache key is the lockfile's `hashFiles` digest, which skips files outside `GITHUB_WORKSPACE`. Action snapshots live outside the workspace, so the digest is empty and `cache: true` throws. No code was changed. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).

## 2026-10-27 — pnpm-owned CI tooling and simpler change detection

- AI assistance: OpenCode (GPT-6.1 Sol) implemented the five new PR #14 review threads. Removed the change detector's cleanup trap and generated temporary directory, relying on the runner's per-job temporary directory, and replaced `base64 | tr` with `base64 -w0`. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Replaced both custom npm/cache setups with action-owned pnpm projects: `provider-script` and `setup-vercel-cli` now each commit `package.json` and `pnpm-lock.yaml`, and run `pnpm/setup` with their own action directory and a frozen lockfile. Vercel CLI setup no longer reads `frontend/`, so it works without or with a sparse checkout. It pins Node 24 and keeps the existing `esbuild` build allowance. Moved provider helpers beside the SDK project so normal package resolution replaces the custom dependency-directory loader.
- Verified in pnpm/setup v3.1.1 source that absolute action directories are supported, but its bundled cache hashing ignores lockfiles outside `GITHUB_WORKSPACE`; enabling `cache` would fail. The action also deletes its `dest`, so the tool actions use separate temporary pnpm homes to avoid clobbering the frontend job's pnpm store. Measured local cold installs: provider SDKs 5.4s; Vercel CLI 16.8s including Node.
- pnpm 12's minimum-release-age policy flagged the same-day `@vercel/sdk@1.28.53` and auto-added an exclusion. Pinned the four-day-old `@vercel/sdk@1.28.51` instead of committing a policy bypass; lockfiles contain only public-registry integrity entries.
- Live runs `40501232239`/`40501237204` (commit `621a0ca`) failed before installation: pnpm/setup always hashes the lockfile, and for an action outside the workspace it derives `../../_actions/...`, which `@actions/glob` rejects. Reproduced the same assertion locally by running the pinned pnpm/setup bundle with a cache endpoint enabled, then verified that an absolute `cache-dependency-path` installs both projects (SDKs, then Vercel CLI 65.2.0 on Node v24.22.1 with the allowed `esbuild` script) without touching the workspace. Added a regression assertion.
- Signed/GitHub-Verified fix `8e78cc2` passed frontend/backend build runs `40501755585`/`40501759870` and checkout-free reuse runs `40502049874`/`40502054666`. Runner timings without a store cache: Vercel CLI setup ~5.5s, provider SDK setup 1.5–2.0s. Tool installs used their own stores under the runner temp directory; the frontend job's pnpm cache save matched behavior already present in runs before this change. Live SSR, exact-origin CORS, and database-backed `/boats` checks passed. Replied to and resolved all five new threads; only the earlier SHA-only URL proposal remains open. Automatic PR CI is still blocked by unmerged `main` conflicts.

## 2026-10-27 — Official provider SDKs with a cached script wrapper

- AI assistance: OpenCode (GPT-6.1 Sol) followed the explicit SDK-adoption decision: removed `.github/provider-clients.md`, replaced custom fetch/pagination code with official `@vercel/sdk@1.28.53` and `@neon/sdk@7.5.0` calls, and kept the high-level provider interface and lazy client loading. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Added `.github/actions/provider-script`, a shared wrapper around `actions/github-script` with a separate npm manifest/lockfile, platform/Node/lockfile-keyed dependency caching, credential-free `npm ci --ignore-scripts` on misses, and same-job installation reuse. No SDK bundle or application checkout is required; application setup/build/deployment still stays skipped for unchanged previews.
- Updated provider tests to exercise SDK operation contracts and the actual installed clients, inline Neon dispatch, and cold/ready wrapper setup. Retained status-only SDK failures, alias ownership, explicit CORS, private database bindings, bare-Git comparison, and SSR packaging. No main integration or URL-identity change was made.
- Local validation: all 28 tests pass, including actual Node 24 SDK loading, status-only SDK errors, cold-install/ready-cache wrapper execution, all inline Neon operations, and real bare-repository comparisons. Inline Bash passed ShellCheck; YAML/action-lock, formatting, and diff checks pass. Dependencies were installed from the public registry using the host's existing system certificate trust; TLS verification was not disabled.
- Signed/GitHub-Verified commit `921e9fb` passed live backend run `40493270906`: the SDK cache missed, installed exactly three packages with scripts disabled, saved the cache, and completed real Neon/Vercel discovery and publication. Also picked up the empty root `vercel.json` review comment: removed the schema-only file and backend config override; the shared CLI helper adds a local config only when configured, retaining the frontend's meaningful build-disabled config.
- Live frontend reuse run `40493864734` hit and restored that same SDK cache, skipped npm installation and application checkout/build/publication, and reported the unchanged deployment ID. The local suite now has 29 passing tests, including backend default configuration and the frontend's explicit config arguments.
- Signed/GitHub-Verified commit `bad13da` passed backend run `40494448745` without the empty root config and frontend run `40494758799` with its explicit config and cached official SDKs. Live SSR returned the rendered backend response and correct transfer state, and backend CORS allowed exactly the stable frontend origin. All 29 tests, inline ShellCheck, actionlint/action-lock, formatting, and diff checks pass. Replied to/resolved both inline-script threads, the SDK-adoption thread, and the empty-config thread; only the previously discussed SHA-only URL proposal remains open. Automatic PR CI is still blocked by unmerged `main` conflicts; no merge/rebase was performed.

## 2026-10-27 — Inline the small action scripts

- AI assistance: OpenCode (GPT-6.1 Sol) implemented the two new PR #14 review comments by inlining the bare-Git detector in `component-changes/action.yml` and the Neon dispatcher in `neon-operation/action.yml`. Replaced the dispatcher switch with an object of async handlers, and removed the redundant `detect.sh` and `neon.cjs` files. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Updated tests to execute the actual inline YAML bodies, including all three Neon operations and their non-secret outputs/job-private migration credentials. Bare fetching, NUL-delimited paths, colored display/plain output, no-checkout reuse, and provider policy remain unchanged. No main integration or SDK/alias policy change was made.

## 2026-10-27 — Assess provider, naming, and short-Bash review comments

- AI assistance: OpenCode (GPT-6.1 Sol) assessed the five latest PR #14 review threads and the clarification that short, straightforward Bash is appropriate. Restored inline native Vercel CLI setup and replaced GitHub comparison-API code with a short bare-Git/NUL-delimited diff script, without a checkout action or worktree. Authentication stays out of URLs/arguments, colored JSON remains display-only, and complete Git trees remove the 300-file API limit. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Assessed commit-only aliases against selective deployment: changing backend URLs per SHA would strand unchanged frontend runtime bindings, while changing frontend origins would require extra backend CORS publications. Preserved the existing branch-stable aliases rather than breaking no-op reuse or adding alias-rebinding machinery.
- Investigated first-party provider clients and a high-level provider interface, with cited findings recorded under `.github`. No merge/rebase of newer `main` was started.
- A background research agent checked official SDK/package sources; the final assessment in `.github/provider-clients.md` records that `@vercel/sdk` and `@neon/sdk` exist, but require package installation or prebundling to run from downloaded composite snapshots. Kept native fetch private and replaced the generic public `Providers` methods with workflow-level helpers; deployment callers no longer handle REST paths, response shapes, alias reservation, or database-selection policy. Added exact-name Neon selection with documented API pagination.
- Validation: 24 local tests pass, including the actual short Bash setup scripts, real bare-repository rename/newline/large-diff cases, provider policy, private credentials, SSR packaging, and ordered workflows. ShellCheck, actionlint (existing modern-syntax/runner-label exceptions), action-lock, and diff checks pass. An authenticated bare fetch against the real GitHub repository also returned the expected change flag and removed its temporary repository without checking out source or exposing credentials.
- Picked up three additional comments arriving during validation: simplified all callers to one stack queue per Git ref, removed nested reusable-job queues, used documented `case(...)` expressions for target/environment selection, and removed the change-detection step condition. Events without a push range compare the current SHA with itself, while initial-PR/manual build policy remains explicit. Preserved existing production/preview deployment-environment names rather than silently changing environment settings.
- Pushed personally attributed, signed/GitHub-Verified commits `a62ab95` and `3fd5dc3`. Live backend build `40487659419`, backend/frontend reuse runs `40487659407`/`40487659803`, and latest frontend build/backend reuse runs `40488760582`/`40488760637` passed. The latter runs exercised unconditional bare-Git detection with the runner's token and native `case(...)` evaluation; reused applications did not check out/build/publish source. Live frontend SSR transferred a successful backend response and the expected URL, and backend CORS allowed exactly that frontend origin.
- Replied to all eight new review threads and resolved the six implementation requests. Left only the commit-SHA URL and SDK-adoption design suggestions open with explicit assessments, rather than assuming agreement to change selective-deployment behavior or add an SDK distribution build. PR #14 still conflicts with newer `main`; automatic PR CI remains blocked and no main integration was attempted.

## 2026-10-27 — Simplify deployment reuse and remove artifact machinery

- AI assistance: OpenCode (GPT-6.1 Sol) followed the request to preserve normal CI/CD behavior while reducing orchestration complexity. Removed the GitHub artifact upload/download/restore protocol, archive safety/retention/provenance machinery, private state files, Python output materialization, repeated mode plumbing, and custom provider retry/error wrappers. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Unchanged applications now perform a filtered latest-READY Vercel lookup and report the existing deployment ID/URL, with no build, publication, alias write, dependency lookup, checkout, or CLI setup. Initial PR opening/reopening still builds previews; a missing/deleted preview requires one explicit `build=true` run rather than a hidden rebuild or another environment's credentials. Vercel's redeploy-by-ID endpoint creates a new deployment/build, so it is deliberately not called for unchanged applications.
- Changed applications still validate/build independently and publish native prebuilt output with private runtime bindings. Retained the small Angular SSR output descriptor, exact CORS/alias ownership checks, secret masking, database-first ordering, unconditional pending migrations, summaries, step names, and checkout-free local action loading. Python file mappings are left to Vercel's native uploader.
- Local validation: the reduced 19-test orchestration suite passes, including read-only reuse, server-side latest-deployment filtering, Neon idempotence, private credentials, native Python mappings, SSR packaging, and the ordered stack. Alias ownership is checked for both preview and production targets. YAML/action-lock checks pass with the existing modern-syntax/runner-label exceptions.
- The orchestration JavaScript shrank from 952 to 453 lines (52%); the deployment composite went from 11 steps to 6. Signed/Verified commit `494df48` passed live no-build backend (`40428776264`) and frontend (`40428776113`) runs: only existing deployment resolution ran, with checkout, validation, CLI setup, build, and publication all skipped. The reduced SSR packager also passed an isolated HTTP/TransferState check.
- The full backend build/publication run `40428842897` passed without artifacts or custom Python mapping materialization. The published backend returned its healthy response and sample inventory through native Vercel-uploaded dependencies.
- The simplified frontend build/publication run `40429096670` passed, but live HTTP validation caught the copied CSR template being served as the homepage while `/index.html` correctly invoked SSR. Added a failing packaging regression, then excluded `index.csr.html` from public static output while retaining it inside the SSR bundle. No runtime fallback or deployment-debug workflow step was added.
- Signed/Verified fix `4d13c99` passed frontend run `40429548344`; the stable homepage now returns HTTP 200 with SSR-rendered backend data, the correct transferred backend URL, and its cached `Hello: World` response. Backend health, inventory, and exact-origin CORS checks also passed. All 19 local orchestration tests, formatting, YAML/action-lock verification, and diff checks pass. PR #14 has zero unresolved review threads; its automatic workflow remains blocked only by the existing unmerged `main` conflicts.

## 2026-10-27 — PR #14 review follow-up

- AI assistance: OpenCode (GPT-6.1 Sol) implemented the latest review comments: removed reusable job skip conditions, shared concurrency/environment names with YAML anchors, renamed the caller to `stack.yml`, and removed the obsolete migration test and Bash CI test script. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Removed the frontend build controller, its build-ready switch, and Vercel's automatic frontend build command. The colocated deployment action packages the existing validated Angular SSR/browser output without compiling it again or introducing an API discovery stub.
- Replaced runtime-config fetching, preload initialization, and missing-SSR error handling with the composable `provideBackendApiUrl` provider and SSR TransferState. Added explicit default Portless origins, removed mandatory local environment-file setup, simplified Portless commands, and documented `pnpm env use --global 24`.
- Preserved private deployment credentials, explicit CORS allowlists, retained compiled output, and checkout-free no-op preview reuse. No merge or rebase of newer `main` was performed.
- Validation: 33 Node orchestration tests, 5 frontend tests, backend tests (8 tests and 9 subtests), application lint/format checks, Angular production build, actionlint (existing modern-syntax/runner-label exceptions), action-lock verification, and diff checks passed. An isolated packaged SSR check rendered a backend fixture and transferred its URL; its initial raw-HTML URL assertion was corrected to parse Angular's escaped TransferState JSON. The JavaScript restore implementation also restored the actual retained backend v2 artifact successfully.
- Pushed signed/Verified commit `ec906e6`; manual backend run `40427968026` and frontend run `40428192095` passed. Replied to and resolved all 12 new review threads and resolved 30 older implemented threads; a complete query confirmed all 54 PR threads resolved. Automatic PR CI is still blocked by conflicts with newer `main`; no merge/rebase was started.

## 2026-10-27 — JavaScript orchestration through actions/github-script

- AI assistance: OpenCode (GPT-6.1 Sol) rewrote Bash CI/CD orchestration as colocated CommonJS modules executed with `actions/github-script@v9.0.0` (Node 24), using injected GitHub/context/core/exec interfaces. Migrated change detection, Neon/Vercel discovery and publication, artifact sanitization/materialization/restoration, CLI setup, selection outputs, and summaries. Native application tool commands remain unchanged. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Preserved the three-job caller, independent reusable workflows, checkout-free discovery/reuse, single-path detector, conservative 300-file policy, colored JSON, unconditional pending migrations, retained compiled-output protocol, step names, and credential isolation. No credential-bearing module result is returned to github-script outputs; action token inputs are stripped from application/package subprocesses.
- Replaced local Bash tests with Node's built-in test runner. Did not merge/rebase `main` or resolve its unrelated passkey/unit-test conflicts as part of this rewrite.

## 2026-10-27 — Colocated CI scripts and conservative large-change detection

- AI assistance: OpenCode (GPT-6.1 Sol) moved the Vercel deployment/artifact scripts beside their composite definition, gave the Neon composite its own colocated entry point, placed shared provider helpers in `.github/actions/_shared`, and moved local tests/docs under `.github`. Updated script invocations and documentation links. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Changed the requested API-cap policy: when GitHub returns 300 files, the detector logs the cap and returns `changed=true` for the requested substring instead of failing. This is conservative for each of the three users of the shared action; below the cap actual path matches still decide. No checkout or Git dependency was added to detection, and displayed JSON remains colored.
- Kept `Select database reference` unchanged as requested. Added regression coverage for below-cap versus capped comparisons and the relocated entry points.
- Validation: 46 local Bash checks, ShellCheck, actionlint (with documented syntax/runner-label exceptions), action-lock verification, formatting, and diff checks passed before submission.
- Pushed signed/Verified commit `8a0a71e`. Live PR validation is blocked by conflicts with newer `main` commits introducing the passkey flow (#13) and unit tests (#15). Fetched `main` and inspected conflicts with `git merge-tree` only; no merge/rebase or application conflict resolution has been started. Requested authorization before integrating those changes.

## 2026-10-27 — Database-reference step explanation

- AI assistance: OpenCode (GPT-6.1 Sol) inspected `Select database reference` and its consumers. It only chooses the preview/production branch ID and exposes it for credentials, schema comparison, summary, and reusable outputs; it performs no provider operation. Explained that the selected value is required but the separate step can be removed by inlining the selection. No workflow changes were made for this question. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Follow-up: confirmed four direct references to `steps.reference.outputs.branch_id`, all in the reusable database workflow: job output, migration credentials, schema diff, and deployment summary.

## 2026-10-26 — Checkout-free detection, colored JSON, and unconditional migrations

- AI assistance: OpenCode (GPT-6.1 Sol) replaced the Git-based detector with a GitHub comparison-metadata lookup using event SHAs, removing checkout and Git commands from change detection. GitHub Actions event JSON omits changed-file lists, so this explicitly uses the existing GitHub token/API rather than pretending the event alone contains filenames. Matching still takes one path substring and emits one plain boolean. Displayed JSON uses forced `jq -C` colors; matching data and workflow outputs remain uncolored. API failures/truncation fail closed without a fallback. Attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Source checkout is now limited to actual application builds, database migration tools, or missing-preview deployment configuration. Neon metadata/credential operations run from a small composite's downloaded snapshot and keep credentials private. Existing application previews require no checkout in automatic or manual runs.
- Removed the migration-test step and database build gate as requested. The database job always applies `alembic upgrade head` to its selected branch, which skips already applied revisions. Updated the decision/summary messages and documentation; no database reset or downgrade was added.
- Removed the now-redundant `Select migration path` step; there is no conditional migration path to select.
- Validated on 2026-10-27: 45 local Bash checks, ShellCheck, actionlint (with documented modern-syntax/runner-label exceptions), action-lock verification, formatting, and diff checks passed before submission.

## 2026-10-26 — CI/CD decision logging and checkout placement

- AI assistance: OpenCode (GPT-6.1 Sol) added logging of the searched substring, changed file paths, and match result to the existing Bash/jq detector. Paths are escaped when logged so spaces/newlines remain unambiguous and cannot inject workflow commands. The single `path` input, `changed` output, substring matching, and lack of event handling/fallbacks are unchanged. Added logging and empty-diff regressions. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Incorporated follow-up requests: removed the `Test CI scripts` workflow step (keeping local tests), logged migration/build decisions and Neon preview/production-parent/database-reference selections, and added equivalent public deployment-resolution/reuse logs. Helper logs go to stderr so resource IDs/URLs returned through stdout remain intact; connection values and tokens remain private.
- Switched reusable calls to the documented `$/` syntax (composites already use it), moved the Git-history checkout into the changed-path composite, and deferred other checkouts until source/configuration is needed. Deployment scripts run from the downloaded composite snapshot before checkout, allowing manual reuse-only application runs to avoid checkout entirely and preventing a second checkout from deleting a validated frontend build.
- Local validation includes 40 Bash regression checks for logs, empty/multi-commit diffs, provider output isolation, private credentials, reuse from an empty workspace, deferred checkout, and action/workflow structure. No Python CI/CD code was introduced or executed.

## 2026-10-26 — Entry workflow and caller job emojis

- AI assistance: OpenCode (GPT-6.1 Sol) prefixed the automatic/manual workflow titles and their caller job names with consistent emojis: 🚀 orchestration, 🗄️ database, ⚙️ backend, and 🌐 frontend. Reusable workflow titles and their inner `Deployment` job labels remain plain; existing step emojis, job IDs, dependencies, and behavior are unchanged. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).

## 2026-10-26 — Consistent step emojis and deployment debug cleanup

- AI assistance: OpenCode (GPT-6.1 Sol) added explicit emoji-prefixed names to every configured workflow/composite step, using consistent prefixes for matching purposes across database/backend/frontend jobs and shared actions. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`). Job display names, IDs, dependencies, and the minimal detector script are unchanged.
- Removed the deployment verification step and its unused HTTP/CORS/SSR probes, runtime-log diagnostics, and related debug-only tests. Retained normal lint/format/application/migration/CI-script tests, provider READY checks, artifact provenance validation, credential redaction, and deployment summaries. Added regressions for custom step names, emoji consistency, and absence of deployment debug steps; updated CI documentation.
- Validation: all 50 configured steps have custom emoji-prefixed names; 32 Bash checks, ShellCheck, actionlint (with the documented syntax/runner-label exceptions), action-lock verification, formatting, and diff checks passed.

## 2026-10-26 — Explicit Ubuntu 26.04 runners

- AI assistance: OpenCode (GPT-6.1 Sol) pinned the database/backend/frontend reusable jobs to `runs-on: ubuntu-26.04`, replacing `ubuntu-latest` to avoid the Ubuntu label-migration notices. Confirmed the hosted-runner label against GitHub's runner-images documentation. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`). No other workflow behavior changed.

## 2026-10-26 — Workflow UI naming options

- AI assistance: OpenCode (GPT-6.1 Sol) inspected the caller/reusable job names and proposed concise UI naming schemes. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`). The repeated `backend / backend` label comes from the caller job and the job inside the reusable workflow, not the reusable workflow's top-level name. Recommended explicit job display names while retaining job IDs and dependency/output references. No workflow names were changed pending the user's choice.
- Follow-up: after the user questioned the database-specific label, recommended the same inner display name, `Ensure deployment`, for database, backend, and frontend. Naming changes remain unapplied.
- Implemented the approved display names for automatic and manual callers: `Database / Ensure deployment`, `Backend / Ensure deployment`, and `Frontend / Ensure deployment`. Only job `name` fields changed; job IDs, references, execution order, and behavior remain unchanged. Author identity was reverified with `gh api user`.
- Shortened the inner display name to `Deployment` in all three reusable workflows at the user's request so the labels fit the GitHub UI. Job IDs and behavior remain unchanged. Attribution: `@ElectroluxV2` (Mateusz Budzisz, reverified with `gh api user`).

## 2026-10-26 — Minimal Bash composite detector and independent reusable workflows

- AI assistance: OpenCode (GPT-6.1 Sol) implemented the requested single-input `path`/single-output `changed` composite action and reused it exactly once in each database/backend/frontend reusable workflow. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`). After the user's correction, the detector is only a before/after Git diff plus jq substring check: no event dispatch, fallbacks, component mappings, build overrides, or branch resolution.
- Reduced the automatic workflow to three ordered reusable calls and removed cross-application workflow calls. Dependencies are resolved with provider APIs in the consuming job, without credential outputs. Explicit initial-PR/manual choices remain in the reusable callers, not the detector.
- Implemented the accepted per-push reuse policy: an unchanged application's existing READY preview is left untouched; only an absent preview is provisioned from retained production output. No source/config fingerprint can force a rebuild or replacement. Replaced Python CI/CD controller/artifact/smoke logic and its tests with Bash/jq scripts and shell tests; application-native pytest/Alembic tooling is unchanged. No Python was executed for this refactor.
- Local checks: 30 Bash regression cases passed, covering the detector, provider discovery, no-op preview reuse, production artifact provenance, private runtime binding, artifact safety, and SSR payload checks. Bash syntax, ShellCheck, actionlint, and all seven action-lock entries are validated before submission.
- The first live run selected all three unchanged paths correctly and reused both application previews, but an old deployment smoke check still ran on reuse and failed its SSR assertion. Corrected that control-flow violation: an existing preview now returns before dependency resolution, and reuse skips CLI setup and deployment smoke tests. New builds/restored previews retain strict HTTP/SSR checks. Added red/green regressions for own-project-only discovery and the reuse step guards; no application rebuild or deployment was forced, and the minimal detector is unchanged.
- The corrected reuse path passes 32 Bash checks plus ShellCheck, actionlint, formatting, and action-lock verification. Unchanged database previews also skip unnecessary production-parent resolution and schema-comment updates; their existence is checked before any clone is attempted.

## 2026-10-26 — Bash-only CI/CD constraint and incremental change detection

- AI assistance: OpenCode (GPT-6.1 Sol) assessed the user's Bash/jq-only CI/CD requirement and proposed event-based incremental change detection. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, previously verified with `gh api user`). No Python was executed for this assessment.
- Verified GitHub's documented Actions push-payload limitation: commit objects omit `added`, `removed`, and `modified` file lists; pull-request payloads also cannot use the proposed `commits[0].modified` expression. The proposed implementation uses Bash, jq, and a before/after Git diff covering the complete push, including added/deleted/renamed paths, with merge-base handling for initial PR events and conservative handling of unavailable history.
- The planned reusable-workflow refactor must remove Python orchestration, keep the automatic caller at three jobs, and use a successful-deployment source fingerprint before reusing output so a later unrelated commit cannot hide an earlier failed application deployment. No workflow implementation has been changed during this design discussion.

## 2026-10-26 — Independent reusable-workflow design and path-filter feasibility

- AI assistance: OpenCode (GPT-6.1 Sol) assessed the requested three-job automatic caller and independent database/backend/frontend reusable workflows. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Checked the current workflow call graph and GitHub's official workflow-syntax/reusable-workflow documentation. Native `paths` filters gate whole event-triggered workflows, not individual jobs or calls through `workflow_call`; using them alone cannot both select application builds independently and ensure the complete stack on every PR.
- Proposed moving change detection and provider dependency discovery inside the reusable workflows: database credentials resolved privately through Neon in the consuming job, backend deployment URLs resolved through Vercel, and no cross-workflow deployment calls or credential outputs. The automatic caller would contain only ordered database/backend/frontend calls. Standalone deployments require existing dependencies and fail clearly instead of deploying another module implicitly. No workflow implementation has been changed for this design discussion.

## 2026-10-26 — Prefix-free backend routes and browser-aware deployment checks

- AI assistance: OpenCode (GPT-6.1 Sol) implemented the requested removal of the backend `/api` prefix across FastAPI routes, frontend SSR/runtime URL construction, tests, deployment probes, and current documentation. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, reverified with `gh api user`).
- Added failing-then-passing root-route and runtime-URL regressions, explicit rejection of old prefixed routes, and a negative CORS preflight test. Tightened frontend deployment verification to require anonymous backend GET/preflight access plus a successful serialized SSR HttpClient response; URL-only transfer state and provider sign-in redirects cannot pass.
- Reconfirmed that backend preview root GET/preflight requests are still intercepted by Vercel Authentication (302, no CORS header). Protection changes remain unapproved; the stack must not be called browser-ready while that policy blocks access. Progress and the outstanding access-policy/exact-frontend-hostname questions remain on PR #14.
- Follow-up: the user approved removing Vercel Authentication from the backend project and requested dashboard instructions. Checked Vercel's official documentation and provided the project-specific toggle/save steps, explaining that existing backend deployments also become public and that frontend protection remains unchanged. No provider setting has been changed by the agent; verification awaits the dashboard change. Communication now stays in this chat, as requested.
- Validation: 32 controller tests, seven backend tests with nine subtests, four Angular tests, lint/format/build, and seven-workflow/action-lock verification passed. Repeated real Chrome hydration against the rebuilt root-endpoint frontend: reachable backend transfers one HTTP response with zero hydration refetches; a sign-in redirect reproduces the missing successful HTTP cache and CORS error. The new CI parser accepts/rejects the corresponding actual SSR HTML, and the anonymous live probe fails explicitly on Deployment Protection.

## 2026-10-26 — Browser CORS and Angular HTTP transfer-cache diagnosis

- AI assistance: OpenCode (GPT-6.1 Sol) investigated the reported browser CORS error and missing HttpClient transfer state. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Reproduced backend preview GET and preflight requests redirecting to Vercel sign-in before FastAPI CORS runs. Previous authenticated CI probes bypassed that protection and therefore did not demonstrate browser accessibility.
- Exercised the unchanged production Angular build through SSR and actual headless Chrome hydration using isolated public/protected backend fixtures. A public successful response produced one serialized HTTP response, zero duplicate hydration requests, and a fresh request only on explicit reload. A protected login redirect produced no successful HTTP response to transfer, one hydration request, and a browser CORS error. Both cases still transferred the backend URL. The working-app assertion fails against the protected fixture.
- Posted reproduction evidence, ranked hypotheses, and questions on PR #14: confirm the exact frontend hostname and whether backend preview APIs may be public. No application source or deployment-protection settings were changed; the fix remains blocked on that access-policy decision. Temporary browser fixtures and dependencies are isolated in the approved temporary debug directory, not added to the repository.

## 2026-10-26 — Approved ordered CI/CD and sample database implementation

- AI assistance: OpenCode (GPT-6.1 Sol) resumed the approved workflow redesign: three reusable workflows plus database/backend/frontend manual entry points and one ordered automatic entry point, native path planning, per-target concurrency, stable URLs, and runtime dependency wiring.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Added SQLAlchemy models and an Alembic sample inventory migration following Neon's Python/FastAPI migration guide, direct migration versus pooled application credentials, explicit Neon copy-on-write branch preparation, and the official Neon schema-diff PR comment action. Remote creation requires the repository's Neon API key and project configuration.
- Verified that the public Vercel create-deployment API documents a new build for `deploymentId`, not a zero-build preview clone. Retained sanitized GitHub prebuilt-output artifacts as the fallback for unchanged applications rather than silently rebuilding; no OCI registry. Runtime credentials are stripped before upload, applied only after upload/restoration, and never cross job outputs. Added policy, artifact safety, migration, and sample backend tests.
- Fixed frontend client-rendered startup by loading public runtime configuration before Angular resolves its backend URL, while preserving SSR transfer state. Folded in pending fourth-round changes: no API discovery stub, explicit-only CORS, annotated pytest, and shell-independent Portless commands using native `PORT` support.
- Progress, provider constraints, required secret names, and final status are reported on PR #14 only, as requested.
- Local validation: 17 deployment/artifact policy tests, five backend tests (plus CORS subtests), four Angular tests, the Alembic migration lifecycle test, Node.js 24 packaging/SSR checks, and native Portless startup checks passed. Regenerated both Python lockfiles with the documented uv 0.13.5 version and verified all seven action-lock entries/workflows. The user added Neon credentials; the project ID is accepted as either a repository variable or secret.
- First live run reached Neon successfully but the branch action returned HTTP 412. Added sanitized provider diagnostics and an idempotent REST branch resolver that inherits project compute settings rather than sending action-specific overrides; no existing branches are deleted.
- Pinned the deployment controller's Ruff target to runner Python 3.12 after a Python-3.14 formatting transformation broke bootstrap parsing. Added a regression test that parses every controller source file with the Python 3.12 grammar before app-specific uv setup.
- The live ordered run created the Neon preview, applied the Alembic/sample schema, posted Neon's schema-diff comment, and deployed both applications successfully. Added authenticated application HTTP checks for inventory/CORS and frontend runtime wiring without disabling deployment protection or exposing bypass credentials to the browser.
- Strict HTTP verification exposed a deployed backend 500 despite Vercel READY status. Added a separate health probe and sanitized runtime-log retrieval to distinguish packaging/bootstrap failures from database binding/connection errors before changing database state.
- The health probe succeeded, narrowing the live failure to the database-facing path. Added explicit deployment-scoped runtime bindings via valueless `--env NAME` (values remain in the process environment, not command arguments). Separately, the retained Python artifact contained only its launcher plus `filePathMap` references; added guarded materialization of application/vendor files and versioned the portable artifact contract. Both gaps have failing-then-passing regression tests.
- Continued live diagnosis under `@ElectroluxV2` (identity reverified with `gh api user`): the latest authenticated inventory probe still returns 500 while health succeeds. Found that Vercel CLI 65 stores exception messages under each request's nested `logs` array, which the diagnostics parser ignored. Added a red/green parser regression for both nested request records and typed message envelopes, preserving credential redaction.
- Live validation subsequently passed in automatic run `40387601983`: the migrated inventory returned one row with the exact frontend CORS origin, and the frontend runtime URL matched the resolved backend. Standalone frontend run `40388075353` also passed its database → backend → frontend sequence with `build=false`; application build/package/artifact steps were skipped and both authenticated HTTP checks passed. Independent backend run `40388076303` likewise reused the ready deployment without an application build and passed inventory/CORS verification. The earlier 500 did not recur on those deployments, but its exact root cause is not proven. Unauthenticated requests still return Vercel sign-in redirects; protection remains unchanged. Rechecked 25 controller tests, five backend tests plus six CORS subtests, the migration lifecycle test, and all seven action-lock entries.

## 2026-10-26 — PR #14 fourth-round work and workflow redesign proposal

- AI assistance: OpenCode (GPT-6.1 Sol) assessed the fourth-round review feedback and prepared local changes for explicit CORS allowlists, annotated pytest reporting, shell-independent Portless commands, and direct Vercel Build Output packaging without an API stub. The user selected the existing Vercel–Neon integration for preview database management.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- The fifth-round request asked for a workflow design before implementation. Posted the proposed three reusable workflows and four entry workflows, with Mermaid diagrams, dependency resolution, selective builds, runtime frontend configuration, and provider constraints in [the PR discussion](https://github.com/Renters-Sailors/rent-n-sail/pull/14#issuecomment-6423310377).
- Implementation is paused pending design feedback. The fourth-round changes remain local and unpushed; further discussion stays on GitHub as requested.

## 2026-10-26 — PR #14 third review round

- AI assistance: OpenCode (GPT-6.1 Sol) assessed the 11 third-round review threads on [PR #14](https://github.com/Renters-Sailors/rent-n-sail/pull/14) and simplified the configuration, tests, and workflow failure checks.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Removed all built-in CORS domains and preview patterns. Backend CORS now reads only environment configuration and denies cross-origin access when none is set; the Portless start command supplies its local origin as process configuration. Refactored CORS tests to use explicit, synthetic environment values and an application factory, without deployed-domain fixtures.
- Moved the Vercel-compatible default SSR export into `src/server.ts` before compilation; retained only the discovery re-export under `api/`. Removed the explicit localhost host allowance and URL scheme check, while retaining protection against serializing URL credentials to the browser. Removed the proxy-specific test and used nullish coalescing with a `never`-returning throw helper, since TypeScript does not support literal throw expressions.
- Made `.DS_Store` and `Thumbs.db` exclusions repository-wide, and shortened both workflow gates to `contains(steps.*.outcome, 'failure')`, using the outcome array directly rather than joining it into a string.
- Verification: four backend configuration/CORS tests and two Angular tests passed, along with Ruff, ESLint, formatting, and the Node.js 24 production build. The compiled default handler and API discovery entry are identical and rendered backend data over HTTP for both Portless and Vercel hostnames. Checked all eight backend and sixteen frontend failure combinations, repository-wide system-file ignores, local CORS environment overrides, and YAML language annotations. Action-lock verification passed; actionlint passed with the existing narrow syntax-support exceptions.

## 2026-10-26 — PR #14 second review round

- AI assistance: OpenCode (GPT-6.1 Sol) assessed the second-round review comments on [PR #14](https://github.com/Renters-Sailors/rent-n-sail/pull/14), including the requested direct frontend-to-backend calls.
- Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`).
- Added workflow error annotations, deployment URL outputs and run summaries, and GitHub Environments linked to the deployed URLs. Workflow-level concurrency queues each project's production or PR preview environment without cancelling active or pending runs (`queue: max`, subject to GitHub's 100-pending-run limit).
- Nested cached CLI setup inside deployment, removed redundant event/branch deployment gates while retaining the fork-PR credential guard, and mapped non-main manual runs to preview deployments. Backend Python now follows `pyproject.toml` through uv's activated environment and caches managed interpreter installations. Frontend lint, format, Vitest tests, and build finish before a combined failure gate; Vitest uses its GitHub Actions reporter.
- Removed backend proxy rewrites and the transfer-cache origin map. SSR transfers the configured public backend API URL to the browser with Angular `TransferState`, so both use the backend directly. Added configurable, restricted backend CORS defaults for localhost, the production frontend, and this project's deployment domains under the `rent-n-sail` Vercel team, with tests rejecting foreign origins.
- Follow-up review: consolidated the three tracked `.gitignore` files into the repository-root file, preserving frontend/backend path scopes and the VS Code file exceptions. Checked the resulting ignore behavior against the original rules for representative paths.
- Follow-up review: configured Portless for local frontend/backend development, with a pinned frontend development dependency, stable `.localhost` URLs, dynamic backend ports, local SSR host handling, and the local CORS origin. Documented interactive CA/HTTPS setup without modifying system trust or privileged ports. Verified both start scripts through an isolated, unprivileged HTTP Portless proxy: the backend served `/api`, and the frontend rendered backend data via SSR.
- Verification: frontend lint, three Angular tests, and production build passed; backend Ruff checks and three CORS tests passed. A real SSR smoke test verified the direct API URL in serialized state. An intentionally failing Vitest fixture emitted a GitHub error annotation. Mock CLI checks covered URL outputs/summaries, preview/manual/production arguments, missing config, and CLI failure annotations; the frontend gate was checked against all failure combinations. Verified uv selects Python 3.14 from project metadata. ShellCheck and action-lock verification passed; actionlint uses narrow exceptions for its unsupported `$/` syntax and documented `concurrency.queue` property.

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

## 2026-10-24 — Local frontend-backend development

- AI assistance: OpenAI GPT-5.6 Terra reproduced the missing `BACKEND_URL` SSR failure, removed the server-side dependency on that binding, and configured Angular's development proxy for browser and SSR `/api` requests. Local FastAPI and Angular ports are explicitly configured as 5000 and 4200, respectively, without environment variables.
- Author attribution: `@Buzeqq` (verified with `gh api user`).
- The Vercel service binding is no longer needed: both SSR and browser requests use the public `/api` rewrite.
- Verification: Angular build and tests pass; FastAPI starts on `127.0.0.1:5000`; backend Ruff checks pass.

## 2026-10-24 — Python `Any` removal

- AI assistance: OpenAI GPT-5.6 Terra replaced `typing.Any` in the WebAuthn API payload and challenge annotations with `object`, retaining the unstructured payload boundary without using `Any`.
- Author attribution: `@Buzeqq` (verified with `gh api user`).

## 2026-10-24 — Consolidated AuthTuna passkey flow

- AI assistance: OpenAI GPT-6 Luna consolidated passkey startup, assertion/login, new-account registration, credential verification, and session creation behind one frontend-facing `/api/passkey-flow` endpoint, using AuthTuna's passkey core, user manager, credential manager, and session helper. New users receive an autogenerated username; an optional authenticated username-update endpoint is available.
- Author attribution: `@Buzeqq` (verified with `gh api user`).
- Clicking StartFlow first attempts login using `/api/passkey-flow/login`. If login fails, the UI reveals a username form; submitting it starts registration at `/api/passkey-flow/register/init`, and the browser's attestation is completed at `/api/passkey-flow/register/complete`.
- Backend does not query or load a list of stored credentials. Login checks only the credential ID returned by the browser. Account creation is explicit, not automatic.
- Verification: Angular build/tests, backend Ruff, and FastAPI regression tests for login, unknown credentials, registration initialization, and completion acknowledgment pass; a real device passkey was not used.
- Replaced broad passkey payload annotations with `TypedDict` definitions for only the assertion/attestation fields consumed by the backend; dynamic options remain `dict[str, object]`.
- Replaced raw AuthTuna `ValueError` details in login and registration responses with generic client errors; regression tests assert verifier details are not exposed.
- Added module-level Python logging for passkey flow milestones and generic failure reasons, without logging usernames, credential IDs, challenge values, or verifier exception details.
- Disabled unused AuthTuna UI, MFA, admin, and passwordless features, and set `ONLY_MIDDLEWARE` so unused AuthTuna routers are not mounted. Passkey core and session middleware remain enabled for the custom flow.

## 2026-10-24 — Colored IDE backend logs

- AI assistance: OpenAI GPT-6 Luna found the IDE run configuration lacked a TTY, causing Rich-based FastAPI logs to disable ANSI colors. Added `FORCE_COLOR=1` and `TERM=xterm-256color` to `.run/Backend.run.xml`.
- Author attribution: `@Buzeqq` (verified with `gh api user`).

## 2026-10-25 — Auth router import diagnosis

- AI assistance: OpenAI GPT-6 Luna traced the router type error to importing the `auth.register.router` module instead of its `APIRouter` object, and identified missing package exports/imports in the new vertical slice.
- Author attribution: `@Buzeqq` (verified with `gh api user`).

## 2026-10-25 — Shared auth types organization

- AI assistance: OpenAI GPT-6 Luna recommended keeping shared WebAuthn `TypedDict` payloads in `auth/common/passkey_types.py`, endpoint-specific Pydantic request models within each vertical slice, and router aggregation separate from shared types.
- Author attribution: `@Buzeqq` (verified with `gh api user`).

## 2026-10-26 — Ruff line wrapping explanation

- AI assistance: OpenAI GPT-6 Luna explained Ruff's parenthesized line wrap around the 89-character assignment; the configured default line length is 88 characters.
- Author attribution: `@Buzeqq` (verified with `gh api user`).

## 2026-10-26 — Passkey sign-counter update explanation

- AI assistance: OpenAI GPT-6 Luna inspected AuthTuna's `update_credential_on_login` and explained that it persists the WebAuthn signature counter and last-used time after successful authentication.
- Author attribution: `@Buzeqq` (verified with `gh api user`).

## 2026-10-24 — WebAuth passkey flow

- AI assistance: OpenAI GPT-5.6 Terra generated the Angular `WebAuthFlowComponent` with the pnpm Angular CLI and initially added custom in-memory WebAuthn endpoints. At the user's request, those endpoints were replaced with AuthTuna's built-in passkey routes, account signup, and SQLite persistence.
- Author attribution: `@Buzeqq` (verified with `gh api user`).
- A new user provides a name after the built-in passkey login endpoint reports an unknown credential; AuthTuna then creates the account and passkey and persists both in `backend/authtuna_dev.db`. The local SQLite database is ignored by Git.
- Verification: Angular build and tests pass. Ruff passes, and FastAPI TestClient verifies `/api/health` plus AuthTuna's `/api/passkeys/login-options`. A real browser/device ceremony was not run.

## 2026-10-24 — FastAPI development run configuration

- AI assistance: OpenAI GPT-5.6 Terra reproduced the FastAPI CLI error, identified that the IDE configuration and contributor command omitted the application path, and added the backend `main.py` path to both commands.
- Author attribution: `@Buzeqq` (verified with `gh api user`).
