# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.4.

## Vercel deployment

The frontend and backend use separate Vercel projects. Postgres is hosted by Neon and is accessed only by the backend, not by browsers.

- `api/index.js` exposes the compiled Angular SSR handler as a [Vercel Node.js Function](https://vercel.com/docs/functions/runtimes/node-js). The browser build alone does not provide that function. The page rewrites in `vercel.json` route requests to this handler, while static assets are served directly.
- The `/api` rewrites proxy browser requests to the backend project, preserving the same-origin URL used by `BACKEND_API_URL`. Calling the backend domain directly instead would require frontend API URL configuration and backend CORS settings; separate project domains do not provide that automatically.
- SSR calls the backend through `BACKEND_URL`, which must be configured on the frontend Vercel project. The transfer-cache origin map aligns that response with the browser's same-origin `/api` URL.

Portless can provide local service hostnames, but it does not configure Vercel's production routing or CORS. Switching local development tools is separate from removing these production rewrites.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

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
