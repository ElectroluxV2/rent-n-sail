import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { backendApiInterceptor } from './backend-api-url';

describe('backendApiInterceptor', () => {
  let http: HttpClient;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([backendApiInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTestingController.verify());

  it('prefixes relative URLs and preserves the query string', () => {
    http.get('/boats?status=available').subscribe();

    httpTestingController.expectOne('/api/boats?status=available').flush({});
  });

  it('does not duplicate the API prefix', () => {
    http.get('/api/boats').subscribe();

    httpTestingController.expectOne('/api/boats').flush({});
  });

  it('passes requests to another origin through unchanged', () => {
    const url = 'https://backend.example/boats?status=available';
    http.get(url).subscribe();

    httpTestingController.expectOne(url).flush({});
  });
});
