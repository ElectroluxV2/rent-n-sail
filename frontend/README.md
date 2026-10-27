# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.4.

## Vercel deployment

The frontend and backend use separate Vercel projects. Postgres is hosted by Neon and is accessed only by the backend, not by browsers.

- `src/server.ts` defines and default-exports the SSR handler before Angular compiles it. The deployment action packages the already validated build using the [Vercel Build Output API](https://vercel.com/docs/build-output-api), without running Angular or Vercel's frontend build again. `vercel.json` disables the Vercel build command. Static assets are served first, and page requests go to the SSR function. There is no `api/` discovery stub or frontend packaging script.
- The ordered deployment workflow supplies `BACKEND_URL` from the resolved backend deployment. The composable `provideBackendApiUrl` provider transfers its root `/` URL from SSR to Angular in the browser, without an initializer, config endpoint, or preload request. Both call the backend directly, without an `/api` prefix or backend proxy. The URL is public runtime configuration, not a baked-in deployment constant.
- Backend CORS uses only the explicit `CORS_ALLOWED_ORIGINS` allowlist, defaulting locally to `https://frontend.localhost`. The automated stack overrides it with the verified stable frontend origin; independent deployments can set their own explicit list. There are no regex patterns. The current API permits cross-origin `GET` requests without cookies.
- Open the stable frontend URL from the GitHub Environment, not an arbitrary deployment hostname. Vercel Authentication on the backend can redirect API calls before CORS runs; changing application CORS cannot authorize that redirect. The API must be reachable under the approved browser-access policy for SSR to obtain and transfer a successful HttpClient response.

The [stack workflows](../.github/CI.md) prepare the Neon preview first, apply [Alembic migrations](../database/README.md), deploy/resolve the backend, then deploy/resolve the frontend. Neon’s official action comments schema changes on the PR. Database credentials are resolved privately in each consuming job; no database password is passed through job outputs or public frontend configuration.

## Development server

After installing frontend dependencies, run these commands in separate terminals from `frontend`; no environment file is required:

```bash
pnpm run start:backend
pnpm start
```

[Portless](https://github.com/vercel-labs/portless) exposes the backend at `https://backend.localhost` and the frontend at `https://frontend.localhost`. It assigns free application ports automatically; FastAPI reads the injected `PORT` variable natively. Scripts pass the application commands directly to Portless. Frontend origin defaults live in `src/local-origins.ts`; the backend's explicit local CORS default lives in `backend/main.py`.

On first use, Portless may request permission to trust its local CA and bind HTTPS port 443. Run it interactively and follow its prompts. For custom proxy ports, TLS modes, hostnames, or worktrees, set `BACKEND_URL` to the backend's actual Portless URL and update `CORS_ALLOWED_ORIGINS` to the frontend's actual origin. No local CA or system trust changes are performed by repository setup or CI.

Open `https://frontend.localhost/`. The application will automatically reload when source files change.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
