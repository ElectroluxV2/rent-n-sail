import { IMAGE_CONFIG, IMAGE_LOADER } from '@angular/common';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { backendApiInterceptor } from './backend-api-url';
import { rentalImageLoader } from './discover-rental-page/discover-rental-image-loader';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: IMAGE_LOADER, useValue: rentalImageLoader },
    { provide: IMAGE_CONFIG, useValue: { breakpoints: [640, 960, 1440] } },
    provideHttpClient(withInterceptors([backendApiInterceptor])),
    provideClientHydration(),
  ],
};
