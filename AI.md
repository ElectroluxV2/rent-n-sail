# AI usage docs

## 2026-10-26 — Minimal Bash composite detector and independent reusable workflows

- AI assistance: OpenCode (GPT-6.1 Sol) implemented the requested single-input `path`/single-output `changed` composite action and reused it exactly once in each database/backend/frontend reusable workflow. Author attribution: `@ElectroluxV2` (Mateusz Budzisz, verified with `gh api user`). After the user's correction, the detector is only a before/after Git diff plus jq substring check: no event dispatch, fallbacks, component mappings, build overrides, or branch resolution.
- Reduced the automatic workflow to three ordered reusable calls and removed cross-application workflow calls. Dependencies are resolved with provider APIs in the consuming job, without credential outputs. Explicit initial-PR/manual choices remain in the reusable callers, not the detector.
- Implemented the accepted per-push reuse policy: an unchanged application's existing READY preview is left untouched; only an absent preview is provisioned from retained production output. No source/config fingerprint can force a rebuild or replacement. Replaced Python CI/CD controller/artifact/smoke logic and its tests with Bash/jq scripts and shell tests; application-native pytest/Alembic tooling is unchanged. No Python was executed for this refactor.
- Local checks: 30 Bash regression cases passed, covering the detector, provider discovery, no-op preview reuse, production artifact provenance, private runtime binding, artifact safety, and SSR payload checks. Bash syntax, ShellCheck, actionlint, and all seven action-lock entries are validated before submission.

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
