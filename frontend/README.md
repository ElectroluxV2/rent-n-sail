# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.4.

## Vercel deployment

The frontend and backend use separate Vercel projects. Postgres is hosted by Neon and is accessed only by the backend, not by browsers.

- `src/server.ts` defines and default-exports the SSR handler before Angular compiles it. `pnpm run build:vercel` packages that compiled handler and the browser assets using the [Vercel Build Output API](https://vercel.com/docs/build-output-api). Static assets are served first, and page requests go to the SSR function. There is no `api/` discovery stub or adapter.
- The ordered deployment workflow supplies `BACKEND_URL` from the resolved backend deployment. SSR transfers its root `/` URL to Angular; a client-rendered entry loads `/runtime-config.json` before bootstrap when SSR state is absent. Both browser and SSR call the backend directly, without an `/api` prefix or backend proxy. The URL is public runtime configuration, not a baked-in build constant.
- Backend CORS uses only the explicit `CORS_ALLOWED_ORIGINS` allowlist. The automated stack sets it to the verified stable frontend origin; independent/local deployments must configure it explicitly. There are no regex patterns or implicit trusted domains. The current API permits cross-origin `GET` requests without cookies.
- Open the stable frontend URL from the GitHub Environment, not an arbitrary deployment hostname. Vercel Authentication on the backend can redirect API calls before CORS runs; changing application CORS cannot authorize that redirect. The API must be reachable under the approved browser-access policy for SSR to obtain and transfer a successful HttpClient response.

The [stack workflows](../ci/README.md) prepare the Neon preview first, apply [Alembic migrations](../database/README.md), deploy/resolve the backend, then deploy/resolve the frontend. Neon’s official action comments schema changes on the PR. Database credentials are resolved privately in each consuming job; no database password is passed through job outputs or public frontend configuration.

The remaining page rewrites only route frontend requests to Angular SSR.

## Development server

Copy the root `.env.example` to `.env.local` once. After installing frontend dependencies, run these commands in separate terminals from `frontend`:

```bash
pnpm run start:backend
pnpm start
```

[Portless](https://github.com/vercel-labs/portless) exposes the backend at `https://backend.localhost` and the frontend at `https://frontend.localhost`. It assigns free application ports automatically; FastAPI reads the injected `PORT` variable natively. Both scripts load `.env.local` through Node's `--env-file` option and pass the application commands directly to Portless, without shell-specific environment assignments or port interpolation. Configure `BACKEND_URL` and the explicit `CORS_ALLOWED_ORIGINS` allowlist in that file; existing process environment variables take precedence.

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
