import { TestBed } from '@angular/core/testing';
import { TransferState } from '@angular/core';
import { BACKEND_API_URL, BACKEND_API_URL_STATE_KEY, loadBackendApiUrl } from './backend-api-url';

describe('BACKEND_API_URL', () => {
  it('throws when SSR has not configured the backend URL', () => {
    expect(() => TestBed.inject(BACKEND_API_URL)).toThrowError(
      'The backend API URL is missing from the server-rendered application.',
    );
  });

  it('loads runtime configuration before a client-rendered application starts', async () => {
    const state = TestBed.inject(TransferState);
    const fetchConfig = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ backendUrl: 'https://backend.test' })));
    await loadBackendApiUrl(state, fetchConfig);
    expect(TestBed.inject(BACKEND_API_URL)).toBe('https://backend.test/api');
    expect(fetchConfig).toHaveBeenCalledWith('/runtime-config.json', { cache: 'no-store' });
  });

  it('does not fetch configuration already supplied by SSR', async () => {
    const state = TestBed.inject(TransferState);
    state.set(BACKEND_API_URL_STATE_KEY, 'https://backend.test/api');
    const fetchConfig = vi.fn<typeof fetch>();
    await loadBackendApiUrl(state, fetchConfig);
    expect(fetchConfig).not.toHaveBeenCalled();
  });
});
