import { inject, InjectionToken, makeStateKey, TransferState } from '@angular/core';

export const BACKEND_API_URL_STATE_KEY = makeStateKey<string>('backend-api-url');

function throwMissingBackendApiUrl(): never {
  throw new Error('The backend API URL is missing from the server-rendered application.');
}

export const BACKEND_API_URL = new InjectionToken<string>('BACKEND_API_URL', {
  providedIn: 'root',
  factory: () =>
    inject(TransferState).get<string | null>(BACKEND_API_URL_STATE_KEY, null) ??
    throwMissingBackendApiUrl(),
});
