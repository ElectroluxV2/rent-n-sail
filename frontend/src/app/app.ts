import { httpResource } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { FormRoot, form } from '@angular/forms/signals';
import { RouterOutlet } from '@angular/router';
import { BACKEND_API_URL } from './backend-api-url';
import { WebAuthFlowComponent } from './web-auth-flow/web-auth-flow.component';

interface BackendHello {
  Hello: string;
}

@Component({
  imports: [FormRoot, RouterOutlet, WebAuthFlowComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('frontend');
  protected readonly backendHello = httpResource<BackendHello>(() => BACKEND_API_URL);
  protected readonly checkForm = form(signal({}), {
    submission: {
      action: async () => {
        this.backendHello.reload();
      },
    },
  });
}
