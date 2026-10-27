# Vercel Build Output

These files are the frontend's [Vercel Build Output API](https://vercel.com/docs/build-output-api) configuration. The frontend is deployed with `vercel deploy --prebuilt`, which uploads a finished `.vercel/output` directory, so Vercel never builds it.

Vercel's Angular preset would deploy only the static browser files. This app needs server-side rendering, because the server hands the runtime `BACKEND_URL` to the browser. The output is therefore one SSR function plus static files.

## How `.vercel/output` is assembled

`packageFrontendServiceOutput` in `.github/actions/_shared/providers.cjs` runs after `ng build`:

1. It copies this directory to `.vercel/output`, without this README.
2. It copies the whole Angular build, `dist/frontend`, into `functions/ssr.func`.
3. It copies `dist/frontend/browser` into `static`, except `index.csr.html`. Vercel would otherwise serve that client-only page as the home page instead of rendering it.

```text
.vercel/output/
├── config.json              routes, from this directory
├── static/                  browser assets, served directly
└── functions/ssr.func/
    ├── .vc-config.json      function settings, from this directory
    ├── server/server.mjs    Angular's SSR request handler
    └── browser/             the same assets, for the server
```

## Files

- [`config.json`](https://vercel.com/docs/build-output-api/configuration) has the routes. `handle: filesystem` serves a matching static file first, and every other request goes to the `ssr` function.
- [`functions/ssr.func/.vc-config.json`](https://vercel.com/docs/build-output-api/primitives) configures that function:
  - the Node.js 24 runtime, which must match `devEngines.runtime` in `../package.json`;
  - the handler, `server/server.mjs`;
  - Vercel's Node.js launcher;
  - streamed responses.
