import { TestBed } from '@angular/core/testing';
import { TransferState } from '@angular/core';
import { BACKEND_API_URL, BACKEND_API_URL_STATE_KEY } from './backend-api-url';

describe('BACKEND_API_URL', () => {
  it('uses the backend URL transferred by SSR without the frontend proxy', () => {
    TestBed.inject(TransferState).set(BACKEND_API_URL_STATE_KEY, 'https://backend.test/api');

    expect(TestBed.inject(BACKEND_API_URL)).toBe('https://backend.test/api');
  });

  it('reports missing SSR configuration rather than requesting the frontend origin', () => {
    expect(() => TestBed.inject(BACKEND_API_URL)).toThrowError(
      'The backend API URL is missing from the server-rendered application.',
    );
  });
});
