import { IMAGE_CONFIG, IMAGE_LOADER } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { rentalImageLoader } from './discover-rental-page/discover-rental-image-loader';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        { provide: IMAGE_LOADER, useValue: rentalImageLoader },
        { provide: IMAGE_CONFIG, useValue: { breakpoints: [640, 960, 1440] } },
      ],
    }).compileComponents();
  });

  it('should render the discover page at the default route', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-discover-rental-page')).not.toBeNull();
    expect(element.querySelector('h2')?.textContent).toContain('Kayak');
  });
});
