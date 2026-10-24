import { HTTP_TRANSFER_CACHE_ORIGIN_MAP } from '@angular/common/http';
import { ApplicationConfig, inject, mergeApplicationConfig, REQUEST } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { env } from 'node:process';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { BACKEND_API_URL } from './backend-api-url';

const backendUrl = () => {
  const url = env['BACKEND_URL'];
  if (!url) {
    throw new Error('The BACKEND_URL service binding is not configured.');
  }

  return url;
};

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    {
      provide: BACKEND_API_URL,
      useFactory: () => new URL('/api', backendUrl()).href,
    },
    {
      provide: HTTP_TRANSFER_CACHE_ORIGIN_MAP,
      useFactory: () => {
        const request = inject(REQUEST);
        const url = env['BACKEND_URL'];
        return request && url ? { [new URL(url).origin]: new URL(request.url).origin } : {};
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
