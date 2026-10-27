# Provider client assessment

Checked on 2026-10-27 for [PR #14](https://github.com/Renters-Sailors/rent-n-sail/pull/14#discussion_r4387209214).

## Available official clients

| Package                                                      | Current exact version | Relevant interface                                                                                                |
| ------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`@vercel/sdk`](https://github.com/vercel/sdk/tree/v1.28.53) | `1.28.53`             | `new Vercel(...)`; `projects.getProject`, `deployments.getDeployments`, `aliases.getAlias`, `aliases.assignAlias` |
| [`@neon/sdk`](https://unpkg.com/@neon/sdk@7.5.0/README.md)   | `7.5.0`               | `createNeonClient(...)`; `branches.list(...).all()`, `branches.create`, `postgres.connectionString`               |

Both clients support Node 24 through ESM imports. Neon's current SDK replaces its older `@neondatabase/api-client`; `@neondatabase/serverless` is a SQL driver, not a management client. Vercel still labels its SDK beta and warns of breaking changes outside major releases. Exact versions/module formats were checked against published package metadata: [Vercel](https://registry.npmjs.org/@vercel%2fsdk/1.28.53), [Neon](https://registry.npmjs.org/@neon%2fsdk/7.5.0).

## Decision

Keep the small dependency-free native-fetch adapter **private**, and expose workflow-level helpers from `actions/_shared/providers.cjs`: `getDatabasePreviewFor`, `getDatabaseConnectionFor`, `getApplicationDeploymentFor`, `getApplicationRuntimeFor`, and `assignApplicationDeploymentFor`. These own branch selection, pagination, alias ownership, runtime bindings, and secret masking; workflows do not consume REST paths or response shapes.

This is not a claim that SDKs are unavailable. [`actions/github-script`](https://github.com/actions/github-script/blob/v9.0.0/README.md#use-npm-packages) does not install npm packages when importing them. Installing packages under the application workspace also does not make them dependencies of downloaded composite modules. SDK adoption would require runtime installation, or a separate locked build and checked-in dependency bundle using GitHub's [JavaScript-action distribution model](https://docs.github.com/en/actions/tutorials/creating-a-javascript-action#commit-tag-and-push-your-action).

The former violates checkout/setup-free unchanged runs; the latter adds a distribution build to a small controller. Neither is currently simpler. The high-level interface leaves either SDK implementation possible later without changing callers.

## OpenAPI alternative

Both providers publish official schemas: [Vercel](https://vercel.com/openapi.json), [Neon](https://neon.com/api_spec/release/v2.json). [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) plus generated TypeScript declarations would add generation/typechecking and runtime packaging. It does not replace repository-specific alias, branch, credential, or reuse policy, so it is not the smaller choice for these CommonJS modules.

## Selection details

- Vercel's [list endpoint](https://vercel.com/docs/rest-api/deployments/list-deployments) accepts project, branch, state, target, and limit filters. Unchanged runs read existing deployments and aliases; they never assign an alias or redeploy.
- Neon's [branch list](https://neon.com/docs/reference/api/branches/list-project-branches) is paginated. Exact preview-name/default-parent selection must not assume one page contains every branch.
- Neon's [connection URI](https://neon.com/docs/reference/api/projects/get-connection-uri) selects the branch, database, role, and pooling explicitly. Connection strings are masked and consumed within the job, never returned as workflow outputs.

Verification covered first-party documentation, source, and published package artifacts; no SDK installation or live SDK mutation was claimed. Attribution: `@ElectroluxV2` (Mateusz Budzisz), verified using `env -u GH_TOKEN -u GITHUB_TOKEN gh api user`.
