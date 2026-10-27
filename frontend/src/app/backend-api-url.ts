import { FetchBackend, HttpBackend, HttpRequest } from '@angular/common/http';
import { makeEnvironmentProviders } from '@angular/core';
import { DEFAULT_BACKEND_URL } from '../local-origins';

/** The app reaches the backend under this path; server.ts forwards browser requests to it. */
export const BACKEND_API_URL = '/api/';

/**
 * During SSR, sends BACKEND_API_URL requests straight to the backend instead of through this
 * server's own forwarding. Requests keep their /api/ URL until this last step, so the browser finds
 * their responses in the HTTP transfer cache.
 */
export function provideServerBackendApi(backendUrl = DEFAULT_BACKEND_URL) {
  const backendOrigin = new URL(backendUrl).origin;
  class ServerBackendApi extends FetchBackend {
    override handle(request: HttpRequest<unknown>) {
      // Angular has already resolved the app's relative /api/ URLs against this page here.
      const url = new URL(request.url, backendOrigin);
      if (!url.pathname.startsWith(BACKEND_API_URL)) return super.handle(request);
      const path = url.pathname.slice(BACKEND_API_URL.length) + url.search;
      return super.handle(request.clone({ url: `${backendOrigin}/${path}` }));
    }
  }
  return makeEnvironmentProviders([
    { provide: HttpBackend, useFactory: () => new ServerBackendApi() },
  ]);
}
