import {
  ApplicationConfig,
  inject,
  PLATFORM_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  TransferState,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { loadBackendApiUrl } from './backend-api-url';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    provideClientHydration(),
    provideAppInitializer(() => {
      const platform = inject(PLATFORM_ID);
      const state = inject(TransferState);
      return isPlatformBrowser(platform) ? loadBackendApiUrl(state) : undefined;
    }),
  ],
};
