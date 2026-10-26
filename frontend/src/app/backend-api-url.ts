import { inject, InjectionToken, makeStateKey, TransferState } from '@angular/core';

export const BACKEND_API_URL_STATE_KEY = makeStateKey<string>('backend-api-url');

export async function loadBackendApiUrl(
  state: TransferState,
  fetchConfig: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (state.hasKey(BACKEND_API_URL_STATE_KEY)) return;
  const response = await fetchConfig('/runtime-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the frontend runtime configuration.');
  const config: { backendUrl: string } = await response.json();
  state.set(BACKEND_API_URL_STATE_KEY, new URL('/api', config.backendUrl).href);
}

function throwMissingBackendApiUrl(): never {
  throw new Error('The backend API URL is missing from the server-rendered application.');
}

export const BACKEND_API_URL = new InjectionToken<string>('BACKEND_API_URL', {
  providedIn: 'root',
  factory: () =>
    inject(TransferState).get<string | null>(BACKEND_API_URL_STATE_KEY, null) ??
    throwMissingBackendApiUrl(),
});
