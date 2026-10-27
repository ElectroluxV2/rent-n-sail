# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.4.

## Development server

After installing frontend dependencies, run these commands in separate terminals from `frontend`; no environment file is required:

```bash
pnpm run start:backend
pnpm start
```

[Portless](https://github.com/vercel-labs/portless) exposes the backend at `https://backend.localhost` and the frontend at `https://frontend.localhost`. It assigns free application ports automatically; FastAPI reads the injected `PORT` variable natively. Scripts pass the application commands directly to Portless. Origin defaults live in `src/local-origins.ts`. The browser calls the backend through `/api/` on the frontend's origin, and the frontend's server forwards those requests to `BACKEND_URL`.

On first use, Portless may request permission to trust its local CA and bind HTTPS port 443. Run it interactively and follow its prompts. For custom proxy ports, TLS modes, hostnames, or worktrees, set `BACKEND_URL` to the backend's actual Portless URL, and set the backend's `WEBAUTHN_ORIGIN` and `WEBAUTHN_RP_ID` to the frontend's actual origin and hostname. No local CA or system trust changes are performed by repository setup.

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
