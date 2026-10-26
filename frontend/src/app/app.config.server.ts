import { ApplicationConfig, inject, mergeApplicationConfig, TransferState } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { env } from 'node:process';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { BACKEND_API_URL, BACKEND_API_URL_STATE_KEY } from './backend-api-url';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    {
      provide: BACKEND_API_URL,
      useFactory: () => {
        const backendUrl = env['BACKEND_URL'];
        if (!backendUrl) {
          throw new Error('BACKEND_URL must configure the public backend origin.');
        }

        const url = new URL('/api', backendUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new Error('BACKEND_URL must be an HTTP(S) origin without credentials.');
        }

        inject(TransferState).set(BACKEND_API_URL_STATE_KEY, url.href);
        return url.href;
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
