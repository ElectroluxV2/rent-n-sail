import { inject, InjectionToken, makeStateKey, TransferState } from '@angular/core';

export const BACKEND_API_URL_STATE_KEY = makeStateKey<string>('backend-api-url');

export const BACKEND_API_URL = new InjectionToken<string>('BACKEND_API_URL', {
  providedIn: 'root',
  factory: () => {
    const url = inject(TransferState).get(BACKEND_API_URL_STATE_KEY, '');
    if (!url) {
      throw new Error('The backend API URL is missing from the server-rendered application.');
    }

    return url;
  },
});
