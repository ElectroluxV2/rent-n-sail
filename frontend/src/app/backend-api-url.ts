import {
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  makeStateKey,
  TransferState,
} from '@angular/core';
import { DEFAULT_BACKEND_URL } from '../local-origins';

export const BACKEND_API_URL_STATE_KEY = makeStateKey<string>('backend-api-url');

export const BACKEND_API_URL = new InjectionToken<string>('BACKEND_API_URL');

export function provideBackendApiUrl(url = DEFAULT_BACKEND_URL) {
  return makeEnvironmentProviders([
    {
      provide: BACKEND_API_URL,
      useFactory: () => {
        const state = inject(TransferState);
        const backendUrl = state.get(BACKEND_API_URL_STATE_KEY, new URL('/', url).href);
        state.set(BACKEND_API_URL_STATE_KEY, backendUrl);
        return backendUrl;
      },
    },
  ]);
}
