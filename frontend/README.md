# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.4.

## Vercel deployment

The frontend and backend use separate Vercel projects. Postgres is hosted by Neon and is accessed only by the backend, not by browsers.

- `src/server.ts` defines and default-exports the SSR handler before Angular compiles it. `api/index.js` is only the discovery entry required by the current [Vercel Node.js Function](https://vercel.com/docs/functions/runtimes/node-js) configuration; it re-exports the compiled default handler. The page rewrites in `vercel.json` route requests to this handler, while static assets are served directly.
- SSR reads the public backend origin from `BACKEND_URL` and transfers its `/api` URL to the browser using Angular `TransferState`. Both SSR and the browser call that backend URL directly; there is no frontend-to-backend proxy hop or transfer-cache origin remapping. Set `BACKEND_URL` on the frontend Vercel project to the desired production or preview backend origin. It is public browser configuration and must not contain credentials.
- Configure backend CORS with comma-separated `CORS_ALLOWED_ORIGINS` and/or an optional `CORS_ALLOWED_ORIGIN_REGEX`. There are no built-in frontend domains or preview patterns: without configuration, cross-origin browser access is denied. Set these variables on each backend Vercel environment to the intended frontend origins. The current API permits cross-origin `GET` requests without cookies.

The remaining page rewrites only route frontend requests to Angular SSR.

## Development server

After installing frontend dependencies, run these commands in separate terminals from `frontend`:

```bash
pnpm run start:backend
pnpm start
```

[Portless](https://github.com/vercel-labs/portless) exposes the backend at `https://backend.localhost` and the frontend at `https://frontend.localhost`. It assigns free application ports automatically; the backend command explicitly consumes its `PORT` variable. The frontend uses the backend hostname by default, and `BACKEND_URL` can override it. The backend start script supplies `CORS_ALLOWED_ORIGINS=https://frontend.localhost` unless it is already configured.

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
