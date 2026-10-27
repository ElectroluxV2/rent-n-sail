import { FetchBackend, HttpBackend, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { makeEnvironmentProviders } from '@angular/core';
import { DEFAULT_BACKEND_URL } from '../local-origins';

/** The app reaches the backend under this path; server.ts forwards browser requests to it. */
export const BACKEND_API_PREFIX = '/api/';

const relativeUrlOrigin = 'http://frontend.invalid';

export const backendApiInterceptor: HttpInterceptorFn = (request, next) => {
  const url = new URL(request.url, relativeUrlOrigin);
  if (url.origin !== relativeUrlOrigin) return next(request);
  const path = url.pathname.startsWith(BACKEND_API_PREFIX)
    ? url.pathname
    : `${BACKEND_API_PREFIX}${url.pathname.slice(1)}`;
  return next(request.clone({ url: `${path}${url.search}` }));
};

/** Keep the SSR rewrite at the backend so transfer-cache requests retain their /api/ URL. */
export function provideServerBackendApi(backendUrl = DEFAULT_BACKEND_URL) {
  const backendOrigin = new URL(backendUrl).origin;
  class ServerBackendApi extends FetchBackend {
    override handle(request: HttpRequest<unknown>) {
      const url = new URL(request.url, backendOrigin);
      if (!url.pathname.startsWith(BACKEND_API_PREFIX)) return super.handle(request);
      const path = url.pathname.slice(BACKEND_API_PREFIX.length) + url.search;
      return super.handle(request.clone({ url: `${backendOrigin}/${path}` }));
    }
  }
  return makeEnvironmentProviders([
    { provide: HttpBackend, useFactory: () => new ServerBackendApi() },
  ]);
}
