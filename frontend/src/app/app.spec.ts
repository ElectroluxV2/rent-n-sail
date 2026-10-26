import { TestBed } from '@angular/core/testing';
import { TransferState } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { BACKEND_API_URL_STATE_KEY } from './backend-api-url';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(TransferState).set(BACKEND_API_URL_STATE_KEY, 'https://backend.test/api');
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should render the backend response and reload it on form submission', async () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne('https://backend.test/api').flush({ Hello: 'World' });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Backend says: World');

    element
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    http.expectOne('https://backend.test/api').flush({ Hello: 'World again' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.textContent).toContain('Backend says: World again');
  });
});
