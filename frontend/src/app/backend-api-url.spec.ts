import { TestBed } from '@angular/core/testing';
import { TransferState } from '@angular/core';
import {
  BACKEND_API_URL,
  BACKEND_API_URL_STATE_KEY,
  provideBackendApiUrl,
} from './backend-api-url';
import { DEFAULT_BACKEND_URL } from '../local-origins';

describe('BACKEND_API_URL', () => {
  it('uses the default Portless backend without configuration', () => {
    TestBed.configureTestingModule({ providers: [provideBackendApiUrl()] });
    expect(TestBed.inject(BACKEND_API_URL)).toBe(DEFAULT_BACKEND_URL);
  });

  it('transfers the configured backend origin from SSR', () => {
    TestBed.configureTestingModule({
      providers: [provideBackendApiUrl('https://backend.test/path')],
    });
    expect(TestBed.inject(BACKEND_API_URL)).toBe('https://backend.test/');
    expect(TestBed.inject(TransferState).get(BACKEND_API_URL_STATE_KEY, '')).toBe(
      'https://backend.test/',
    );
  });

  it('uses the URL supplied by SSR during hydration', () => {
    TestBed.configureTestingModule({ providers: [provideBackendApiUrl()] });
    const state = TestBed.inject(TransferState);
    state.set(BACKEND_API_URL_STATE_KEY, 'https://backend.test/');
    expect(TestBed.inject(BACKEND_API_URL)).toBe('https://backend.test/');
  });

  it('composes with a server-specific provider override', () => {
    TestBed.configureTestingModule({
      providers: [provideBackendApiUrl(), provideBackendApiUrl('https://preview-backend.test')],
    });
    expect(TestBed.inject(BACKEND_API_URL)).toBe('https://preview-backend.test/');
  });
});
