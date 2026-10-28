# Rent'n'Sail CI/CD

Names used in the diagrams:

- `{branch}`: the run's Git branch: the pull request's head branch, `main` for a push, or the branch picked for a manual run.
- `{target}`: `preview` for pull requests, `production` for pushes to `main`, and either one for manual runs.
- Database instance: the Neon branch `preview/{branch}` for previews. In production it is the production source: the Neon branch named by `NEON_PARENT_BRANCH_ID`, or Neon's default branch.
- Backend and frontend instances: deployments of the Vercel projects `rent-n-sail-backend` and `rent-n-sail`. Each is reached only through its alias: `{project}.vercel.app` in production, and `{project}-preview-{hash}.vercel.app` for a preview, where `{hash}` is the first 12 hex digits of the SHA-256 of `{project}:{branch}`.
- `BUILD_NEEDED`: whether the run updates the component; see [🔍 Detect changes](#-detect-changes).

## Triggers and job order

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant GH as GitHub
    participant Stack as 🚀 Stack CI/CD
    participant Manual as Manual CI/CD
    participant DB as 🗄️ Database
    participant BE as ⚙️ Backend
    participant FE as 🌐 Frontend

    alt Pull request
        Dev->>GH: Open, reopen, or push to a pull request
        GH->>Stack: pull_request: target preview, the pull request's branch
    else Merge into main
        Dev->>GH: Merge, which pushes to main
        GH->>Stack: push: target production, branch main
    else Manual run
        Dev->>GH: Run workflow: any branch, target, update
        GH->>Manual: workflow_dispatch of database.yml, backend.yml, or frontend.yml
    end
    Note over GH,FE: All four workflows share one queue per branch, stack-{branch}.<br/>A run waits until the branch's earlier runs finish, and none is cancelled.

    alt 🚀 Stack CI/CD
        Stack->>DB: target, update = false
        DB-->>Stack: instance_id, address, result
        Stack->>BE: target, update = false, after the database succeeded
        BE-->>Stack: instance_id, address, result
        Stack->>FE: target, update = false, after the backend succeeded
        FE-->>Stack: instance_id, address, result
        Note over DB,FE: A failed job skips every job after it.
    else Manual CI/CD
        alt database.yml
            Manual->>DB: target, update
        else backend.yml
            Manual->>BE: target, update
        else frontend.yml
            Manual->>FE: target, update
        end
        Note over DB,FE: A manual workflow runs only its own component, on the picked branch,<br/>for either target: a manual production run deploys that branch.
    end
    Note over Dev,FE: Pull requests from forks get no secrets, so their database job fails at 🌱 Ensure instance.
```

## Pull request lifecycle

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant GH as GitHub
    participant Stack as 🚀 Stack CI/CD
    participant Neon
    participant Vercel

    Dev->>GH: Open a pull request from {branch}
    GH->>Stack: pull_request opened: every change in the pull request counts
    Stack->>Neon: Reuse or fork preview/{branch}, then migrate it if database/ changed
    Stack->>Vercel: Backend, then frontend: release what changed, reuse or fork the rest
    loop Each push to the pull request
        Dev->>GH: Push commits
        GH->>Stack: pull_request synchronize: only the pushed commits count
        Stack->>Neon: Migrate preview/{branch} if database/ changed
        Stack->>Vercel: Release what changed, reuse the rest
    end
    alt Merged
        Dev->>GH: Merge into main
        GH->>Stack: push to main: the merged changes count, target production
        Stack->>Neon: Delete preview/{branch}, then migrate production if database/ changed
        Stack->>Vercel: Delete the branch's aliases and deployments,<br/>then release the changed components to production
    else Closed without merging
        Dev->>GH: Close the pull request
        Note over GH,Vercel: No run. Each component's next job, on any branch, deletes its previews of {branch}.
        opt Reopened
            Dev->>GH: Reopen the pull request
            GH->>Stack: pull_request reopened: every change counts again,<br/>so the previews come back up to date
        end
    end
```

## 🔍 Detect changes

```mermaid
sequenceDiagram
    participant Job as Component job
    participant Detect as 🔍 Detect changes
    participant Repo as GitHub repository

    Job->>Detect: path: database/, backend/, or frontend/<br/>update: false from Stack CI/CD, the checkbox from a manual run
    alt Push to main or to a pull request
        Note over Detect,Repo: Compare event.before with event.after: the pushed commits
    else Pull request opened or reopened
        Note over Detect,Repo: Compare the base commit with the merge commit: the whole pull request
    else Manual run
        Note over Detect,Repo: Compare the commit with itself: no changes
    end
    Detect->>Repo: Fetch both commits into a bare, blobless clone, without a checkout
    Repo-->>Detect: Commits and trees
    Detect->>Detect: git diff --name-only
    Detect-->>Job: BUILD_NEEDED = a changed path contains the component path, or update
    Note over Job,Repo: BUILD_NEEDED gates every step after 🌱 Ensure instance.<br/>A change elsewhere, such as in .github/, updates no component.
```

## 🌱 Ensure instance

```mermaid
sequenceDiagram
    participant Job as Component job
    participant Ensure as 🌱 Ensure instance
    participant API as GitHub API
    participant P as Neon or Vercel

    Job->>Ensure: COMPONENT, DEPLOY_TARGET, DEPLOY_BRANCH, BUILD_NEEDED
    Ensure->>API: List open pull requests
    API-->>Ensure: Their head branches
    Ensure->>P: Delete the previews of every other branch, keeping DEPLOY_BRANCH
    opt Cleanup fails
        Ensure-->>Job: Warning "Stale previews remain", then carry on
    end
    alt Preview
        Ensure->>P: Find Neon branch preview/{branch}, or the branch's latest READY deployment
    else Production
        Ensure->>P: Find the Neon production source, or the latest READY production deployment
    end
    alt Found
        Ensure-->>Job: INSTANCE_ID, INSTANCE_ADDRESS, result reuse
    else Missing backend or frontend, BUILD_NEEDED
        Ensure-->>Job: Nothing yet: 🚀 Release update creates the instance
    else Missing database preview
        Ensure->>P: Create Neon branch preview/{branch} from the production source
        Ensure-->>Job: INSTANCE_ID, INSTANCE_ADDRESS, result fork
    else Missing backend or frontend preview, no update
        Ensure->>P: Redeploy production as the branch's preview
        Ensure-->>Job: INSTANCE_ID, INSTANCE_ADDRESS, result fork
    else Missing production deployment, no update
        Ensure-->>Job: ❌ No READY production deployment to fork: deploy it from main
    end
    Note over Job,P: The production database is the production source itself, so it is never missing,<br/>and Ensure fails if that source can't be resolved.
```

## Preview cleanup

```mermaid
sequenceDiagram
    participant Ensure as 🌱 Ensure instance
    participant Neon
    participant Vercel as Vercel project

    Note over Ensure,Vercel: Kept: DEPLOY_BRANCH and the head branch of every open pull request
    alt 🗄️ Database job
        Ensure->>Neon: List branches named preview/...
        loop Each preview/{branch} not kept
            Ensure->>Neon: Delete it and wait for the deletion to finish
        end
        Note over Ensure,Neon: Waiting keeps a fork right after it<br/>from hitting a locked project (HTTP 423).
    else ⚙️ Backend or 🌐 Frontend job, in its own project
        Ensure->>Vercel: Project name
        Ensure->>Vercel: List the project's aliases, 100 per page
        loop Each {project}-preview-{hash}.vercel.app that no kept branch uses
            Ensure->>Vercel: Delete the alias
        end
        Ensure->>Vercel: List the project's preview deployments, 100 per page
        loop Each deployment whose githubCommitRef isn't kept
            Ensure->>Vercel: Delete the deployment
        end
        Note over Ensure,Vercel: A frontend alias the backend reserved goes too. Production, other aliases,<br/>and deployments without githubCommitRef stay. Anything already gone (HTTP 404) is skipped.
    end
```

## Forking a backend or frontend preview

```mermaid
sequenceDiagram
    participant Ensure as 🌱 Ensure instance
    participant Vercel as Vercel project

    Note over Ensure,Vercel: First, the branch's settings are resolved as for a release (Settings and aliases).
    Ensure->>Vercel: Latest READY production deployment
    break No production deployment
        Vercel-->>Ensure: ❌ No READY production deployment to fork: deploy it from main
    end
    Ensure->>Vercel: Redeploy it as a preview with the settings and githubCommitRef = {branch}
    Note over Ensure,Vercel: No build and no upload: production's output with the branch's settings
    loop Every 3 seconds, for up to 10 minutes
        Ensure->>Vercel: Deployment state
        Vercel-->>Ensure: QUEUED, BUILDING, READY, ERROR, or CANCELED
    end
    break ERROR, CANCELED, or a timeout
        Vercel-->>Ensure: ❌ The fork failed
    end
    Ensure->>Vercel: Point the branch's preview alias at the fork
```

## Settings and aliases

```mermaid
sequenceDiagram
    participant BE as ⚙️ Backend job
    participant FE as 🌐 Frontend job
    participant Neon
    participant VB as Vercel rent-n-sail-backend
    participant VF as Vercel rent-n-sail

    Note over BE,VF: 🔐 Resolve settings runs before every release, and inside 🌱 Ensure instance before every fork.
    BE->>Neon: Pooled connection string of the database instance
    break No database instance for the branch
        Neon-->>BE: ❌ Run the database workflow first to create its preview
    end
    opt Preview
        BE->>VF: Look up the frontend's preview alias
        alt Nobody owns it yet
            BE->>VF: Reserve it for passkeys: point it at the frontend's production deployment
        else The frontend project owns it
            VF-->>BE: Nothing to change
        else Another Vercel project owns it
            VF-->>BE: ❌ The requested alias belongs to another project
        end
    end
    Note over BE,FE: DATABASE_URL, masked<br/>WEBAUTHN_ORIGIN = https://{frontend alias}<br/>WEBAUTHN_RP_ID = {frontend alias}
    BE->>VB: Release or fork, then point the backend's alias at it
    FE->>VB: Find the backend instance for the target and branch
    break No backend instance
        VB-->>FE: ❌ Run the backend workflow first to deploy its preview
    end
    Note over FE,Neon: BACKEND_URL = https://{backend alias}<br/>FRONTEND_URL = https://{frontend alias}
    FE->>VF: Release or fork, then point the frontend's alias at it, replacing a reservation
    Note over BE,VF: Pointing an alias owned by another Vercel project fails the same way. At run time,<br/>the frontend's server forwards /api/* to BACKEND_URL, and passkeys use the frontend's alias.
```

## 🗄️ Database job

```mermaid
sequenceDiagram
    participant Job as 🗄️ Database job
    participant Runner as Runner workspace
    participant Neon
    participant GH as GitHub

    Job->>GH: 🔍 Detect changes in database/
    GH-->>Job: BUILD_NEEDED
    Job->>Neon: 🌱 Ensure instance: clean up, then reuse or fork
    opt BUILD_NEEDED
        Job->>Runner: 📥 Check out source, ⚙️ Set up uv and Python, 📦 Install dependencies
        Job->>Neon: 🔐 Resolve settings: direct connection string
        Neon-->>Job: DATABASE_URL, masked
        Job->>Neon: 🚀 Release update: alembic upgrade head
        opt Pull request run
            Job->>Neon: 📝 Comment schema changes: diff preview/{branch} against its parent
            Neon-->>Job: Schema changes since the production source
            Job->>GH: Create or update the schema diff comment on the pull request
        end
    end
    Job->>GH: 📝 Report instance: reuse, fork, update, or fork+update
```

## ⚙️ Backend job

```mermaid
sequenceDiagram
    participant Job as ⚙️ Backend job
    participant Runner as Runner workspace
    participant Neon
    participant Vercel
    participant GH as GitHub

    Job->>GH: 🔍 Detect changes in backend/
    GH-->>Job: BUILD_NEEDED
    Job->>Vercel: 🌱 Ensure instance: clean up, then reuse, fork, or leave it to the release
    opt BUILD_NEEDED
        Job->>Runner: 📥 Check out source, ⚙️ Set up uv and Python, 📦 Install dependencies
        Job->>Runner: 🧹 Lint: ruff check
        Job->>Runner: 🎨 Check formatting: ruff format --check
        Job->>Runner: 🧪 Run tests: pytest
        break A check failed
            Runner-->>Job: ❌ After every check ran, skip the rest and fail the job
        end
        Job->>Runner: ⚙️ Set up Vercel CLI
        Job->>Vercel: 📥 Pull project configuration for the target, and the branch on previews
        Job->>Runner: 🔨 Package version: vercel build
        Job->>Neon: 🔐 Resolve settings: pooled DATABASE_URL
        Job->>Vercel: 🔐 Resolve settings: WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID from the frontend's alias
        Job->>Vercel: 🚀 Release update: vercel deploy --prebuilt with the settings
        Vercel-->>Job: READY deployment, githubCommitRef = {branch}
        Job->>Vercel: Point the backend's alias for the target at it
    end
    Job->>GH: 📝 Report instance: reuse, fork, or update
```

## 🌐 Frontend job

```mermaid
sequenceDiagram
    participant Job as 🌐 Frontend job
    participant Runner as Runner workspace
    participant Vercel
    participant GH as GitHub

    Job->>GH: 🔍 Detect changes in frontend/
    GH-->>Job: BUILD_NEEDED
    Job->>Vercel: 🌱 Ensure instance: clean up, then reuse, fork, or leave it to the release
    opt BUILD_NEEDED
        Job->>Runner: 📥 Check out source, ⚙️ Set up Node.js and pnpm, which installs dependencies
        Job->>Runner: 🧹 Lint: eslint
        Job->>Runner: 🎨 Check formatting: oxfmt
        Job->>Runner: 🧪 Run tests: ng test
        Job->>Runner: 🔨 Build application: ng build
        break A check failed
            Runner-->>Job: ❌ After every check ran, skip the rest and fail the job
        end
        Job->>Runner: ⚙️ Set up Vercel CLI
        Job->>Vercel: 📥 Pull project configuration for the target, and the branch on previews
        Job->>Runner: 🔨 Package version: lay out the tested build and frontend/vercel-output<br/>as Vercel Build Output, without building again
        Job->>Vercel: 🔐 Resolve settings: BACKEND_URL from the backend's alias, and FRONTEND_URL
        Job->>Vercel: 🚀 Release update: vercel deploy --prebuilt with the settings
        Vercel-->>Job: READY deployment, githubCommitRef = {branch}
        Job->>Vercel: Point the frontend's alias for the target at it
    end
    Job->>GH: 📝 Report instance: reuse, fork, or update
```

## 📝 Report instance

```mermaid
sequenceDiagram
    participant Ensure as 🌱 Ensure instance
    participant Report as 📝 Report instance
    participant GH as GitHub

    Ensure->>Report: INSTANCE_RESULT: reuse, fork, or unset if the release created the instance
    alt No update
        Report->>GH: result reuse or fork, as Ensure left it
    else Update after a fork
        Report->>GH: result fork+update
    else Any other update
        Report->>GH: result update
    end
    Report->>GH: Job outputs instance_id, address, and result
    Report->>GH: Job summary with the result, instance, and address
    Report->>GH: The address as the URL of the backend and frontend environments
```

Every combination and its result:

| Component         | Target     | Instance before the run | `BUILD_NEEDED` | 🌱 Ensure instance | Update     | Result      |
| ----------------- | ---------- | ----------------------- | -------------- | ------------------ | ---------- | ----------- |
| Database          | preview    | exists                  | false          | reuse              |            | reuse       |
| Database          | preview    | exists                  | true           | reuse              | migrations | update      |
| Database          | preview    | missing                 | false          | fork               |            | fork        |
| Database          | preview    | missing                 | true           | fork               | migrations | fork+update |
| Database          | production | production source       | false          | reuse              |            | reuse       |
| Database          | production | production source       | true           | reuse              | migrations | update      |
| Backend, frontend | preview    | exists                  | false          | reuse              |            | reuse       |
| Backend, frontend | preview    | exists                  | true           | reuse              | release    | update      |
| Backend, frontend | preview    | missing                 | false          | fork               |            | fork        |
| Backend, frontend | preview    | missing                 | true           | none               | release    | update      |
| Backend, frontend | production | exists                  | false          | reuse              |            | reuse       |
| Backend, frontend | production | exists                  | true           | reuse              | release    | update      |
| Backend, frontend | production | missing                 | false          | ❌ fails           |            |             |
| Backend, frontend | production | missing                 | true           | none               | release    | update      |

## Failures

```mermaid
sequenceDiagram
    participant Step
    participant Job as Component job
    participant Run as Workflow run

    alt Preview cleanup fails
        Step->>Job: Warning "Stale previews remain"
        Note over Step,Run: The job carries on. The next 🌱 Ensure instance retries the cleanup.
    else A check fails: lint, formatting, tests, or the frontend build
        Step->>Job: Annotations in the run
        Note over Step,Run: The other checks still run, then every later step is skipped and the job fails.
    else Any other step fails
        opt A component-instance stage
            Step->>Job: ❌ {stage} failed, with the error, in the job summary
        end
        Note over Step,Run: Every later step is skipped, 📝 Report instance too, and the job fails.
    end
    opt A job failed in 🚀 Stack CI/CD
        Job->>Run: Failure
        Note over Step,Run: Later components are skipped: no backend after a failed database,<br/>and no frontend after a failed backend.
    end
    Note over Step,Run: When the run ends, the branch's next queued run starts.
```
