import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { DEFAULT_BACKEND_URL, DEFAULT_FRONTEND_URL } from './local-origins';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const portlessUrl = process.env['PORTLESS_URL'];
const frontendUrl = process.env['FRONTEND_URL'] ?? DEFAULT_FRONTEND_URL;
const canonicalFrontendUrl = new URL(portlessUrl ?? frontendUrl);
const backendOrigin = new URL(process.env['BACKEND_URL'] ?? DEFAULT_BACKEND_URL).origin;
// Vercel provides these deployment domains at runtime, without a URL scheme:
// https://vercel.com/docs/environment-variables/system-environment-variables
const allowedHosts = [
  process.env['VERCEL_URL'],
  process.env['VERCEL_BRANCH_URL'],
  process.env['VERCEL_PROJECT_PRODUCTION_URL'],
  new URL(frontendUrl).hostname,
  // Portless supplies the local URL; Angular expects only its hostname.
  portlessUrl ? new URL(portlessUrl).hostname : undefined,
].filter((host): host is string => Boolean(host));
const angularApp = new AngularNodeAppEngine({ allowedHosts });

app.use((req, res, next) => {
  if (req.hostname !== canonicalFrontendUrl.hostname) {
    res.redirect(308, new URL(req.originalUrl, canonicalFrontendUrl).toString());
    return;
  }
  next();
});

/**
 * Forward the browser's API calls to the backend, so they stay on this origin and its cookies stay
 * first-party. SSR calls the backend directly; see provideServerBackendApi.
 */
app.use('/api', (req, res, next) => {
  // Appending the path to the origin keeps every request on the backend's host.
  const target = new URL(backendOrigin + req.url);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = { ...req.headers, host: target.host };
  const upstream = send(target, { method: req.method, headers }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', next);
  req.pipe(upstream);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by Angular tooling and exported for Vercel before compilation.
 */
export const reqHandler = createNodeRequestHandler(app);
export default reqHandler;
