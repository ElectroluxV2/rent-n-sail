import { TestBed } from '@angular/core/testing';
import { BACKEND_API_URL } from './backend-api-url';

describe('BACKEND_API_URL', () => {
  it('throws when SSR has not configured the backend URL', () => {
    expect(() => TestBed.inject(BACKEND_API_URL)).toThrowError(
      'The backend API URL is missing from the server-rendered application.',
    );
  });
});
