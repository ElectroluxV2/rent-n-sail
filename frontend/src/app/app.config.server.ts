import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { env } from 'node:process';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { provideServerBackendApi } from './backend-api-url';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideServerBackendApi(env['BACKEND_URL']),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
