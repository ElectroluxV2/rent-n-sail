import { ApplicationConfig, inject, mergeApplicationConfig, REQUEST } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { BACKEND_API_URL } from './backend-api-url';

const localFrontendUrl = 'http://127.0.0.1:4200';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    {
      provide: BACKEND_API_URL,
      useFactory: () => {
        const request = inject(REQUEST);
        return new URL('/api', request?.url ?? localFrontendUrl).href;
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
