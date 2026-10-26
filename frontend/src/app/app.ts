import { httpResource } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormRoot, form } from '@angular/forms/signals';
import { RouterOutlet } from '@angular/router';
import { BACKEND_API_URL } from './backend-api-url';
import { WebAuthFlowComponent } from './web-auth-flow/web-auth-flow.component';

interface BackendHello {
  result: string;
}

@Component({
  imports: [FormRoot, RouterOutlet, WebAuthFlowComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('frontend');
  private readonly backendApiUrl = inject(BACKEND_API_URL);
  protected readonly backendHello = httpResource<BackendHello>(
    () => this.backendApiUrl + '/health',
  );
  protected readonly checkForm = form(signal({}), {
    submission: {
      action: async () => {
        this.backendHello.reload();
      },
    },
  });
}
