import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BACKEND_API_URL } from '../backend-api-url';

interface AuthTunaAuthenticationOptions {
  challenge: string;
  rpId?: string;
  timeout?: number;
  allowCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  userVerification?: UserVerificationRequirement;
}

interface AuthTunaRegistrationOptions {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}

interface PasskeyFlowResponse {
  username: string;
}

type PasskeyOptionsResponse = AuthTunaAuthenticationOptions | AuthTunaRegistrationOptions;

@Component({
  imports: [FormsModule],
  selector: 'app-web-auth-flow',
  styleUrl: './web-auth-flow.component.scss',
  templateUrl: './web-auth-flow.component.html',
})
export class WebAuthFlowComponent {
  private readonly http = inject(HttpClient);
  private readonly backendApiUrl = inject(BACKEND_API_URL);

  protected readonly error = signal<string | null>(null);
  protected readonly isStarting = signal(false);
  protected readonly status = signal<string | null>(null);
  protected readonly canCreateAccount = signal(false);
  protected readonly localPasskeyDetected = signal<boolean | null>(null);
  protected username = '';

  protected async startFlow(): Promise<void> {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      this.error.set('Passkeys are not supported by this browser.');
      return;
    }

    this.error.set(null);
    this.status.set(null);
    this.canCreateAccount.set(false);
    this.localPasskeyDetected.set(null);
    this.isStarting.set(true);
    try {
      const initial = await this.loginInit();
      if (!initial) {
        throw new Error('The passkey flow returned an unexpected response.');
      }

      let credential: Credential | null;
      try {
        credential = await navigator.credentials.get({
          publicKey: this.authenticationOptions(initial as AuthTunaAuthenticationOptions),
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          this.localPasskeyDetected.set(false);
          this.canCreateAccount.set(true);
          this.error.set('No passkey was selected. No account was created.');
          return;
        }
        throw error;
      }

      if (!(credential instanceof PublicKeyCredential)) {
        this.localPasskeyDetected.set(false);
        this.canCreateAccount.set(true);
        this.error.set('No passkey was selected. No account was created.');
        return;
      }
      this.localPasskeyDetected.set(true);

      try {
        const result = await this.sendFlow('login/passkey/complete', {
          assertion: this.getAssertion(credential),
        });
        this.status.set(`Welcome ${result.username}.`);
      } catch (error: unknown) {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.canCreateAccount.set(true);
          this.error.set('This passkey is not registered. You can create an account.');
          return;
        }
        throw error;
      }
    } catch (error: unknown) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.isStarting.set(false);
    }
  }

  protected async createAccount(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!this.username.trim()) {
      this.error.set('A username is required.');
      return;
    }

    this.isStarting.set(true);
    this.error.set(null);
    try {
      const result = await this.registerInit({
        username: this.username.trim(),
      });
      if (!result) {
        throw new Error('The registration flow returned an unexpected response.');
      }

      const credential = await navigator.credentials.create({
        publicKey: this.registrationOptions(result as AuthTunaRegistrationOptions),
      });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('Passkey creation was cancelled.');
      }
      await this.sendFlow('register/passkey/complete', {
        attestation: this.registrationResponse(credential),
      });
      this.status.set('Account registered with a passkey.');
      this.canCreateAccount.set(false);
    } catch (error: unknown) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.isStarting.set(false);
    }
  }

  private sendFlow(path: string, payload: Record<string, unknown>): Promise<PasskeyFlowResponse> {
    return firstValueFrom(this.http.post<PasskeyFlowResponse>(this.endpoint(path), payload));
  }

  private loginInit(): Promise<PasskeyOptionsResponse> {
    return firstValueFrom(
      this.http.get<PasskeyOptionsResponse>(this.endpoint('login/passkey/begin')),
    );
  }

  private registerInit(payload: Record<string, unknown>): Promise<PasskeyOptionsResponse> {
    return firstValueFrom(
      this.http.post<PasskeyOptionsResponse>(this.endpoint('register/passkey/begin'), payload),
    );
  }

  private endpoint(path: string): string {
    return new URL(path, `${this.backendApiUrl}/`).href;
  }

  private authenticationOptions(
    options: AuthTunaAuthenticationOptions,
  ): PublicKeyCredentialRequestOptions {
    return {
      ...options,
      challenge: this.toBuffer(options.challenge),
      allowCredentials: options.allowCredentials?.map((credential) => ({
        ...credential,
        id: this.toBuffer(credential.id),
      })),
    };
  }

  private registrationOptions(
    options: AuthTunaRegistrationOptions,
  ): PublicKeyCredentialCreationOptions {
    return {
      ...options,
      challenge: this.toBuffer(options.challenge),
      user: { ...options.user, id: this.toBuffer(options.user.id) },
      excludeCredentials: options.excludeCredentials?.map((credential) => ({
        ...credential,
        id: this.toBuffer(credential.id),
      })),
    };
  }

  private getAssertion(credential: PublicKeyCredential): Record<string, unknown> {
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
      id: credential.id,
      rawId: this.toBase64Url(credential.rawId),
      type: credential.type,
      response: {
        authenticatorData: this.toBase64Url(response.authenticatorData),
        clientDataJSON: this.toBase64Url(response.clientDataJSON),
        signature: this.toBase64Url(response.signature),
        userHandle: response.userHandle ? this.toBase64Url(response.userHandle) : null,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }

  private registrationResponse(credential: PublicKeyCredential): Record<string, unknown> {
    const response = credential.response as AuthenticatorAttestationResponse;
    return {
      id: credential.id,
      rawId: this.toBase64Url(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: this.toBase64Url(response.attestationObject),
        clientDataJSON: this.toBase64Url(response.clientDataJSON),
        transports: response.getTransports(),
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }

  private toBuffer(value: string): ArrayBuffer {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return bytes.buffer;
  }

  private toBase64Url(value: ArrayBuffer): string {
    const bytes = new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'The passkey flow could not be completed.';
  }
}
