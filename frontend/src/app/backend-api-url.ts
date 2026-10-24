import { InjectionToken } from '@angular/core';

export const BACKEND_API_URL = new InjectionToken<string>('BACKEND_API_URL', {
  providedIn: 'root',
  factory: () => new URL('/api', globalThis.location.origin).href,
});
